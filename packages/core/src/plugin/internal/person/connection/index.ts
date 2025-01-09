import { Event, Logger, PromiseQueue } from '@skyway-sdk/common';
import { v4 } from 'uuid';

import { SkyWayContext } from '../../../../context';
import { errors } from '../../../../errors';
import { AnalyticsSession } from '../../../../external/analytics';
import { IceManager } from '../../../../external/ice';
import { SignalingSession } from '../../../../external/signaling';
import { LocalPersonImpl } from '../../../../member/localPerson';
import { RemoteMember } from '../../../../member/remoteMember';
import { Publication, PublicationImpl } from '../../../../publication';
import { Subscription, SubscriptionImpl } from '../../../../subscription';
import { createError } from '../../../../util';
import { SkyWayConnection } from '../../../interface/connection';
import { Receiver } from './receiver';
import { Sender } from './sender';

const log = new Logger(
  'packages/core/src/plugin/internal/person/connection/index.ts'
);

/**@internal */
export class P2PConnection implements SkyWayConnection {
  readonly id = v4();
  readonly type = 'p2p';
  readonly onDisconnect = new Event<void>();
  readonly onClose = new Event<void>();
  closed = false;
  disconnected = false;
  private _log = log.createBlock({
    id: this.id,
    localPersonId: this.localPerson.id,
  });
  private _pubsubQueue = new PromiseQueue();
  private sendSubscriptionStatsReportTimers: Map<
    string,
    ReturnType<typeof setInterval>
  > = new Map();
  private _waitingSendSubscriptionStatsReportsFromPublish: Map<string, string> =
    new Map();
  private _waitingSendSubscriptionStatsReportsFromSubscribe: string[] = [];

  readonly sender = new Sender(
    this._context,
    this._iceManager,
    this._signaling,
    this._analytics,
    this.localPerson,
    this.remoteMember
  );
  readonly receiver = new Receiver(
    this._context,
    this._iceManager,
    this._signaling,
    this._analytics,
    this.localPerson,
    this.remoteMember
  );

  /**@internal */
  constructor(
    private readonly _iceManager: IceManager,
    private readonly _signaling: SignalingSession,
    private readonly _analytics: AnalyticsSession | undefined,
    private readonly _context: SkyWayContext,
    readonly channelId: string,
    readonly localPerson: LocalPersonImpl,
    readonly remoteMember: RemoteMember
  ) {
    this.sender.onDisconnect.once(() => {
      this.disconnected = true;
      this.onDisconnect.emit();
    });
    this.receiver.onDisconnect.once(() => {
      this.disconnected = true;
      this.onDisconnect.emit();
    });

    if (this._analytics) {
      this._analytics.onConnectionStateChanged.add((state) => {
        // AnalyticsServerに初回接続できなかった場合のsendSubscriptionStatsReportタイマー再セット処理
        if (state !== 'connected') return;
        if (this._waitingSendSubscriptionStatsReportsFromPublish.size > 0) {
          for (const [subscriptionId, publicationId] of this
            ._waitingSendSubscriptionStatsReportsFromPublish) {
            const publication = this.sender.publications[publicationId];
            if (publication) {
              this.startSendSubscriptionStatsReportTimer(
                publication,
                subscriptionId
              );
            }
          }
          this._waitingSendSubscriptionStatsReportsFromPublish.clear();
        }
        if (this._waitingSendSubscriptionStatsReportsFromSubscribe.length > 0) {
          for (const subscriptionId of this
            ._waitingSendSubscriptionStatsReportsFromSubscribe) {
            const subscription = this.receiver.subscriptions[subscriptionId];
            if (subscription) {
              this.startSendSubscriptionStatsReportTimer(
                subscription,
                subscriptionId
              );
            }
          }
          this._waitingSendSubscriptionStatsReportsFromSubscribe = [];
        }
      });
    }
  }

