import { Event, Logger, PromiseQueue } from '@skyway-sdk/common';
import { v4 } from 'uuid';

import { SkyWayContext } from '../../../../context';
import { errors } from '../../../../errors';
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

  readonly sender = new Sender(
    this._context,
    this._iceManager,
    this._signaling,
    this.localPerson,
    this.remoteMember
  );
  readonly receiver = new Receiver(
    this._context,
    this._iceManager,
    this._signaling,
    this.localPerson,
    this.remoteMember
  );

  /**@internal */
  constructor(
    private readonly _iceManager: IceManager,
    private readonly _signaling: SignalingSession,
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
  }

  /**
   * @internal
   * @throws {SkyWayError}
   */
  async startPublishing(publication: PublicationImpl) {
    await this._pubsubQueue.push(async () => {
      this._log.debug('startPublishing', { publication });
      await this.sender.add(publication);
    });
  }

  /**@internal */
  async stopPublishing(publication: Publication) {
    await this._pubsubQueue.push(async () => {
      this._log.debug('<stopPublishing> start', { publication });
      this.sender.remove(publication.id).then(() => {
        this._log.debug('<stopPublishing> removed', { publication });
      });
      this._closeIfNeeded();
      this._log.debug('<stopPublishing> end', { publication });
    });
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

      subscription.codec = stream.codec;
      subscription._setStream(stream);
    });
  }

  /**@internal */
  async stopSubscribing(subscription: Subscription) {
    await this._pubsubQueue.push(async () => {
      this._log.debug('stopSubscribing', { subscription });
      this.receiver.remove(subscription.id);
      this._closeIfNeeded();
    });
  }

  private _closeIfNeeded(): void {
    if (this.sender.hasMedia || this.receiver.hasMedia) return;
    this.close();
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
  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;

    this._log.debug('closed', { endpointId: this.remoteMember.id });

    this.sender.close();
    this.receiver.close();

    this.onClose.emit();
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
