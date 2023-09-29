import { Logger } from '@skyway-sdk/common';
import {
  LocalPersonAdapter,
  LocalStream,
  RemoteAudioStream,
  RemoteDataStream,
  RemoteVideoStream,
  SubscriptionImpl,
} from '@skyway-sdk/core';

import { errors } from '../../errors';
import { RoomPublication } from '../../publication';
import { P2PRoomImpl } from '../../room/p2p';
import { RoomSubscription } from '../../subscription';
import { createError } from '../../util';
import {
  LocalRoomMember,
  LocalRoomMemberImpl,
  RoomPublicationOptions,
} from './base';

const log = new Logger('packages/room/src/member/local/p2p.ts');

export interface LocalP2PRoomMember extends LocalRoomMember {
  /**
   * @description [japanese] StreamをPublishする
   */
  publish: <T extends LocalStream = LocalStream>(
    stream: T,
    options?: RoomPublicationOptions
  ) => Promise<RoomPublication<T>>;
}

/**@internal */
export class LocalP2PRoomMemberImpl
  extends LocalRoomMemberImpl
  implements LocalP2PRoomMember
{
  /**@private */
  constructor(member: LocalPersonAdapter, room: P2PRoomImpl) {
    super(member, room);
  }

  async publish<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options: RoomPublicationOptions = {}
  ): Promise<RoomPublication<T>> {
    const publication = await this._local.publish(stream, options);

    const roomPublication = this.room._addPublication<T>(publication);
    this.onStreamPublished.emit({ publication: roomPublication });

    return roomPublication;
  }

  async unpublish(target: string | RoomPublication) {
    const publicationId = typeof target === 'string' ? target : target.id;
    this._local.unpublish(publicationId).catch((error) => {
      log.error('unpublish', error, { target }, this.toJSON());
    });
    const { publication } = await this.room.onStreamUnpublished
      .watch(
        (e) => e.publication.id === publicationId,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw createError({
          operationName: 'LocalP2PRoomMemberImpl.unpublish',
          context: this._context,
          room: this.room,
          info: { ...errors.timeout, detail: 'onStreamUnpublished' },
          path: log.prefix,
          error,
        });
      });

    this.onStreamUnpublished.emit({ publication });
  }

  async subscribe<
    T extends RemoteVideoStream | RemoteAudioStream | RemoteDataStream
  >(
    target: string | RoomPublication
  ): Promise<{ subscription: RoomSubscription<T>; stream: T }> {
    const publicationId = typeof target === 'string' ? target : target.id;
    const { subscription, stream } = await this._local.subscribe(publicationId);

    const roomSubscription = this.room._addSubscription(
      subscription as SubscriptionImpl
    );

    return {
      subscription: roomSubscription as RoomSubscription<T>,
      stream: stream as T,
    };
  }

  async unsubscribe(target: string | RoomSubscription) {
    const subscriptionId = typeof target === 'string' ? target : target.id;
    this._local.unsubscribe(subscriptionId).catch((error) => {
      log.error('unsubscribe', error, { target }, this.toJSON());
    });
    await this.room.onPublicationUnsubscribed
      .watch(
        (e) => e.subscription.id === subscriptionId,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw createError({
          operationName: 'LocalP2PRoomMemberImpl.unsubscribe',
          context: this._context,
          room: this.room,
          info: { ...errors.timeout, detail: 'onPublicationUnsubscribed' },
          path: log.prefix,
          error,
        });
      });
  }

  _updateRoom(room: P2PRoomImpl): void {
    log.debug('_updateRoom', { memberId: this.id });
    this.room = room;
    this._listenRoomEvent();
  }
}
