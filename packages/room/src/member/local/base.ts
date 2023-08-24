import { Event, SkyWayError } from '@skyway-sdk/common';
import {
  LocalPerson,
  LocalPersonAdapter,
  PublicationOptions,
  RemoteAudioStream,
  RemoteDataStream,
  RemoteVideoStream,
  SubscriptionImpl,
  SubscriptionOptions,
} from '@skyway-sdk/core';

import { RoomMember, RoomMemberImpl } from '../../member';
import { RoomPublication } from '../../publication';
import { Room, RoomImpl } from '../../room/base';
import { RoomSubscription } from '../../subscription';
import { RemoteRoomMemberImpl } from '../remote/base';

export interface LocalRoomMember extends RoomMember {
  side: 'local';
  room: Room;
  /**@private */
  _updateRoom(room: Room): void;
  /**
   * @description [japanese] このMemberがStreamをPublishしたときに発火するイベント
   */
  onStreamPublished: Event<{ publication: RoomPublication }>;
  /**
   * @description [japanese] このMemberがStreamをUnPublishしたときに発火するイベント
   */
  onStreamUnpublished: Event<{ publication: RoomPublication }>;
  /**
   * @description [japanese] Publicationの数が変化した時に発火するイベント
   */
  onPublicationListChanged: Event<void>;
  /**
   * @description [japanese] このMemberがStreamをSubscribeしたときに発火するイベント
   */
  onPublicationSubscribed: Event<{
    subscription: RoomSubscription;
    stream: RemoteVideoStream | RemoteAudioStream | RemoteDataStream;
  }>;
  /**
   * @description [japanese] このMemberがStreamをUnsubscribeしたときに発火するイベント
   */
  onPublicationUnsubscribed: Event<{ subscription: RoomSubscription }>;
  /**
   * @description [japanese] Subscriptionの数が変化した時に発火するイベント
   */
  onSubscriptionListChanged: Event<void>;
  /**
   * @description [japanese] 回復不能なエラー。このインスタンスは継続して利用できない。
   */
  readonly onFatalError: Event<SkyWayError>;

  /**
   * @description [japanese] StreamのPublicationをUnpublishする
   */
  unpublish: (publicationId: string | RoomPublication) => Promise<void>;
  /**
   * @description [japanese] StreamのPublicationをSubscribeする
   */
  subscribe: <
    T extends RemoteVideoStream | RemoteAudioStream | RemoteDataStream
  >(
    publicationId: string | RoomPublication,
    options?: SubscriptionOptions
  ) => Promise<{ subscription: RoomSubscription<T>; stream: T }>;
  /**
   * @description [japanese] StreamのSubscriptionをUnsubscribeする
   */
  unsubscribe: (subscriptionId: string | RoomSubscription) => Promise<void>;
}

/**@internal */
export abstract class LocalRoomMemberImpl
  extends RoomMemberImpl
  implements LocalRoomMember
{
  readonly side = 'local';
  readonly _local = this._member as LocalPerson;
  readonly onStreamPublished = new Event<{ publication: RoomPublication }>();
  readonly onStreamUnpublished = new Event<{ publication: RoomPublication }>();
  readonly onPublicationListChanged = new Event<void>();
  readonly onPublicationSubscribed = new Event<{
    subscription: RoomSubscription;
    stream: RemoteVideoStream | RemoteAudioStream | RemoteDataStream;
  }>();
  readonly onPublicationUnsubscribed = new Event<{
    subscription: RoomSubscription;
  }>();
  readonly onSubscriptionListChanged = new Event<void>();
  readonly onFatalError = new Event<SkyWayError>();

  readonly _context = this.room._context;

  /**@private */
  constructor(member: LocalPersonAdapter, room: RoomImpl) {
    super(member, room);

    this._local.onPublicationSubscribed.add(async (e) => {
      const roomSubscription = room._addSubscription(
        e.subscription as SubscriptionImpl
      );
      this.onPublicationSubscribed.emit({
        subscription: roomSubscription,
        stream: e.stream,
      });
    });
    this._local.onFatalError.pipe(this.onFatalError);

    this._listenRoomEvent();

    this.onStreamPublished.add(() => this.onPublicationListChanged.emit());
    this.onStreamUnpublished.add(() => this.onPublicationListChanged.emit());
    this.onPublicationSubscribed.add(() =>
      this.onSubscriptionListChanged.emit()
    );
    this.onPublicationUnsubscribed.add(() =>
      this.onSubscriptionListChanged.emit()
    );
  }

  get subscriptions() {
    return this.member.subscriptions
      .map((s) => this.room._getSubscription(s.id))
      .filter((s) => s.stream);
  }

  protected _listenRoomEvent() {
    this.room.onPublicationUnsubscribed.add((e) => {
      if (
        (e.subscription.subscriber as RemoteRoomMemberImpl)._member.id ===
        this._local.id
      ) {
        this.onPublicationUnsubscribed.emit(e);
      }
    });
  }

  abstract unpublish(publicationId: string | RoomPublication): Promise<void>;
  abstract subscribe<
    T extends RemoteVideoStream | RemoteAudioStream | RemoteDataStream
  >(
    publicationId: string | RoomPublication
  ): Promise<{ subscription: RoomSubscription<T>; stream: T }>;
  abstract unsubscribe(
    subscriptionId: string | RoomSubscription
  ): Promise<void>;

  abstract _updateRoom(room: Room): void;
}

export type RoomPublicationOptions = PublicationOptions & {
  /**sfu only */
  maxSubscribers?: number;
};
