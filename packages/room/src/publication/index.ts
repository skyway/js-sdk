import { EventDisposer, Logger } from '@skyway-sdk/common';
import { Event, Events } from '@skyway-sdk/common';
import {
  Codec,
  ContentType,
  EncodingParameters,
  LocalAudioStream,
  LocalCustomVideoStream,
  LocalStream,
  LocalVideoStream,
  Publication,
  PublicationState,
  ReplaceStreamOptions,
  TransportConnectionState,
  WebRTCStats,
} from '@skyway-sdk/core';
import { Encoding } from '@skyway-sdk/model';
import { SfuBotMember } from '@skyway-sdk/sfu-bot';

import { errors } from '../errors';
import { RoomMember, RoomMemberImpl } from '../member';
import { RoomImpl } from '../room/base';
import { StreamSubscribedEvent, StreamUnsubscribedEvent } from '../room/event';
import { RoomSubscription } from '../subscription';
import { createError } from '../util';

const path = 'packages/room/src/publication/index.ts';
const logger = new Logger(path);

export interface RoomPublication<T extends LocalStream = LocalStream> {
  readonly id: string;
  readonly contentType: ContentType;
  metadata?: string;
  readonly publisher: RoomMember;
  /**
   * @description [japanese] このPublicationをSubscribeしているSubscriptionの一覧
   */
  subscriptions: RoomSubscription[];
  readonly codecCapabilities: Codec[];
  /**
   * @description [japanese] Encode設定
   */
  encodings: EncodingParameters[];
  /**
   * @description [japanese] Publicationの状態
   * - enabled : 配信中
   * - disabled : 配信停止中
   * - canceled : 配信終了
   */
  state: RoomPublicationState;

  /**
   * @description [japanese] publishしたstreamの実体。
   * ローカルで作られたPublicationでなければundefinedとなる
   */
  readonly stream?: T;
  /**
   * @deprecated
   * @use {@link LocalPerson.onStreamUnpublished} or {@link Channel.onStreamUnpublished}
   * @description [japanese] このPublicationがUnPublishされたときに発火するイベント
   */
  readonly onCanceled: Event<void>;
  /**@description [japanese] このPublicationがSubscribeされたときに発火するイベント */
  readonly onSubscribed: Event<StreamSubscribedEvent>;
  /**@description [japanese] このPublicationがUnsubscribeされたときに発火するイベント */
  readonly onUnsubscribed: Event<StreamUnsubscribedEvent>;
  /**@description [japanese] このPublicationをSubscribeするSubscriptionの数が変わったときに発火するイベント */
  readonly onSubscriptionListChanged: Event<void>;
  /**@description [japanese] このPublicationのMetadataが変更された時に発火するイベント */
  readonly onMetadataUpdated: Event<{ metadata: string }>;
  /**@description [japanese] このPublicationが有効化されたときに発火するイベント */
  readonly onEnabled: Event<void>;
  /**@description [japanese] このPublicationが無効化されたときに発火するイベント */
  readonly onDisabled: Event<void>;
  /**@description [japanese] このPublicationの有効化状態が変化したときに発火するイベント */
  readonly onStateChanged: Event<void>;
  /**
   * @description [japanese] メディア通信の状態が変化した時に発火するイベント
   * SFURoomの場合、remoteMemberはundefinedになる
   * SFURoomの場合、memberがルームを離れたときのみ発火する
   */
  readonly onConnectionStateChanged: Event<{
    remoteMember?: RoomMember;
    state: TransportConnectionState;
  }>;

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
  /**@description [japanese] publicationを有効化する */
  enable: () => Promise<void>;
  /**@description [japanese] publicationを無効化する */
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
  getStats(selector: RoomMember | string): Promise<WebRTCStats>;
  /**
   * @experimental
   * @description [japanese] 試験的なAPIです。今後インターフェースや仕様が変更される可能性があります
   * @description [japanese] 対象のMemberとのRTCPeerConnectionを取得する。RTCPeerConnectionを直接操作すると SDK は正しく動作しなくなる可能性があります。
   */
  getRTCPeerConnection(
    selector: RoomMember | string
  ): RTCPeerConnection | undefined;
  /**
   * @description [japanese] メディア通信の状態を取得する
   * @param selector [japanese] 接続相手
   */
  getConnectionState(selector: RoomMember | string): TransportConnectionState;
}

