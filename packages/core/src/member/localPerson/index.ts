import {
  Event,
  EventDisposer,
  Logger,
  PromiseQueue,
  SkyWayError,
} from '@skyway-sdk/common';
import { PublicationInit } from '@skyway-sdk/rtc-api-client';

import { PersonInit, SkyWayChannelImpl } from '../../channel';
import { SkyWayContext } from '../../context';
import { errors } from '../../errors';
import { AnalyticsSession } from '../../external/analytics';
import { IceManager } from '../../external/ice';
import { SignalingSession } from '../../external/signaling';
import { Codec, EncodingParameters } from '../../media';
import { LocalStream } from '../../media/stream';
import {
  RemoteAudioStream,
  RemoteDataStream,
  RemoteVideoStream,
} from '../../media/stream';
import { MemberImpl } from '../../member';
import { SkyWayConnection } from '../../plugin/interface';
import { UnknownMemberImpl } from '../../plugin/internal/unknown/member';
import {
  normalizeEncodings,
  Publication,
  PublicationImpl,
  sortEncodingParameters,
} from '../../publication';
import { Subscription, SubscriptionImpl } from '../../subscription';
import { createError, createLogPayload } from '../../util';
import { Person } from '../person';
import { isRemoteMember } from '../remoteMember';
import { PublishingAgent, SubscribingAgent } from './agent';

export * from './adapter';
export * from './factory';

const log = new Logger('packages/core/src/member/localPerson/index.ts');

export interface LocalPerson extends Person {
  /**@internal */
  readonly keepaliveIntervalSec?: number | null;
  /**
   * @description [japanese] このPersonがStreamをPublishしたときに発火するイベント
   */
  readonly onStreamPublished: Event<{ publication: Publication }>;
  /**
   * @description [japanese] このPersonがStreamをUnpublishしたときに発火するイベント
   */
  readonly onStreamUnpublished: Event<{ publication: Publication }>;
  /**@description [japanese] このPersonのPublicationの数が変化したときに発火するイベント */
  readonly onPublicationListChanged: Event<void>;
  /**
   * @description [japanese] このPersonがStreamをSubscribeしたときに発火するイベント
   */
  readonly onPublicationSubscribed: Event<{
    subscription: Subscription;
    stream: RemoteVideoStream | RemoteAudioStream | RemoteDataStream;
  }>;
  /**
   * @description [japanese] このPersonがStreamをUnsubscribeしたときに発火するイベント
   */
  readonly onPublicationUnsubscribed: Event<{ subscription: Subscription }>;
  /**@description [japanese] このPersonのSubscriptionの数が変化したときに発火するイベント */
  readonly onSubscriptionListChanged: Event<void>;
  /**
   * @description [japanese] 回復不能なエラー。このインスタンスは継続して利用できない。
   */
  readonly onFatalError: Event<SkyWayError>;

  /**
   * @description [japanese] StreamをPublishする
   */
  publish: <T extends LocalStream = LocalStream>(
    stream: T,
    options?: PublicationOptions
  ) => Promise<Publication<T>>;
  /**
   * @description [japanese] StreamのPublicationをUnpublishする
   */
  unpublish: (publication: string | Publication) => Promise<void>;
  /**
   * @description [japanese] StreamのPublicationをSubscribeする
   */
  subscribe: <
    T extends RemoteDataStream | RemoteAudioStream | RemoteVideoStream
  >(
    publication: string | Publication,
    options?: SubscriptionOptions
  ) => Promise<{ subscription: Subscription<T>; stream: T }>;
  /**
   * @description [japanese] StreamのSubscriptionをUnsubscribeする
   */
  unsubscribe: (subscription: string | Subscription) => Promise<void>;
}

/**@internal */
export class LocalPersonImpl extends MemberImpl implements LocalPerson {
  readonly type = 'person' as const;
  readonly subtype = 'person' as const;
  readonly side = 'local' as const;
  ttlSec?: number;
  readonly keepaliveIntervalSec = this.args.keepaliveIntervalSec;
  readonly keepaliveIntervalGapSec = this.args.keepaliveIntervalGapSec;
  readonly preventAutoLeaveOnBeforeUnload =
    this.args.preventAutoLeaveOnBeforeUnload;
  readonly disableSignaling = this.args.disableSignaling;
  readonly disableAnalytics = this.args.disableAnalytics;
  readonly config = this.context.config;

