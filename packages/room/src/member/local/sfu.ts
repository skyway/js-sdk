import { type ErrorInfo, Logger } from '@skyway-sdk/common';
import type { LocalPersonAdapter, LocalStream } from '@skyway-sdk/core';

import { errors } from '../../errors';
import type { RoomPublication } from '../../publication';
import type { SFURoomImpl } from '../../room/sfu';
import type { RoomSubscription } from '../../subscription';
import { createError } from '../../util';
import { LocalRoomMemberBase, type RoomPublicationOptions } from './base';
import type { LocalRoomMember } from './default';

const log = new Logger('packages/room/src/member/local/sfu.ts');

export interface LocalSFURoomMember extends LocalRoomMember {
  /**
   * @description [japanese] RoomにStreamをPublishする
   */
  publish: <T extends LocalStream = LocalStream>(
    stream: T,
    options?: RoomPublicationOptions,
  ) => Promise<RoomPublication<T>>;
}

/**@internal */
export class LocalSFURoomMemberImpl
  extends LocalRoomMemberBase
  implements LocalSFURoomMember
{
  /**@private */
  // biome-ignore lint/complexity/noUselessConstructor: Private constructor is intentional to control instantiation
  constructor(member: LocalPersonAdapter, room: SFURoomImpl) {
    super(member, room);
  }

  async publish<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options: RoomPublicationOptions = {},
  ): Promise<RoomPublication<T>> {
    if (options.type && options.type !== 'sfu') {
      throw createError({
        operationName: 'LocalSFURoomMemberImpl.publish',
        context: this._context,
        room: this.room,
        info: errors.invalidPublicationTypeForSFURoom,
        path: log.prefix,
      });
    }

    const roomPublication = await this._publishAsSFU(stream, options).catch(
      (errorInfo) => {
        throw createError({
          operationName: 'LocalSFURoomMemberImpl.publish',
          context: this._context,
          room: this.room,
          info: errorInfo,
          path: log.prefix,
        });
      },
    );

    return roomPublication as RoomPublication<T>;
  }

  /**
   * @description [japanese] Room上のStreamをUnPublishする
   */
  async unpublish(target: string | RoomPublication) {
    await this._unpublishAsSFU(target).catch((e) => {
      const [errorInfo, error] = e as [ErrorInfo, Error?];
      throw createError({
        operationName: 'LocalSFURoomMemberImpl.unpublish',
        context: this._context,
        room: this.room,
        info: errorInfo,
        path: log.prefix,
        error,
      });
    });
  }

  /**
   * @description [japanese] MemberがSubscribeしているStreamのSubscriptionをUnSubscribeする
   */
  async unsubscribe(target: string | RoomSubscription) {
    await super.unsubscribe(target).catch((e) => {
      const [errorInfo, error] = e as [ErrorInfo, Error];
      throw createError({
        operationName: 'LocalSFURoomMemberImpl.unsubscribe',
        context: this._context,
        room: this.room,
        info: errorInfo,
        path: log.prefix,
        error,
      });
    });
  }
}
