import { EventDisposer, Logger } from '@skyway-sdk/common';
import { Event } from '@skyway-sdk/common';

import { SkyWayChannelImpl } from '../channel';
import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { Codec } from '../media';
import { ContentType } from '../media/stream';
import { RemoteStream } from '../media/stream/remote';
import { RemoteAudioStream } from '../media/stream/remote/audio';
import { RemoteDataStream } from '../media/stream/remote/data';
import { RemoteVideoStream } from '../media/stream/remote/video';
import {
  RemoteMember,
  RemoteMemberImplInterface,
} from '../member/remoteMember';
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
  /** @description [japanese] unsubscribeした時に発火するイベント */
  onCanceled: Event<void>;
  /** @description [japanese] SubscriptionにStreamが紐つけられた時に発火するイベント */
  onStreamAttached: Event<void>;
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
   * @description [japanese] unsubscribeする
   */
  cancel: () => Promise<void>;
  /** @description [japanese] Streamで優先して受信するエンコード設定の変更 */
  changePreferredEncoding: (id: string) => void;
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

  set stream(stream: T | undefined) {
    this._stream = stream;
    if (stream) {
      this.onStreamAttached.emit();
    }
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
    this.stream = undefined;
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
}

export type SubscriptionState = 'enabled' | 'canceled';