  readonly onStreamPublished = this._events.make<{
    publication: Publication;
  }>();
  readonly onStreamUnpublished = this._events.make<{
    publication: Publication;
  }>();
  readonly onPublicationListChanged = this._events.make<void>();
  readonly onPublicationSubscribed = this._events.make<{
    subscription: Subscription;
    stream: RemoteVideoStream | RemoteAudioStream | RemoteDataStream;
  }>();
  readonly onPublicationUnsubscribed = this._events.make<{
    subscription: Subscription;
  }>();
  readonly onSubscriptionListChanged = this._events.make<void>();
  readonly onFatalError = this._events.make<SkyWayError>();

  private readonly _onStreamSubscribeFailed = this._events.make<{
    error: SkyWayError;
    subscription: Subscription;
  }>();
  /**@private */
  readonly _onDisposed = this._events.make<void>();

  private _disposer = new EventDisposer();
  private readonly _publishingAgent: PublishingAgent;
  private readonly _subscribingAgent: SubscribingAgent;
  private ttlInterval?: any;
  private _subscribing: {
    [publicationId: string]: {
      options: SubscriptionOptions;
      processing: boolean;
    };
  } = {};

  private _requestQueue = new PromiseQueue();

  /**@private */
  readonly iceManager = this.args.iceManager;
  /**@private */
  readonly _signaling?: SignalingSession;
  /**@private */
  readonly _analytics?: AnalyticsSession;
  /**@private */
  _disposed = false;

  static async Create(...args: ConstructorParameters<typeof LocalPersonImpl>) {
    const person = new LocalPersonImpl(...args);
    await person._setupTtlTimer();
    if (person._analytics) {
      void person._analytics.client.sendJoinReport({
        memberId: person.id,
      });
    }
    return person;
  }

  /**@private */
  constructor(
    private args: {
      channel: SkyWayChannelImpl;
      signaling?: SignalingSession;
      analytics?: AnalyticsSession;
      name?: string;
      id: string;
      metadata?: string;
      iceManager: IceManager;
      context: SkyWayContext;
    } & PersonInit
  ) {
    super(args);

    this._publishingAgent = new PublishingAgent(this);
    this._subscribingAgent = new SubscribingAgent(this);
    this._signaling = args.signaling;
    this._analytics = args.analytics;

    this._listenChannelEvent();
    this._listenBeforeUnload();
  }

  private _listenChannelEvent() {
    this.channel.onPublicationSubscribed
      .add(async ({ subscription }) => {
        await this._handleOnPublicationSubscribe(
          subscription as SubscriptionImpl
        ).catch((e) => log.error('_handleOnStreamSubscribe', e));
      })
      .disposer(this._disposer);
    this.channel.onPublicationUnsubscribed
      .add(async ({ subscription }) => {
        await this._handleOnPublicationUnsubscribe(
          subscription as SubscriptionImpl
        ).catch((e) => log.error('_handleOnStreamUnsubscribe', e));
      })
      .disposer(this._disposer);
    this.channel._onDisposed.once(() => {
      this.dispose();
    });
    this.onLeft.once(() => {
      this.dispose();
    });
  }

  /**@throws {@SkyWayError} */
  private async _setupTtlTimer() {
    const { keepaliveIntervalSec, keepaliveIntervalGapSec } = this;
    if (keepaliveIntervalSec == null) return;

    log.debug('_setupTtlTimer', this.toJSON(), {
      keepaliveIntervalSec,
      keepaliveIntervalGapSec,
    });

    if (keepaliveIntervalSec === -1) {
      return;
    }

    const updateTtl = async () => {
      if (this._disposed) {
        return;
      }

      const now = await this.context._api.getServerUnixtimeInSec();
      this.ttlSec = Math.floor(
        now + keepaliveIntervalSec + (keepaliveIntervalGapSec ?? 0)
      );
      try {
        await this.channel._updateMemberTtl(this.id, this.ttlSec);
        log.debug('updateTtl', this.toJSON(), {
          now,
          ttlSec: this.ttlSec,
          keepaliveIntervalSec: keepaliveIntervalSec ?? 0,
          keepaliveIntervalGapSec: keepaliveIntervalGapSec ?? 0,
          diff: this.ttlSec - now,
        });
      } catch (error) {
        if (this._disposed) {
          return;
        }
        throw error;
      }
    };

    await updateTtl();

    this.ttlInterval = setInterval(async () => {
      await updateTtl().catch((error) => {
        if (!this._disposed) {
          this.onFatalError.emit(
            createError({
              operationName: 'localPerson._setupTtlTimer',
              path: log.prefix,
              info: {
                ...errors.internal,
                detail: 'updateMemberTtl failed',
              },
              channel: this.channel,
              context: this.context,
              error,
            })
          );
          this.dispose();
        }
      });
    }, keepaliveIntervalSec * 1000);
  }

