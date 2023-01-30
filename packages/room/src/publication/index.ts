import { EventDisposer } from '@skyway-sdk/common';
import { Event, Events } from '@skyway-sdk/common';
import {
  Codec,
  ContentType,
  EncodingParameters,
  LocalAudioStream,
  LocalStream,
  LocalVideoStream,
  Publication,
  PublicationState,
  ReplaceStreamOptions,
} from '@skyway-sdk/core';

import { RoomMember, RoomMemberImpl } from '../member';
import { RoomImpl } from '../room/base';
import { StreamSubscribedEvent, StreamUnsubscribedEvent } from '../room/event';
import { RoomSubscription } from '../subscription';

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
  /**@description [japanese] このPublicationがUnPublishされたときに発火するイベント */
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
   * @description [japanese] Metadataの更新
   */
  updateMetadata: (metadata: string) => Promise<void>;
  /**
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
    stream: LocalAudioStream | LocalVideoStream,
    options?: ReplaceStreamOptions
  ) => void;
}

/**@internal */
export class RoomPublicationImpl<StreamType extends LocalStream = LocalStream>
  implements RoomPublication
{
  readonly id: string;
  readonly contentType: ContentType;
  readonly codecCapabilities: Codec[];
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

  constructor(public _publication: Publication, private _room: RoomImpl) {
    this.id = _publication.id;
    this.contentType = _publication.contentType;
    this._origin = _publication.origin;

    {
      const publication = this._origin ?? this._publication;
      this.codecCapabilities = publication.codecCapabilities;
      this.publisher = this._room._getMember(publication.publisher.id);
    }

    this._setEvents();
  }

  private _setEvents() {
    this._room.onStreamUnpublished.add((e) => {
      if (e.publication.id === this.id) {
        this.onCanceled.emit();
        this._events.dispose();
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
  }

  get subscriptions() {
    return this._publication.subscriptions.map((s) =>
      this._room._getSubscription(s.id)
    );
  }

  private get _preferredPublication() {
    return this._origin ?? this._publication;
  }

  get encodings() {
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
    stream: LocalAudioStream | LocalVideoStream,
    options: ReplaceStreamOptions = {}
  ) => {
    this._preferredPublication.replaceStream(stream, options);
  };

  /**@internal */
  _dispose() {
    this._disposer.dispose();
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
