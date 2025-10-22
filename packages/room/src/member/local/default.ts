import { ErrorInfo, Logger } from '@skyway-sdk/common';
import { Event, SkyWayError } from '@skyway-sdk/common';
import {
  LocalPerson,
  LocalPersonAdapter,
  LocalStream,
  RemoteAudioStream,
  RemoteDataStream,
  RemoteVideoStream,
  SubscriptionOptions,
} from '@skyway-sdk/core';

import { RoomPublication } from '../../publication';
import { Room, RoomImpl } from '../../room/default';
import { RoomSubscription } from '../../subscription';
import { createError } from '../../util';
import { RoomMember } from '..';
import { LocalRoomMemberBase, RoomPublicationOptions } from './base';

const log = new Logger('packages/room/src/member/local/default.ts');

export interface LocalRoomMember extends RoomMember {
  side: 'local';
  room: Room;
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
   * @description [japanese] RoomにStreamをPublishする
   */
  publish: <T extends LocalStream = LocalStream>(
    stream: T,
    options?: RoomPublicationOptions
  ) => Promise<RoomPublication<T>>;
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

  /**@internal */
  _local: LocalPerson;
}

/**@internal */
export class LocalRoomMemberImpl
  extends LocalRoomMemberBase
  implements LocalRoomMember
{
  /**@private */
  constructor(member: LocalPersonAdapter, room: RoomImpl) {
    super(member, room);
  }

  /**
   * @description [japanese] Room上でStreamをPublishする
   */
  async publish<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options: RoomPublicationOptions = {}
  ): Promise<RoomPublication<T>> {
    if (!options.type) {
      options.type = 'p2p';
    }

    let roomPublication: RoomPublication<LocalStream>;
    if (options.type === 'sfu') {
      roomPublication = await this._publishAsSFU(stream, options).catch(
        (errorInfo) => {
          throw createError({
            operationName: 'LocalRoomMemberImpl.publish',
            context: this._context,
            room: this.room,
            info: errorInfo,
            path: log.prefix,
          });
        }
      );
    } else {
      roomPublication = await this._publishAsP2P(stream, options);
    }

    return roomPublication as RoomPublication<T>;
  }

  /**
   * @description [japanese] Room上のStreamをUnPublishする
   */
  async unpublish(target: string | RoomPublication) {
    const publicationId = typeof target === 'string' ? target : target.id;
    const publication = this.room._getPublication(publicationId);

    try {
      if (publication.type === 'sfu') {
        await this._unpublishAsSFU(target);
      } else {
        await this._unpublishAsP2P(target);
      }
    } catch (e) {
      const [errorInfo, error] = e as [ErrorInfo, Error?];
      throw createError({
        operationName: 'LocalRoomMemberImpl.unpublish',
        context: this._context,
        room: this.room,
        info: errorInfo,
        path: log.prefix,
        error,
      });
    }
  }

  /**
   * @description [japanese] MemberがSubscribeしているStreamのSubscriptionをUnSubscribeする
   */
  async unsubscribe(target: string | RoomSubscription) {
    await super.unsubscribe(target).catch((e) => {
      const [errorInfo, error] = e as [ErrorInfo, Error];
      throw createError({
        operationName: 'LocalRoomMemberImpl.unsubscribe',
        context: this._context,
        room: this.room,
        info: errorInfo,
        path: log.prefix,
        error,
      });
    });
  }
}