  private _listenBeforeUnload() {
    if (window && !this.preventAutoLeaveOnBeforeUnload) {
      const leave = async () => {
        window.removeEventListener('beforeunload', leave);
        if (this.state !== 'joined') {
          return;
        }

        log.debug('leave by beforeunload', this.toJSON());
        await this.leave();
      };
      window.addEventListener('beforeunload', leave);
    }
  }

  /**@throws {@link SkyWayError} */
  private async _handleOnPublicationSubscribe(subscription: SubscriptionImpl) {
    if (subscription.subscriber.id === this.id) {
      try {
        const timestamp = log.info(
          '[start] startSubscribing',
          await createLogPayload({
            operationName: 'onPublicationSubscribed',
            channel: this.channel,
          }),
          { subscription }
        );

        const options = this._subscribing[subscription.publication.id]?.options;

        if (options) {
          subscription.preferredEncoding = options.preferredEncodingId;
        }

        await this._subscribingAgent.startSubscribing(subscription);

        this.onPublicationSubscribed.emit({
          subscription,
          stream: subscription.stream!,
        });
        this.onSubscriptionListChanged.emit();

        log.elapsed(
          timestamp,
          '[end] startSubscribing',
          await createLogPayload({
            operationName: 'onPublicationSubscribed',
            channel: this.channel,
          }),
          {
            subscription,
          }
        );
      } catch (error: any) {
        this._onStreamSubscribeFailed.emit({ error, subscription });
        throw error;
      }
    }

    if (subscription.publication.publisher.id === this.id) {
      if (subscription.subscriber.id === this.id) {
        throw createError({
          operationName: 'localPerson._handleOnStreamSubscribe',
          path: log.prefix,
          info: {
            ...errors.internal,
            detail: 'can not subscribe own Publication',
          },
          channel: this.channel,
          context: this.context,
        });
      }

      const timestamp = log.info(
        '[start] startPublishing',
        await createLogPayload({
          operationName: 'onPublicationSubscribed',
          channel: this.channel,
        }),
        { subscription }
      );

      await this._publishingAgent.startPublishing(subscription).catch((e) => {
        log.error('[failed] startPublishing', e, { subscription });
        throw e;
      });
      log.elapsed(
        timestamp,
        '[end] startPublishing',
        await createLogPayload({
          operationName: 'onPublicationSubscribed',
          channel: this.channel,
        }),
        { subscription }
      );
    }
  }

  /**@throws {@link SkyWayError} */
  private async _handleOnPublicationUnsubscribe(
    subscription: SubscriptionImpl
  ) {
    if (subscription.publication.publisher.id === this.id) {
      const timestamp = log.info(
        '[start] stopPublishing',
        await createLogPayload({
          operationName: 'onPublicationUnsubscribed',
          channel: this.channel,
        }),
        { subscription }
      );

      await this._publishingAgent
        .stopPublishing(subscription.publication, subscription.subscriber)
        .catch((e) => {
          log.error('[failed] stopPublishing', e, { subscription });
          throw e;
        });

      log.elapsed(
        timestamp,
        '[end] stopPublishing',
        await createLogPayload({
          operationName: 'onPublicationUnsubscribed',
          channel: this.channel,
        }),
        { subscription }
      );
    }
    if (subscription.subscriber.id === this.id) {
      const timestamp = log.info(
        '[start] stopSubscribing',
        await createLogPayload({
          operationName: 'onPublicationUnsubscribed',
          channel: this.channel,
        }),
        { subscription }
      );

      await this._subscribingAgent.stopSubscribing(subscription).catch((e) => {
        log.error('[failed] stopSubscribing', { subscription }, e);
        throw e;
      });

      this.onPublicationUnsubscribed.emit({ subscription });
      this.onSubscriptionListChanged.emit();
      log.elapsed(
        timestamp,
        '[end] stopSubscribing',
        await createLogPayload({
          operationName: 'onPublicationUnsubscribed',
          channel: this.channel,
        }),
        { subscription }
      );
    }
  }

