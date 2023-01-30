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
  /**@description [japanese] このSubscriptionがUnsubscribeされた時に発火する */
  readonly onCanceled: Event<void>;
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
   * @description [japanese] unsubscribeする
   */
  cancel: () => Promise<void>;
  /**@description [japanese] 優先して受信するエンコード設定を変更する */
  changePreferredEncoding: (id: string) => void;
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
    this._subscription.cancel();
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
}

export type RoomSubscriptionState = SubscriptionState;
