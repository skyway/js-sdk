import { EventDisposer, Events, Logger } from '@skyway-sdk/common';
import { Event } from '@skyway-sdk/common';
import { Encoding } from '@skyway-sdk/model';

import { SkyWayChannelImpl } from '../channel';
import {
  StreamSubscribedEvent,
  StreamUnsubscribedEvent,
} from '../channel/event';
import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { AnalyticsSession } from '../external/analytics';
import { Codec, EncodingParameters } from '../media';
import { ContentType, WebRTCStats } from '../media/stream';
import { LocalMediaStreamBase, LocalStream } from '../media/stream/local';
import { LocalAudioStream } from '../media/stream/local/audio';
import { LocalCustomVideoStream } from '../media/stream/local/customVideo';
import { LocalDataStream } from '../media/stream/local/data';
import { LocalVideoStream } from '../media/stream/local/video';
import { Member } from '../member';
import {
  RemoteMember,
  RemoteMemberImplInterface,
} from '../member/remoteMember';
import { TransportConnectionState } from '../plugin/interface';
import { Subscription } from '../subscription';
import { createError, createLogPayload, createWarnPayload } from '../util';

export * from './factory';

const log = new Logger('packages/core/src/publication/index.ts');

export interface Publication<T extends LocalStream = LocalStream> {
  readonly id: string;
  readonly contentType: ContentType;
  metadata?: string;
  readonly publisher: Member;
  readonly subscriptions: Subscription[];
  readonly origin?: Publication;
  readonly codecCapabilities: Codec[];
  readonly encodings: Encoding[];
  /**
   * @description [japanese] publishしたstreamの実体。
   * ローカルで作られたPublicationでなければundefinedとなる
   */
  stream?: T;
  state: PublicationState;

  //--------------------

  /**
   * @deprecated
   * @use {@link LocalPerson.onStreamUnpublished} or {@link Channel.onStreamUnpublished}
   * @description [japanese] Unpublishされた時に発火するイベント
   */
  onCanceled: Event<void>;
  /** @description [japanese] Subscribeされた時に発火するイベント */
  onSubscribed: Event<StreamSubscribedEvent>;
  /** @description [japanese] このPublicationをSubscribeしたSubscriptionがUnsubscribeされた時に発火するイベント */
  onUnsubscribed: Event<StreamUnsubscribedEvent>;
  /** @description [japanese] このPublicationをSubscribeしたSubscriptionの数が変化した時に発火するイベント */
  onSubscriptionListChanged: Event<void>;
  /** @description [japanese] Metadataが変更された時に発火するイベント */
  onMetadataUpdated: Event<{ metadata: string }>;
  /** @description [japanese] 有効化された時に発火するイベント */
  onEnabled: Event<void>;
  /** @description [japanese] 無効化された時に発火するイベント */
  onDisabled: Event<void>;
  /** @description [japanese] stateが変化した時に発火するイベント */
  onStateChanged: Event<void>;
  /**
   * @description [japanese] メディア通信の状態が変化した時に発火するイベント
   */
  onConnectionStateChanged: Event<{
    remoteMember: RemoteMember;
    state: TransportConnectionState;
  }>;

  //--------------------