  /**@throws {@link SkyWayError} */
  async publish<T extends LocalStream>(
    stream: T,
    options: PublicationOptions = {}
  ): Promise<Publication<T>> {
    const timestamp = log.info(
      '[start] publish',
      await createLogPayload({
        operationName: 'localPerson.publish',
        channel: this.channel,
      }),
      { options }
    );

    if (this.state !== 'joined') {
      throw createError({
        operationName: 'localPerson.publish',
        info: errors.localPersonNotJoinedChannel,
        path: log.prefix,
        channel: this.channel,
        context: this.context,
      });
    }
    if (stream.published) {
      throw createError({
        operationName: 'localPerson.publish',
        channel: this.channel,
        context: this.context,
        info: errors.alreadyPublishedStream,
        path: log.prefix,
      });
    }
    stream.published = true;

    if (options.codecCapabilities) {
      options.codecCapabilities = options.codecCapabilities.filter(
        (c) => c != undefined
      );
    }

    const init: PublicationInit = {
      metadata: options.metadata,
      publisher: this.id,
      channel: this.channel.id,
      contentType: stream.contentType,
      codecCapabilities: options.codecCapabilities ?? [],
      isEnabled: options.isEnabled,
    };
    if (
      stream.contentType === 'video' &&
      init.codecCapabilities!.length === 0
    ) {
      init.codecCapabilities = [{ mimeType: 'video/vp8' }];
    }
    if (options.encodings && options.encodings.length > 0) {
      init.encodings = normalizeEncodings(
        sortEncodingParameters(options.encodings)
      );
    }

    const published = await this._requestQueue.push(() =>
      this.channel._publish(init).catch((e) => {
        throw createError({
          operationName: 'localPerson.publish',
          context: this.context,
          channel: this.channel,
          info: e.info,
          path: log.prefix,
          error: e,
        });
      })
    );

    // publication作成時にpublication.state=isEnabledとなり、その後isEnabledに合わせてpublicationのenableStream/disableStreamを呼び出してもsetIsEnabled/setEnabledが実行されない。
    // そのままではpublication.stateとstreamで状態の乖離が発生する場合があるため、ここで直接実行し一致させておく。
    if (stream.contentType === 'data') {
      stream.setIsEnabled(published.isEnabled);
    } else {
      await stream.setEnabled(published.isEnabled);
    }

    const publication = this.channel._addPublication(published);
    publication._setStream(stream);

    if (init.codecCapabilities?.length) {
      publication.setCodecCapabilities(init.codecCapabilities);
    }
    if (init.encodings?.length) {
      publication.setEncodings(init.encodings);
    }

    await this._handleOnStreamPublish(publication);

    log.elapsed(
      timestamp,
      '[end] publish',
      await createLogPayload({
        operationName: 'localPerson.publish',
        channel: this.channel,
      }),
      { publication }
    );

    // dataの場合はMediaDeviceがないので送信処理をしない
    if (
      ['video', 'audio'].includes(publication.contentType) &&
      this._analytics &&
      !this._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this._analytics.client.sendMediaDeviceReport({
        publicationId: publication.id,
        mediaDeviceName: publication.deviceName as string,
        mediaDeviceTrigger: 'publish',
        updatedAt: Date.now(),
      });

      const encodings = init.encodings ?? [];
      void this._analytics.client.sendPublicationUpdateEncodingsReport({
        publicationId: publication.id,
        encodings: encodings,
        updatedAt: Date.now(),
      });
    }

    return publication as Publication<T>;
  }

  private async _handleOnStreamPublish(publication: Publication) {
    log.info(
      'onStreamPublished',
      await createLogPayload({
        operationName: 'onStreamPublished',
        channel: this.channel,
      })
    );
    this.onStreamPublished.emit({ publication });
    this.onPublicationListChanged.emit();
  }

  /**@throws {@link SkyWayError} */
  async unpublish(target: string | Publication) {
    const timestamp = log.info(
      '[start] unpublish',
      await createLogPayload({
        operationName: 'localPerson.unpublish',
        channel: this.channel,
      })
    );

    const publicationId = typeof target === 'string' ? target : target.id;

    if (this.state !== 'joined') {
      throw createError({
        operationName: 'localPerson.unpublish',
        info: errors.localPersonNotJoinedChannel,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
      });
    }

    const publication = this.channel._getPublication(publicationId);
    if (!publication) {
      throw createError({
        operationName: 'localPerson.unpublish',
        info: errors.publicationNotExist,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
        payload: { publicationId },
      });
    }

    if (publication.stream) {
      publication.stream._unpublished();
    }

    await this._requestQueue.push(() => this.channel._unpublish(publicationId));

    publication.subscriptions
      .map((s) => s.subscriber)
      .forEach((s) => {
        if (isRemoteMember(s)) {
          this._publishingAgent.stopPublishing(publication, s).catch((e) => {
            log.error('[failed] stopPublishing', e, { publication });
          });
        }
      });

    await this._handleOnStreamUnpublished(publication);

    log.elapsed(
      timestamp,
      '[end] unpublish',
      await createLogPayload({
        operationName: 'localPerson.unpublish',
        channel: this.channel,
      }),
      { publication }
    );
  }

