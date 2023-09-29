import { Logger } from '@skyway-sdk/common';
import {
  LocalDataStream,
  LocalPersonAdapter,
  LocalStream,
  RemoteAudioStream,
  RemoteDataStream,
  RemoteVideoStream,
  SubscriptionImpl,
  SubscriptionOptions,
} from '@skyway-sdk/core';
import { errors as sfuErrors, SfuBotMember } from '@skyway-sdk/sfu-bot';

import { defaultMaxSubscribers } from '../../const';
import { errors } from '../../errors';
import { RoomPublication } from '../../publication';
import { SfuRoomImpl } from '../../room/sfu';
import { RoomSubscription } from '../../subscription';
import { createError } from '../../util';
import {
  LocalRoomMember,
  LocalRoomMemberImpl,
  RoomPublicationOptions,
} from './base';

const log = new Logger('packages/room/src/member/local/sfu.ts');

export interface LocalSFURoomMember extends LocalRoomMember {
  /**
   * @description [japanese] RoomにStreamをPublishする
   */
  publish: <T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options?: RoomPublicationOptions & SfuRoomPublicationOptions
  ) => Promise<RoomPublication<T>>;
}

/**@internal */
export class LocalSFURoomMemberImpl
  extends LocalRoomMemberImpl
  implements LocalSFURoomMember
{
  /**@private */
  constructor(member: LocalPersonAdapter, room: SfuRoomImpl) {
    super(member, room);
  }

  async publish<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options: RoomPublicationOptions & SfuRoomPublicationOptions = {}
  ): Promise<RoomPublication<T>> {
    if (stream instanceof LocalDataStream) {
      throw createError({
        operationName: 'LocalSFURoomMemberImpl.publish',
        context: this._context,
        room: this.room,
        info: errors.sfuRoomNotSupportDataStream,
        path: log.prefix,
      });
    }

    options.maxSubscribers = options.maxSubscribers ?? defaultMaxSubscribers;

    const origin = await this._local.publish(stream, options);
    const bot = this.room._channel.members.find(
      (m) => m.subtype === SfuBotMember.subtype
    ) as SfuBotMember;
    if (!bot) {
      throw createError({
        operationName: 'LocalSFURoomMemberImpl.publish',
        context: this._context,
        room: this.room,
        info: sfuErrors.sfuBotNotInChannel,
        path: log.prefix,
      });
    }

    const forwarding = await bot.startForwarding(origin, {
      maxSubscribers: options.maxSubscribers,
    });
    const relayingPublication = forwarding.relayingPublication;

    const roomPublication = this.room._addPublication<T>(relayingPublication);
    this.onStreamPublished.emit({ publication: roomPublication });

    return roomPublication;
  }

  /**
   * @description [japanese] Room上のStreamをUnPublishする
   */
  async unpublish(target: string | RoomPublication) {
    const publicationId = typeof target === 'string' ? target : target.id;
    const publication = this.room._getPublication(publicationId);
    const origin = publication._publication.origin;
    if (!origin) {
      throw createError({
        operationName: 'LocalSFURoomMemberImpl.unpublish',
        context: this._context,
        room: this.room,
        info: errors.publicationNotHasOrigin,
        path: log.prefix,
      });
    }

    this._local.unpublish(origin.id).catch((error) => {
      log.error('unpublish error', error, { target }, this.toJSON());
    });
    await this.room.onStreamUnpublished
      .watch(
        (e) => e.publication.id === publicationId,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw createError({
          operationName: 'LocalSFURoomMemberImpl.unpublish',
          context: this._context,
          room: this.room,
          info: { ...errors.timeout, detail: 'onStreamUnpublished' },
          path: log.prefix,
          error,
        });
      });

    this.onStreamUnpublished.emit({ publication });
  }

  /**
   * @description [japanese] MemberがRoom上のStreamのPublicationをSubscribeする
   */
  async subscribe<
    T extends RemoteVideoStream | RemoteAudioStream | RemoteDataStream
  >(
    target: string | RoomPublication,
    options?: SubscriptionOptions
  ): Promise<{ subscription: RoomSubscription<T>; stream: T }> {
    const publicationId = typeof target === 'string' ? target : target.id;
    const { subscription, stream } = await this._local.subscribe(
      publicationId,
      options
    );

    const roomSubscription = this.room._addSubscription(
      subscription as SubscriptionImpl
    );

    return {
      subscription: roomSubscription as RoomSubscription<T>,
      stream: stream as T,
    };
  }

  /**
   * @description [japanese] MemberがSubscribeしているStreamのSubscriptionをUnSubscribeする
   */
  async unsubscribe(target: string | RoomSubscription) {
    const subscriptionId = typeof target === 'string' ? target : target.id;
    this._local.unsubscribe(subscriptionId).catch((error) => {
      log.error('unsubscribe error', error, { target }, this.toJSON());
    });
    await this.room.onPublicationUnsubscribed
      .watch(
        (e) => e.subscription.id === subscriptionId,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw createError({
          operationName: 'LocalSFURoomMemberImpl.unsubscribe',
          context: this._context,
          room: this.room,
          info: { ...errors.timeout, detail: 'onPublicationUnsubscribed' },
          path: log.prefix,
          error,
        });
      });
  }

  _updateRoom(room: SfuRoomImpl): void {
    log.debug('_updateRoom', { memberId: this.id });
    this.room = room;
    this._listenRoomEvent();
  }
}

export type SfuRoomPublicationOptions = {
  maxSubscribers?: number;
};