  /**
   * @internal
   * @throws {SkyWayError}
   */
  async startPublishing(publication: PublicationImpl, subscriptionId: string) {
    await this._pubsubQueue.push(async () => {
      this._log.debug('startPublishing', { publication });
      await this.sender.add(publication);
    });

    if (this._analytics && !this._analytics.isClosed()) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this._analytics.client.sendBindingRtcPeerConnectionToSubscription({
        subscriptionId: subscriptionId,
        role: 'sender',
        rtcPeerConnectionId: this.sender.rtcPeerConnectionId,
      });

      if (this._analytics.client.isConnectionEstablished()) {
        this.startSendSubscriptionStatsReportTimer(publication, subscriptionId);
      } else {
        // AnalyticsServerに初回接続できなかった場合はキューに入れる
        this._waitingSendSubscriptionStatsReportsFromPublish.set(
          subscriptionId,
          publication.id
        );
      }
    }
  }

  /**@internal */
  async stopPublishing(publication: Publication) {
    await this._pubsubQueue.push(async () => {
      this._log.debug('<stopPublishing> start', { publication });
      this.sender
        .remove(publication.id)
        .then(() => {
          this._log.debug('<stopPublishing> removed', { publication });
        })
        .catch((e) => {
          this._log.error('<stopPublishing> remove failed', e, { publication });
        });
      this._closeIfNeeded();
      this._log.debug('<stopPublishing> end', { publication });
    });

    // publication(=stream）のidをkeyとして一致するタイマーを取得する
    const sendSubscriptionStatsReportTimer =
      this.sendSubscriptionStatsReportTimers.get(publication.id);
    if (sendSubscriptionStatsReportTimer) {
      clearInterval(sendSubscriptionStatsReportTimer);
      this.sendSubscriptionStatsReportTimers.delete(publication.id);
    }
  }

  /**@internal */
  async startSubscribing(subscription: SubscriptionImpl) {
    await this._pubsubQueue.push(async () => {
      this._log.debug('startSubscribing', { subscription });
      this.receiver.add(subscription);
      const publicationId = subscription.publication.id;

      let stream = this.receiver.streams[publicationId];
      if (!stream) {
        await this.receiver.onStreamAdded
          .watch(
            (res) => res.publicationId === publicationId,
            this._context.config.rtcConfig.timeout
          )
          .catch(() => {
            throw createError({
              operationName: 'P2PConnection.startSubscribing',
              info: { ...errors.timeout, detail: 'onStreamAdded' },
              path: log.prefix,
              context: this._context,
              channel: this.localPerson.channel,
              payload: { subscription },
            });
          });
        stream = this.receiver.streams[publicationId];
      }

      stream.setIsEnabled(subscription.publication.state === 'enabled');
      subscription.codec = stream.codec;
      subscription._setStream(stream);

      if (this._analytics && !this._analytics.isClosed()) {
        // 再送時に他の処理をブロックしないためにawaitしない
        void this._analytics.client.sendBindingRtcPeerConnectionToSubscription({
          subscriptionId: subscription.id,
          role: 'receiver',
          rtcPeerConnectionId: this.receiver.rtcPeerConnectionId,
        });

        if (this._analytics.client.isConnectionEstablished()) {
          this.startSendSubscriptionStatsReportTimer(
            subscription,
            subscription.id
          );
        } else {
          // AnalyticsServerに初回接続できなかった場合はキューに入れる
          this._waitingSendSubscriptionStatsReportsFromSubscribe.push(
            subscription.id
          );
        }
      }
    });
  }

  /**@internal */
  async stopSubscribing(subscription: Subscription) {
    await this._pubsubQueue.push(async () => {
      this._log.debug('stopSubscribing', { subscription });
      this.receiver.remove(subscription.id);
      this._closeIfNeeded();
    });

    // subscription(=stream）のidをkeyとして一致するタイマーを取得する
    const sendSubscriptionStatsReportTimer =
      this.sendSubscriptionStatsReportTimers.get(subscription.id);
    if (sendSubscriptionStatsReportTimer) {
      clearInterval(sendSubscriptionStatsReportTimer);
      this.sendSubscriptionStatsReportTimers.delete(subscription.id);
    }
  }

  private _closeIfNeeded(): void {
    if (this.sender.hasMedia || this.receiver.hasMedia) return;
    this.close({ reason: 'no media' });
  }

  async getStats(content: Subscription | Publication) {
    const stream = content.stream;
    if (!stream) {
      throw createError({
        operationName: 'P2PConnection.getStats',
        info: {
          ...errors.invalidArgumentValue,
          detail: 'Subscription or Publication must has stream',
        },
        path: log.prefix,
        context: this._context,
        channel: this.localPerson.channel,
      });
    }
    if (stream.side === 'local') {
      if (stream.contentType === 'data') {
        return this.sender.pc.getStats();
      }
      return this.sender.pc.getStats(stream.track);
    } else {
      if (stream.contentType === 'data') {
        return this.receiver.pc.getStats();
      }
      return this.receiver.pc.getStats(stream.track);
    }
  }

  /**@internal */
  close({ reason }: { reason?: string } = {}) {
    if (this.closed) {
      return;
    }
    this.closed = true;

    this._log.debug('closed', {
      endpointId: this.remoteMember.id,
      reason,
      sender: this.sender.id,
      receiver: this.receiver.id,
      id: this.id,
    });

    this.sender.close();
    this.receiver.close();
    for (const timer of this.sendSubscriptionStatsReportTimers.values()) {
      clearInterval(timer);
    }
    this.sendSubscriptionStatsReportTimers.clear();
    this._waitingSendSubscriptionStatsReportsFromPublish.clear();
    this._waitingSendSubscriptionStatsReportsFromSubscribe = [];
    this.onClose.emit();
  }

  private startSendSubscriptionStatsReportTimer(
    stream: Publication | Subscription,
    subscriptionId: string
  ) {
    if (this._analytics) {
      const role = stream instanceof PublicationImpl ? 'sender' : 'receiver';
      const intervalSec = this._analytics.client.getIntervalSec();
      this.sendSubscriptionStatsReportTimers.set(
        stream.id,
        setInterval(async () => {
          if (!this._analytics) {
            throw createError({
              operationName: 'P2PConnection.sendSubscriptionStatsReportTimer',
              info: {
                ...errors.missingProperty,
                detail: 'AnalyticsSession not exist',
              },
              path: log.prefix,
              context: this._context,
              channel: this.localPerson.channel,
            });
          }

          // AnalyticsSessionがcloseされていたらタイマーを止める
          if (this._analytics.isClosed()) {
            const subscriptionStatsReportTimer =
              this.sendSubscriptionStatsReportTimers.get(stream.id);
            if (subscriptionStatsReportTimer) {
              clearInterval(subscriptionStatsReportTimer);
              this.sendSubscriptionStatsReportTimers.delete(stream.id);
            }
            return;
          }

          const stats = await this.getStats(stream);
          if (stats) {
            // 再送時に他の処理をブロックしないためにawaitしない
            void this._analytics.client.sendSubscriptionStatsReport(stats, {
              subscriptionId: subscriptionId,
              role: role,
              contentType: stream.contentType,
              createdAt: Date.now(),
            });
          }
        }, intervalSec * 1000)
      );
    }
  }
}

const p2pMessageKinds = [
  'senderProduceMessage',
  'senderUnproduceMessage',
  'receiverAnswerMessage',
  'iceCandidateMessage',
  'senderRestartIceMessage',
  'ping',
] as const;

/**@internal */
export type P2PMessageKind = (typeof p2pMessageKinds)[number];

/**@internal */
export type P2PMessage = {
  kind: P2PMessageKind;
  payload: any;
};