  private async _handleOnStreamUnpublished(publication: Publication) {
    log.info(
      'onStreamUnpublished',
      await createLogPayload({
        operationName: 'onStreamUnpublished',
        channel: this.channel,
      })
    );
    this.onStreamUnpublished.emit({ publication });
    this.onPublicationListChanged.emit();
  }

  /**@throws {@link SkyWayError} */
  async subscribe<
    T extends RemoteVideoStream | RemoteAudioStream | RemoteDataStream
  >(
    target: string | Publication,
    options: SubscriptionOptions = {}
  ): Promise<{ subscription: Subscription<T>; stream: T }> {
    const timestamp = log.info(
      '[start] subscribe',
      await createLogPayload({
        operationName: 'localPerson.subscribe',
        channel: this.channel,
      }),
      { target }
    );

    const publicationId = typeof target === 'string' ? target : target.id;

    if (this.state !== 'joined') {
      throw createError({
        operationName: 'localPerson.subscribe',
        info: errors.localPersonNotJoinedChannel,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
        payload: { target },
      });
    }

    const publication = this.channel._getPublication(publicationId);
    if (publication == undefined) {
      throw createError({
        operationName: 'localPerson.subscribe',
        info: errors.publicationNotExist,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
        payload: publication,
      });
    }

    this._validatePublicationForSubscribe(publication);

    this._subscribing[publication.id] = {
      options,
      processing: true,
    };
    const subscribing = this._subscribing[publication.id];

    try {
      const subscriptionDto = await this._requestQueue.push(() =>
        this.channel._subscribe(this.id, publicationId)
      );

      log.elapsed(timestamp, '[elapsed] subscribe / subscriptionDto received', {
        subscriptionDto,
      });
      const subscription = this.channel._addSubscription(subscriptionDto);

      if (!subscription.stream) {
        await Promise.race([
          new Promise((r, f) => {
            this.onPublicationSubscribed
              .watch(
                ({ subscription }) =>
                  subscription.publication.id === publicationId,
                this.context.config.rtcApi.timeout
              )
              .then(r)
              .catch(async (e) => {
                if (subscribing.processing) {
                  f(
                    createError({
                      operationName: 'localPerson.subscribe',
                      info: {
                        ...errors.timeout,
                        detail:
                          'failed to subscribe publication. maybe publisher already left room',
                      },
                      path: log.prefix,
                      context: this.context,
                      channel: this.channel,
                      payload: { subscription, publication },
                      error: e,
                    })
                  );
                }
              });
          }),
          new Promise((r, f) => {
            this.channel.onMemberLeft
              .watch(
                (e) => e.member.id === publication.publisher.id,
                this.context.config.rtcApi.timeout + 1000
              )
              .then(() => {
                if (subscribing.processing) {
                  f(
                    createError({
                      operationName: 'localPerson.subscribe',
                      info: {
                        ...errors.internal,
                        detail:
                          'failed to subscribe publication. publisher already left room',
                      },
                      path: log.prefix,
                      context: this.context,
                      channel: this.channel,
                      payload: { subscription, publication },
                    })
                  );
                }
              })
              .catch(r);
          }),
          new Promise((r, f) => {
            this._onStreamSubscribeFailed
              .watch(
                (e) => e.subscription.publication.id === publication.id,
                this.context.config.rtcApi.timeout + 1000
              )
              .then((e) => {
                if (subscribing.processing) {
                  const info = e?.error?.info ?? {
                    ...errors.internal,
                    detail: 'subscribe _onStreamSubscribeFailed',
                  };
                  f(
                    createError({
                      operationName: 'localPerson.subscribe',
                      info,
                      path: log.prefix,
                      context: this.context,
                      channel: this.channel,
                      error: e.error,
                      payload: { subscription, publication },
                    })
                  );
                }
              })
              .catch(r);
          }),
        ]);
      }

      subscribing.processing = false;
      log.elapsed(
        timestamp,
        '[end] subscribe',
        await createLogPayload({
          operationName: 'localPerson.subscribe',
          channel: this.channel,
        }),
        { subscription, publication }
      );

      return {
        subscription: subscription as Subscription<T>,
        stream: subscription.stream as T,
      };
    } catch (error) {
      subscribing.processing = false;
      // 対象のPublicationがすでにUnPublishされている時に失敗しうる
      log.warn('[failed] subscribe', error, { publication });
      throw error;
    }
  }