  /**
   * @description [japanese] Metadataの更新
   */
  updateMetadata: (metadata: string) => Promise<void>;
  /**
   * @deprecated
   * @use {@link LocalPerson.unpublish}
   * @description [japanese] unpublishする
   */
  cancel: () => Promise<void>;
  /**
   * @description [japanese] Video|Audio Streamの場合、encoding設定を更新する
   */
  updateEncodings: (encodings: EncodingParameters[]) => void;
  /** @description [japanese] 有効化する */
  /**@throws {SkyWayError} */
  enable: () => Promise<void>;
  /** @description [japanese] 無効化する */
  disable: () => Promise<void>;
  /**
   * @description [japanese] Publicationのstreamを同じContentTypeの別のStreamに入れ替える。
   * dataStreamを入れ替えることはできない。
   * RemoteのPublication(streamがnull)では利用不可。
   */
  replaceStream: (
    stream: LocalAudioStream | LocalVideoStream | LocalCustomVideoStream,
    options?: ReplaceStreamOptions
  ) => void;
  /**
   * @experimental
   * @description [japanese] 試験的なAPIです。今後インターフェースや仕様が変更される可能性があります
   * @description [japanese] StreamをSubscribeしているMemberとの通信の統計情報を取得する
   */
  getStats(selector: Member | string): Promise<WebRTCStats>;
  /**
   * @experimental
   * @description [japanese] 試験的なAPIです。今後インターフェースや仕様が変更される可能性があります
   * @description [japanese] 対象のMemberとのRTCPeerConnectionを取得する。RTCPeerConnectionを直接操作すると SDK は正しく動作しなくなる可能性があります。
   */
  getRTCPeerConnection(
    selector: Member | string
  ): RTCPeerConnection | undefined;
  /**
   * @description [japanese] メディア通信の状態を取得する
   * @param selector [japanese] 接続相手
   */
  getConnectionState(selector: Member | string): TransportConnectionState;
}

