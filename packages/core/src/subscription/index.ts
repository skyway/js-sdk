import { EventDisposer, Logger } from '@skyway-sdk/common';
import { Event } from '@skyway-sdk/common';

import { SkyWayChannelImpl } from '../channel';
import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { Codec } from '../media';
import { ContentType, WebRTCStats } from '../media/stream';
import { RemoteStream } from '../media/stream/remote';
import { RemoteAudioStream } from '../media/stream/remote/audio';
import { RemoteDataStream } from '../media/stream/remote/data';
import { RemoteVideoStream } from '../media/stream/remote/video';
import {
  RemoteMember,
  RemoteMemberImplInterface,
} from '../member/remoteMember';
import { TransportConnectionState } from '../plugin/interface';
import { Publication, PublicationImpl } from '../publication';
import { createError } from '../util';

export * from './factory';

const log = new Logger('packages/core/src/subscription/index.ts');

export interface Subscription<
  T extends
    | RemoteVideoStream
    | RemoteAudioStream
    | RemoteDataStream = RemoteStream
> {
  id: string;
  contentType: ContentType;
  publication: Publication;
  subscriber: RemoteMember;
  state: SubscriptionState;
  /**
   * @deprecated
   * @use {@link LocalPerson.onPublicationUnsubscribed} or {@link Channel.onPublicationUnsubscribed}
   * @description [japanese] unsubscribeした時に発火するイベント
   */
  onCanceled: Event<void>;
  /** @description [japanese] SubscriptionにStreamが紐つけられた時に発火するイベント */
  onStreamAttached: Event<void>;
  /**
   * @description [japanese] メディア通信の状態が変化した時に発火するイベント
   */
  onConnectionStateChanged: Event<TransportConnectionState>;
  /**
   * @description [japanese] subscribeしているStreamの実体。
   * ローカルでSubscribeしているSubscriptionでなければundefinedとなる
   */
  stream?: T;
  /**
   * @description [japanese] Streamのコーデック
   */
  codec?: Codec;
  /**
   * @description [japanese] 現在の優先エンコーディング設定
   */
  preferredEncoding?: string;
  /**
   * @deprecated
   * @use {@link LocalPerson.unsubscribe}
   * @description [japanese] unsubscribeする
   */
  cancel: () => Promise<void>;
  /** @description [japanese] Streamで優先して受信するエンコード設定の変更 */
  changePreferredEncoding: (id: string) => void;
  /**
   * @experimental
   * @description [japanese] RemoteStreamの通信の統計情報を取得する
   */
  getStats(): Promise<WebRTCStats>;
  /**
   * @experimental
   * @description [japanese] 試験的なAPIです。今後インターフェースや仕様が変更される可能性があります
   * @description [japanese] 対象のMemberとのRTCPeerConnectionを取得する。RTCPeerConnectionを直接操作すると SDK は正しく動作しなくなる可能性があります。
   */
  getRTCPeerConnection(): RTCPeerConnection | undefined;
  /**
   * @description [japanese] メディア通信の状態を取得
   */
  getConnectionState(): TransportConnectionState;
}

/**@internal */
export class SubscriptionImpl<
  T extends
    | RemoteVideoStream
    | RemoteAudioStream
    | RemoteDataStream = RemoteStream