  /**@throws {@link SkyWayError} */
  private _validatePublicationForSubscribe(publication: PublicationImpl) {
    if (publication.publisher.id === this.id) {
      throw createError({
        operationName: 'localPerson._validatePublicationForSubscribe',
        info: errors.publicationNotExist,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
        payload: { publication },
      });
    }

    if (publication.publisher instanceof UnknownMemberImpl) {
      throw createError({
        operationName: 'localPerson._validatePublicationForSubscribe',
        info: errors.unknownMemberType,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
        payload: { publication },
      });
    }

    if (this.subscriptions.find((s) => s.publication.id === publication.id)) {
      throw createError({
        operationName: 'localPerson._validatePublicationForSubscribe',
        info: errors.alreadySubscribedPublication,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
        payload: { publication },
      });
    }
  }

  /**@throws {@link SkyWayError} */
  async unsubscribe(target: string | Subscription) {
    const timestamp = log.info(
      '[start] unsubscribe',
      await createLogPayload({
        operationName: 'localPerson.unsubscribe',
        channel: this.channel,
      })
    );

    const subscriptionId = typeof target === 'string' ? target : target.id;

    if (this.state !== 'joined') {
      throw createError({
        operationName: 'localPerson.unsubscribe',
        info: errors.localPersonNotJoinedChannel,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
      });
    }

    const subscription = this.subscriptions.find(
      (s) => s.id === subscriptionId
    );

    if (!subscription) {
      throw createError({
        operationName: 'localPerson.unsubscribe',
        info: errors.subscriptionNotExist,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
        payload: { subscriptionId },
      });
    }

    delete this._subscribing[subscription.publication.id];

    await this._requestQueue.push(() =>
      this.channel._unsubscribe(subscriptionId)
    );
    log.elapsed(
      timestamp,
      '[end] unsubscribe',
      await createLogPayload({
        operationName: 'localPerson.unsubscribe',
        channel: this.channel,
      }),
      { subscription }
    );
  }

  private _getConnections() {
    const connections = this.channel.members.map((m) =>
      m._getConnection(this.id)
    );

    const active = connections.filter(
      (c): c is SkyWayConnection => c?.closed === false
    );
    return active;
  }

  /**
   * リソース解放
   * - メッセージサービスとのセッション
   * - メディア通信
   * - イベントリスナー
   * - TTL更新
   */
  dispose() {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    log.debug('disposed', this.toJSON());

    clearInterval(this.ttlInterval);

    if (this._signaling) {
      this._signaling.close();
    }

    if (this._analytics) {
      this._analytics.close();
    }

    this._getConnections().forEach((c) =>
      c.close({ reason: 'localPerson disposed' })
    );

    this._onDisposed.emit();
    this._events.dispose();
    this._disposer.dispose();
  }
}

export type PublicationOptions = {
  metadata?: string | undefined;
  /**
   * @description [japanese]
   * publishする際に優先して利用するCodec設定を指定する。
   * 利用するCodecは配列の先頭が優先される。
   */
  codecCapabilities?: Codec[];
  /**
   * @description [japanese]
   * メディアのエンコードの設定を行うことができる。
   * サイマルキャストに対応している通信モデル（SFU）を利用している場合、encodingsの配列に複数のEncodingを設定するとサイマルキャストが有効になる。
   * この時、encodingの配列はビットレートの低い順にソートされて設定される。
   * P2Pを利用している場合、最もビットレートの低い設定のみが適用される。
   */
  encodings?: EncodingParameters[];
  /**
   * @description [japanese]
   * publicationを有効にしてpublishするか指定する。
   * デフォルトではtrueが設定される。
   * falseに設定された場合、publicationは一時停止された状態でpublishされる。
   */
  isEnabled?: boolean;
};

export type SubscriptionOptions = {
  preferredEncodingId?: string;
};