/**@internal */
export class PublicationImpl<T extends LocalStream = LocalStream>
  implements Publication
{
  readonly id: string;
  readonly contentType: ContentType;
  readonly publisher: RemoteMemberImplInterface;
  private _codecCapabilities: Codec[] = [];
  get codecCapabilities() {
    return this._codecCapabilities;
  }
  setCodecCapabilities(_codecCapabilities: Codec[]) {
    this._codecCapabilities = _codecCapabilities;
  }
  private _encodings: Encoding[] = [];
  get encodings() {
    return this._encodings;
  }
  setEncodings(_encodings: Encoding[]) {
    this._encodings = _encodings;
  }
  private _stream?: T;
  get stream(): T | undefined {
    return this._stream;
  }
  /**@internal */
  _setStream(stream: LocalStream | undefined) {
    this._stream = stream as T;
    if (stream) {
      stream._onConnectionStateChanged
        .add((e) => {
          log.debug('onConnectionStateChanged', this.id, e);
          this.onConnectionStateChanged.emit(e);
        })
        .disposer(this.streamEventDisposer);
    } else {
      this.streamEventDisposer.dispose();
    }
  }
  /**@private */
  readonly _channel: SkyWayChannelImpl;
  origin?: PublicationImpl;

  private _metadata?: string;
  get metadata() {
    return this._metadata;
  }
  private _state: PublicationState = 'enabled';
  get state() {
    return this._state;
  }

  get deviceName(): string | undefined {
    if (this.stream instanceof LocalDataStream) {
      return undefined;
    } else {
      const withDeviceStream = this.stream as
        | LocalVideoStream
        | LocalCustomVideoStream
        | LocalAudioStream;
      return withDeviceStream.track.label;
    }
  }

  private readonly _events = new Events();
  readonly onCanceled = this._events.make<void>();
  readonly onSubscribed = this._events.make<StreamSubscribedEvent>();
  readonly onUnsubscribed = this._events.make<StreamUnsubscribedEvent>();
  readonly onSubscriptionListChanged = this._events.make<void>();
  readonly onMetadataUpdated = this._events.make<{ metadata: string }>();
  readonly onEnabled = this._events.make<void>();
  readonly onDisabled = this._events.make<void>();
  readonly onStateChanged = this._events.make<void>();
  readonly onConnectionStateChanged = new Event<{
    remoteMember: RemoteMember;
    state: TransportConnectionState;
  }>();
  /**@private */
  readonly _onEncodingsChanged = this._events.make<EncodingParameters[]>();
  /**@private */
  readonly _onReplaceStream = this._events.make<{
    newStream: LocalMediaStreamBase;
    oldStream: LocalMediaStreamBase;
  }>();
  private readonly _onEnabled = this._events.make<void>();
  private streamEventDisposer = new EventDisposer();
  /**@private */
  readonly _analytics?: AnalyticsSession;

  private _context: SkyWayContext;

  constructor(args: {
    channel: SkyWayChannelImpl;
    id: string;
    publisher: RemoteMemberImplInterface;
    contentType: ContentType;
    metadata?: string;
    origin?: PublicationImpl;
    codecCapabilities?: Codec[];
    encodings?: EncodingParameters[];
    stream?: T;
    isEnabled: boolean;
  }) {
    this.id = args.id;
    this._channel = args.channel;
    this._context = this._channel._context;
    this.publisher = args.publisher;
    this.contentType = args.contentType;
    this._metadata = args.metadata;
    this.origin = args.origin;
    this.setCodecCapabilities(args.codecCapabilities ?? []);
    this.setEncodings(normalizeEncodings(args.encodings ?? []));
    this._state = args.isEnabled ? 'enabled' : 'disabled';
    if (args.stream) {
      this._setStream(args.stream);
    }
    this._analytics = this._channel.localPerson?._analytics;

    log.debug('publication spawned', this.toJSON());
  }

  get subscriptions(): Subscription[] {
    return this._channel.subscriptions.filter(
      (s) => s.publication.id === this.id
    );
  }

  /**@private */
  _updateMetadata(metadata: string) {
    this._metadata = metadata;
    this.onMetadataUpdated.emit({ metadata });
  }

  /**@private */
  async _disable() {
    await this._disableStream();

    this.onDisabled.emit();
    this.onStateChanged.emit();
  }

  /**@private */
  _enable() {
    if (this.stream) {
      this._onEnabled.emit();
    } else {
      this._state = 'enabled';
      this.onEnabled.emit();
      this.onStateChanged.emit();
    }
  }

  /**@private */
  _unpublished() {
    this._state = 'canceled';

    if (this.stream) {
      this.stream._unpublished();
    }

    this.onCanceled.emit();
    this.onStateChanged.emit();

    this._dispose();
  }

  /**@private */
  _subscribed(subscription: Subscription) {
    this.onSubscribed.emit({ subscription });
    this.onSubscriptionListChanged.emit();
  }

  /**@private */
  _unsubscribed(subscription: Subscription) {
    this.onUnsubscribed.emit({ subscription });
    this.onSubscriptionListChanged.emit();
  }

  /**
   * @deprecated
   * @use {@link LocalPerson.unpublish}
   */
  cancel = () =>
    new Promise<void>((r, f) => {
      let failed = false;
      this._channel._unpublish(this.id).catch((e) => {
        failed = true;
        f(e);
      });
      this._setStream(undefined);
      this.onCanceled
        .asPromise(this._context.config.rtcApi.timeout)
        .then(() => r())
        .catch((e) => {
          if (!failed) {
            f(e);
          }
        });
    });

  updateMetadata = (metadata: string) =>
    new Promise<void>(async (r, f) => {
      const timestamp = log.info(
        '[start] updateMetadata',
        await createLogPayload({
          operationName: 'Publication.updateMetadata',
          channel: this._channel,
        }),
        this
      );

      let failed = false;
      this._channel._updatePublicationMetadata(this.id, metadata).catch((e) => {
        failed = true;
        f(e);
      });
      this.onMetadataUpdated
        .watch(
          (e) => e.metadata === metadata,
          this._context.config.rtcApi.timeout
        )
        .then(async () => {
          r();
          log.elapsed(
            timestamp,
            '[end] updateMetadata',
            await createLogPayload({
              operationName: 'Publication.updateMetadata',
              channel: this._channel,
            }),
            this
          );
        })
        .catch((error) => {
          if (!failed) {
            throw createError({
              operationName: 'PublicationImpl.updateMetadata',
              info: {
                ...errors.timeout,
                detail: 'publication onMetadataUpdated',
              },
              path: log.prefix,
              context: this._context,
              channel: this._channel,
              error,
            });
          }
        });
    });

  updateEncodings(encodings: EncodingParameters[]) {
    log.info('updateEncodings', { encodings }, this);
    this.setEncodings(normalizeEncodings(sortEncodingParameters(encodings)));
    this._onEncodingsChanged.emit(encodings);

    if (this._analytics && !this._analytics.isClosed()) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this._analytics.client.sendPublicationUpdateEncodingsReport({
        publicationId: this.id,
        encodings: this.encodings,
        updatedAt: Date.now(),
      });
    }
  }

  disable = () =>
    new Promise<void>(async (r, f) => {
      // すでに disabled の場合は何もしない
      if (this.state === 'disabled') {
        r();
        return;
      }

      const timestamp = log.info(
        '[start] disable',
        await createLogPayload({
          operationName: 'Publication.disable',
          channel: this._channel,
        }),
        this
      );

      await this._disableStream();

      let failed = false;
      this._channel._disablePublication(this.id).catch((e) => {
        failed = true;
        f(e);
      });
      this.onDisabled
        .asPromise(this._context.config.rtcApi.timeout)
        .then(async () => {
          r();
          log.elapsed(
            timestamp,
            '[end] disable',
            await createLogPayload({
              operationName: 'Publication.disable',
              channel: this._channel,
            }),
            this
          );
        })
        .catch((e) => {
          if (!failed) {
            f(e);
          }
        });
    });

  private async _disableStream() {
    if (this.state === 'disabled') {
      return;
    }
    this._state = 'disabled';
    if (!this.stream) {
      return;
    }

    if (this.stream.contentType === 'data') {
      this.stream.setIsEnabled(false);
    } else {
      await this.stream.setEnabled(false).catch((e) => {
        log.warn(
          createWarnPayload({
            channel: this._channel,
            operationName: 'Publication._disableStream',
            payload: e,
            detail: 'setEnabled failed',
          })
        );
      });
    }

    createLogPayload({
      operationName: 'Publication._disableStream',
      channel: this._channel,
    })
      .then((p) =>
        log.info('publication _disableStream', p, { publication: this })
      )
      .catch(() => {});
  }

  enable = () =>
    new Promise<void>(async (r, f) => {
      if (this.stream == undefined) {
        f(
          createError({
            operationName: 'Publication.enable',
            context: this._context,
            info: errors.canNotEnableRemotePublication,
            path: log.prefix,
          })
        );
        return;
      }

      // すでに enabled の場合は何もしない
      if (this.state === 'enabled') {
        r();
        return;
      }

      const timestamp = log.info(
        '[start] enable',
        await createLogPayload({
          operationName: 'Publication.enable',
          channel: this._channel,
        }),
        this
      );

      let failed = false;
      this._channel._enablePublication(this.id).catch((e) => {
        failed = true;
        f(e);
      });
      this._onEnabled
        .asPromise(this._context.config.rtcApi.timeout)
        .then(async () => {
          await this._enableStream();

          this.onEnabled.emit();
          this.onStateChanged.emit();

          log.elapsed(
            timestamp,
            '[end] enable',
            await createLogPayload({
              operationName: 'Publication.enable',
              channel: this._channel,
            }),
            this
          );

          r();
        })
        .catch((e) => {
          if (!failed) {
            f(e);
          }
        });
    });

  private async _enableStream() {
    if (this.state === 'enabled') {
      return;
    }
    this._state = 'enabled';
    if (!this.stream) {
      return;
    }

    createLogPayload({
      operationName: 'Publication._enableStream',
      channel: this._channel,
    })
      .then((p) =>
        log.info('publication _enableStream', p, { publication: this })
      )
      .catch(() => {});

    if (this.stream.contentType === 'data') {
      this.stream.setIsEnabled(true);
    } else {
      await this.stream.setEnabled(true).catch((e) => {
        log.warn(
          createWarnPayload({
            channel: this._channel,
            operationName: 'Publication._disableStream',
            payload: e,
            detail: 'setEnabled failed',
          })
        );
      });
    }
  }

  replaceStream(
    stream: LocalAudioStream | LocalVideoStream | LocalCustomVideoStream,
    options: ReplaceStreamOptions = {}
  ) {
    log.info('replaceStream', { stream, options }, this);

    if (!this.stream) {
      throw createError({
        operationName: 'PublicationImpl.replaceStream',
        context: this._context,
        info: errors.canNotUseReplaceStream,
        path: log.prefix,
      });
    }
    if (stream.contentType !== this.contentType) {
      throw createError({
        operationName: 'PublicationImpl.replaceStream',
        context: this._context,
        info: errors.invalidContentType,
        path: log.prefix,
      });
    }

    if (options.releaseOldStream ?? true) {
      const old = this.stream as LocalMediaStreamBase;
      old.release();
    }

    createLogPayload({
      operationName: 'PublicationImpl.replaceStream',
      channel: this._channel,
    })
      .then((res) => log.debug(res, { old: this.stream, new: stream }))
      .catch((e) => e);

    stream.setEnabled(this.stream.isEnabled).catch((e) => {
      log.error('replaceStream stream.setEnabled', e, this.toJSON());
    });
    const oldStream = this._stream as LocalMediaStreamBase;
    this._setStream(stream as T);

    this._onReplaceStream.emit({ newStream: stream, oldStream });

    if (this._analytics && !this._analytics.isClosed()) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this._analytics.client.sendMediaDeviceReport({
        publicationId: this.id,
        mediaDeviceName: this.deviceName as string,
        mediaDeviceTrigger: 'replaceStream',
        updatedAt: Date.now(),
      });
    }
  }

  getStats(selector: string | Member): Promise<WebRTCStats> {
    if (!this.stream) {
      throw createError({
        operationName: 'PublicationImpl.getStats',
        context: this._context,
        info: errors.streamNotExistInSubscription,
        path: log.prefix,
      });
    }
    return this.stream._getStats(selector);
  }

  getRTCPeerConnection(
    selector: string | Member
  ): RTCPeerConnection | undefined {
    if (!this.stream) {
      throw createError({
        operationName: 'PublicationImpl.getRTCPeerConnection',
        context: this._context,
        info: errors.streamNotExistInSubscription,
        path: log.prefix,
      });
    }
    return this.stream._getRTCPeerConnection(selector);
  }

  getConnectionState(selector: string | Member): TransportConnectionState {
    if (!this.stream) {
      throw createError({
        operationName: 'PublicationImpl.getConnectionState',
        context: this._context,
        info: errors.streamNotExistInSubscription,
        path: log.prefix,
      });
    }
    return this.stream._getConnectionState(selector);
  }

  /**@private */
  toJSON() {
    return {
      id: this.id,
      channelId: this._channel.id,
      publisherId: this.publisher.id,
      origin: this.origin?.id,
      contentType: this.contentType,
      metadata: this.metadata,
      codecCapabilities: this.codecCapabilities,
      encodings: this.encodings,
      state: this.state,
      stream: this.stream,
    };
  }

  private _dispose() {
    this._events.dispose();
  }
}

/**
 * @description [japanese] Publicationの状態
 * - enabled : 配信中
 * - disabled : 配信停止中
 * - canceled : 配信終了
 * */
export type PublicationState = 'enabled' | 'disabled' | 'canceled';

/**@internal */
export const normalizeEncodings = (
  encodings: EncodingParameters[]
): Encoding[] =>
  encodings.map((e, i) => ({
    ...e,
    id: e.id ?? i.toString(),
  }));

export const sortEncodingParameters = (
  encodings: EncodingParameters[]
): EncodingParameters[] => {
  const [encode] = encodings;
  if (encode.maxBitrate) {
    // 小から大
    return encodings.sort((a, b) => a.maxBitrate! - b.maxBitrate!);
  } else if (encode.scaleResolutionDownBy) {
    //大から小
    return encodings.sort(
      (a, b) => b.scaleResolutionDownBy! - a.scaleResolutionDownBy!
    );
  } else if (encode.maxFramerate) {
    // 小から大
    return encodings.sort((a, b) => a.maxFramerate! - b.maxFramerate!);
  }
  return encodings;
};

export type ReplaceStreamOptions = {
  /**@description [japanese] 入れ替え前のstreamを開放する。デフォルトで有効 */
  releaseOldStream?: boolean;
};