/**@internal */
export class RoomPublicationImpl<StreamType extends LocalStream = LocalStream>
  implements RoomPublication
{
  readonly id: string;
  readonly contentType: ContentType;
  readonly publisher: RoomMemberImpl;
  private readonly _origin?: Publication;
  private readonly _disposer = new EventDisposer();

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
    remoteMember?: RoomMember;
    state: TransportConnectionState;
  }>();

  constructor(public _publication: Publication, private _room: RoomImpl) {
    this.id = _publication.id;
    this.contentType = _publication.contentType;
    this._origin = _publication.origin;

    {
      const publication = this._origin ?? this._publication;
      this.publisher = this._room._getMember(publication.publisher.id);
    }

    this._setEvents();
  }

  private _setEvents() {
    this._room.onStreamUnpublished.add((e) => {
      if (e.publication.id === this.id) {
        this._dispose();
      }
    });

    this._room.onPublicationSubscribed
      .add((e) => {
        if (e.subscription.publication.id === this.id) {
          this.onSubscribed.emit({ subscription: e.subscription });
          this.onSubscriptionListChanged.emit();
        }
      })
      .disposer(this._disposer);
    this._room.onPublicationUnsubscribed
      .add((e) => {
        if (e.subscription.publication.id === this.id) {
          this.onUnsubscribed.emit({ subscription: e.subscription });
          this.onSubscriptionListChanged.emit();
        }
      })
      .disposer(this._disposer);

    this._publication.onEnabled.pipe(this.onEnabled);
    this._publication.onDisabled.pipe(this.onDisabled);
    this._publication.onStateChanged.pipe(this.onStateChanged);

    {
      const publication = this._origin ?? this._publication;
      publication.onMetadataUpdated.pipe(this.onMetadataUpdated);
    }

    if (this._origin) {
      this._origin.onConnectionStateChanged.add((e) => {
        logger.debug('this._origin.onConnectionStateChanged', this.id, e);
        this.onConnectionStateChanged.emit({ state: e.state });
      });
    } else {
      this._publication.onConnectionStateChanged.add((e) => {
        logger.debug('this._publication.onConnectionStateChanged', this.id, e);
        this.onConnectionStateChanged.emit({
          state: e.state,
          remoteMember: this._room._getMember(e.remoteMember.id),
        });
      });
    }
  }

  get subscriptions() {
    return this._publication.subscriptions.map((s) =>
      this._room._getSubscription(s.id)
    );
  }

  private get _preferredPublication() {
    return this._origin ?? this._publication;
  }

  get codecCapabilities() {
    return this._preferredPublication.codecCapabilities;
  }

  get encodings(): Encoding[] {
    return this._preferredPublication.encodings;
  }

  get stream() {
    return this._preferredPublication.stream as StreamType;
  }

  get state() {
    return this._preferredPublication.state;
  }

  get metadata() {
    return this._preferredPublication.metadata;
  }

  /**
   * @deprecated
   * @use {@link LocalPerson.unpublish}
   * @description [japanese] unpublishする
   */
  async cancel() {
    await Promise.all([
      this._preferredPublication.cancel(),
      this.onCanceled.asPromise(),
    ]);
  }

  async updateMetadata(metadata: string) {
    await this._preferredPublication.updateMetadata(metadata);
  }

  updateEncodings(encodings: EncodingParameters[]) {
    this._preferredPublication.updateEncodings(encodings);
  }

  readonly enable = () =>
    new Promise<void>((r, f) => {
      // すでに enabled の場合は何もしない
      if (this.state === 'enabled') {
        r();
        return;
      }

      if (this._origin) {
        Promise.all([
          this._origin.enable(),
          this._publication.onEnabled.asPromise(),
        ])
          .then(() => r())
          .catch(f);
      } else {
        this._publication.enable().then(r).catch(f);
      }
    });

  readonly disable = () =>
    new Promise<void>((r, f) => {
      // すでに disabled の場合は何もしない
      if (this.state === 'disabled') {
        r();
        return;
      }

      if (this._origin) {
        Promise.all([
          this._origin.disable(),
          this._publication.onDisabled.asPromise(),
        ])
          .then(() => r())
          .catch(f);
      } else {
        this._publication.disable().then(r).catch(f);
      }
    });

  readonly replaceStream = (
    stream: LocalAudioStream | LocalVideoStream | LocalCustomVideoStream,
    options: ReplaceStreamOptions = {}
  ) => {
    this._preferredPublication.replaceStream(stream, options);
  };

  private _dispose() {
    this.onCanceled.emit();
    this._events.dispose();
    this._disposer.dispose();
  }

  getStats(selector: string | RoomMember): Promise<WebRTCStats> {
    if (this._origin) {
      const bot = this._origin.subscriptions.find(
        (s) => s.subscriber.subtype === SfuBotMember.subtype
      )?.subscriber;
      if (!bot) {
        throw createError({
          operationName: 'RoomPublicationImpl.getStats',
          room: this._room,
          path,
          info: { ...errors.notFound, detail: 'bot not found' },
        });
      }
      return this._origin.getStats(bot);
    } else {
      const id = typeof selector === 'string' ? selector : selector.id;
      return this._publication.getStats(id);
    }
  }

  getRTCPeerConnection(
    selector: string | RoomMember
  ): RTCPeerConnection | undefined {
    if (this._origin) {
      const bot = this._origin.subscriptions.find(
        (s) => s.subscriber.subtype === SfuBotMember.subtype
      )?.subscriber;
      if (!bot) {
        throw createError({
          operationName: 'RoomPublicationImpl.getRTCPeerConnection',
          room: this._room,
          path,
          info: { ...errors.notFound, detail: 'bot not found' },
        });
      }
      return this._origin.getRTCPeerConnection(bot);
    } else {
      const id = typeof selector === 'string' ? selector : selector.id;
      return this._publication.getRTCPeerConnection(id);
    }
  }

  getConnectionState(selector: string | RoomMember): TransportConnectionState {
    if (this._origin) {
      const bot = this._origin.subscriptions.find(
        (s) => s.subscriber.subtype === SfuBotMember.subtype
      )?.subscriber;
      if (!bot) {
        throw createError({
          operationName: 'RoomPublicationImpl.getConnectionState',
          room: this._room,
          path,
          info: { ...errors.notFound, detail: 'bot not found' },
        });
      }
      return this._origin.getConnectionState(bot);
    } else {
      const id = typeof selector === 'string' ? selector : selector.id;
      return this._publication.getConnectionState(id);
    }
  }

  toJSON() {
    return {
      id: this.id,
      contentType: this.contentType,
      metadata: this.metadata,
      publisher: this.publisher,
      subscriptions: this.subscriptions,
      codecCapabilities: this.codecCapabilities,
      encodings: this.encodings,
      state: this.state,
    };
  }
}

/**
 * @description [japanese] Publicationの状態
 * - enabled : 配信中
 * - disabled : 配信停止中
 * - canceled : 配信終了
 * */
export type RoomPublicationState = PublicationState;