> implements Subscription<T>
{
  readonly id: string;
  readonly contentType: ContentType;
  readonly subscriber: RemoteMemberImplInterface;
  readonly publication: PublicationImpl;
  private readonly _channel: SkyWayChannelImpl;
  private readonly _context: SkyWayContext;
  private readonly _disposer = new EventDisposer();

  private _state: SubscriptionState = 'enabled';
  get state() {
    return this._state;
  }
  codec?: Codec;
  preferredEncoding?: string;
  private _stream?: T;
  readonly onCanceled = new Event<void>();
  readonly onStreamAttached = new Event<void>();
  readonly onConnectionStateChanged = new Event<TransportConnectionState>();

  /**@internal */
  readonly _onChangeEncoding = new Event<void>();

  constructor(args: {
    channel: SkyWayChannelImpl;
    id: string;
    contentType: ContentType;
    subscriber: RemoteMemberImplInterface;
    publication: PublicationImpl;
  }) {
    this._channel = args.channel;
    this._context = this._channel._context;
    this.id = args.id;
    this.contentType = args.contentType;
    this.subscriber = args.subscriber;
    this.publication = args.publication;

    log.debug('subscription spawned', this.toJSON());

    this._handlePublicationEnabled();
  }

  private _handlePublicationEnabled() {
    this.publication.onDisabled
      .add(() => {
        if (this.stream) {
          log.debug('disabled', this);
          this.stream.setIsEnabled(false);
        }
      })
      .disposer(this._disposer);
    this.publication.onEnabled
      .add(() => {
        if (this.stream) {
          log.debug('enabled', this);
          this.stream.setIsEnabled(true);
        }
      })
      .disposer(this._disposer);
    if (this.stream) {
      this.stream.setIsEnabled(this.publication.state === 'enabled');
    }
  }

  /**@internal */
  _setStream(stream: T) {
    this._stream = stream;
    this.onStreamAttached.emit();
    stream._onConnectionStateChanged.add((e) => {
      log.debug('onConnectionStateChanged', this.id, e);
      this.onConnectionStateChanged.emit(e);
    });
  }

  get stream() {
    return this._stream;
  }

  toJSON() {
    return {
      id: this.id,
      contentType: this.contentType,
      subscriber: this.subscriber,
      publication: this.publication,
      channelId: this._channel.id,
      state: this.state,
      stream: this.stream,
    };
  }

  /**@private */
  _canceled() {
    this._state = 'canceled';
    this.onCanceled.emit();

    this._disposer.dispose();
  }

  cancel = () =>
    new Promise<void>((r, f) => {
      let failed = false;
      this._channel._unsubscribe(this.id).catch((e) => {
        failed = true;
        f(e);
      });
      this.onCanceled
        .asPromise(this._context.config.rtcApi.timeout)
        .then(() => r())
        .catch((e) => {
          if (!failed) f(e);
        });
    });

  changePreferredEncoding(id: string) {
    if (!this.stream) {
      throw createError({
        operationName: 'SubscriptionImpl.changePreferredEncoding',
        info: errors.streamNotExistInSubscription,
        path: log.prefix,
        context: this._context,
        channel: this._channel,
      });
    }
    if (this.stream.contentType === 'data') {
      throw createError({
        operationName: 'SubscriptionImpl.changePreferredEncoding',
        info: errors.dataStreamNotSupportEncoding,
        path: log.prefix,
        context: this._context,
        channel: this._channel,
      });
    }
    if (!this.publication.encodings.map((e) => e.id).includes(id)) {
      throw createError({
        operationName: 'SubscriptionImpl.changePreferredEncoding',
        info: errors.correspondingEncodeNotExistForId,
        path: log.prefix,
        context: this._context,
        channel: this._channel,
      });
    }
    this.preferredEncoding = id;
    this._onChangeEncoding.emit();
  }

  getStats(): Promise<WebRTCStats> {
    if (!this.stream) {
      throw createError({
        operationName: 'SubscriptionImpl.getStats',
        info: errors.streamNotExistInSubscription,
        path: log.prefix,
        context: this._context,
        channel: this._channel,
      });
    }
    return this.stream._getStats();
  }

  getRTCPeerConnection(): RTCPeerConnection | undefined {
    if (!this.stream) {
      throw createError({
        operationName: 'SubscriptionImpl.getRTCPeerConnection',
        info: errors.streamNotExistInSubscription,
        path: log.prefix,
        context: this._context,
        channel: this._channel,
      });
    }
    return this.stream._getRTCPeerConnection();
  }

  getConnectionState(): TransportConnectionState {
    if (!this.stream) {
      throw createError({
        operationName: 'SubscriptionImpl.getConnectionState',
        info: errors.streamNotExistInSubscription,
        path: log.prefix,
        context: this._context,
        channel: this._channel,
      });
    }
    return this.stream._getConnectionState();
  }
}

export type SubscriptionState = 'enabled' | 'canceled';
