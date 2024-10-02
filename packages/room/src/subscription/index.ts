import { Logger } from '@skyway-sdk/common';
import {
  Codec,
  ContentType,
  Event,
  RemoteAudioStream,
  RemoteDataStream,
  RemoteStream,
  RemoteVideoStream,
  SubscriptionImpl,
  SubscriptionState,
  TransportConnectionState,
  WebRTCStats,
} from '@skyway-sdk/core';

import { errors } from '../errors';
import { RemoteRoomMember } from '../member/remote/base';
import { RoomPublication } from '../publication';
import { RoomImpl } from '../room/base';
import { createError } from '../util';

const log = new Logger('packages/room/src/subscription/index.ts');

export interface RoomSubscription<
  T extends
    | RemoteVideoStream
    | RemoteAudioStream
    | RemoteDataStream = RemoteStream
> {
  readonly id: string;
  readonly contentType: ContentType;
  readonly publication: RoomPublication;
  /**@description [japanese] このSubscriptionにStreamが紐つけられた時に発火する */
  readonly onStreamAttached: Event<void>;
  /**
   * @deprecated
   * @use {@link LocalPerson.onPublicationUnsubscribed} or {@link Channel.onPublicationUnsubscribed}
   * @description [japanese] このSubscriptionがUnsubscribeされた時に発火する
   */
  readonly onCanceled: Event<void>;
  /**
   * @description [japanese] メディア通信の状態が変化した時に発火するイベント
   */
  onConnectionStateChanged: Event<TransportConnectionState>;
  readonly subscriber: RemoteRoomMember;
  /**
   * @description [japanese] subscribeしているStreamの実体。
   * ローカルでSubscribeしているSubscriptionでなければundefinedとなる
   */
  stream?: T;
  codec?: Codec;
  /**
   * @description [japanese] 現在の優先エンコーディング設定
   */
  preferredEncoding?: string;
  state: RoomSubscriptionState;
  /**
   * @deprecated
   * @use {@link LocalPerson.unsubscribe}
   * @description [japanese] unsubscribeする
   */
  cancel: () => Promise<void>;
  /**@description [japanese] 優先して受信するエンコード設定を変更する */
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
export class RoomSubscriptionImpl<
  T extends
    | RemoteVideoStream
    | RemoteAudioStream
    | RemoteDataStream = RemoteStream
> implements RoomSubscription
{
  readonly id: string;
  readonly contentType: ContentType;
  readonly publication: RoomPublication;
  readonly subscriber: RemoteRoomMember;
  readonly _context = this._room._context;

  readonly onStreamAttached = new Event<void>();
  readonly onCanceled = new Event<void>();
  readonly onConnectionStateChanged = new Event<TransportConnectionState>();

  constructor(
    /**@private */
    public _subscription: SubscriptionImpl<T>,
    private _room: RoomImpl
  ) {
    this.id = _subscription.id;
    this.contentType = _subscription.contentType;
    this.publication = this._room._getPublication(_subscription.publication.id);
    this.subscriber = this._room._getMember(_subscription.subscriber.id);

    _subscription.onStreamAttached.pipe(this.onStreamAttached);
    _subscription.onCanceled.pipe(this.onCanceled);
    _subscription.onConnectionStateChanged.add((state) => {
      log.debug('_subscription.onConnectionStateChanged', this.id, state);
      this.onConnectionStateChanged.emit(state);
    });
  }

  get stream() {
    return this._subscription.stream;
  }

  get state() {
    return this._subscription.state;
  }

  get codec() {
    return this._subscription.codec;
  }

  get preferredEncoding() {
    return this._subscription.preferredEncoding;
  }

  changePreferredEncoding(id: string) {
    this._subscription.changePreferredEncoding(id);
  }

  async cancel() {
    this._subscription.cancel().catch((error) => {
      log.error('subscription.cancel', error, this.toJSON());
    });
    await this._room.onPublicationUnsubscribed
      .watch(
        (e) => e.subscription.id === this.id,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw createError({
          operationName: 'RoomSubscriptionImpl.cancel',
          context: this._context,
          room: this._room,
          info: { ...errors.timeout, detail: 'onPublicationUnsubscribed' },
          error,
          path: log.prefix,
        });
      });
  }

  toJSON() {
    return {
      id: this.id,
      contentType: this.contentType,
      publication: this.publication,
      codec: this.codec,
    };
  }

  getStats(): Promise<WebRTCStats> {
    return this._subscription.getStats();
  }

  getRTCPeerConnection(): RTCPeerConnection | undefined {
    return this._subscription.getRTCPeerConnection();
  }

  getConnectionState(): TransportConnectionState {
    return this._subscription.getConnectionState();
  }
}

export type RoomSubscriptionState = SubscriptionState;
