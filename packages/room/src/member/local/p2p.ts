import { type ErrorInfo, Logger } from '@skyway-sdk/common';
import type { LocalPersonAdapter, LocalStream } from '@skyway-sdk/core';

import { errors } from '../../errors';
import type { RoomPublication } from '../../publication';
import type { P2PRoomImpl } from '../../room/p2p';
import type { RoomSubscription } from '../../subscription';
import { createError } from '../../util';
import { LocalRoomMemberBase, type RoomPublicationOptions } from './base';
import type { LocalRoomMember } from './default';

const log = new Logger('packages/room/src/member/local/p2p.ts');

export interface LocalP2PRoomMember extends LocalRoomMember {
  /**
   * @description [japanese] StreamをPublishする
   */
  publish: <T extends LocalStream = LocalStream>(
    stream: T,
    options?: RoomPublicationOptions,
  ) => Promise<RoomPublication<T>>;
}

/**@internal */
export class LocalP2PRoomMemberImpl
  extends LocalRoomMemberBase
  implements LocalP2PRoomMember
{
  /**@private */
  // biome-ignore lint/complexity/noUselessConstructor: Private constructor is intentional to control instantiation
  constructor(member: LocalPersonAdapter, room: P2PRoomImpl) {
    super(member, room);
  }

  async publish<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options: RoomPublicationOptions = {},
  ): Promise<RoomPublication<T>> {
    if (options.type && options.type !== 'p2p') {
      throw createError({
        operationName: 'LocalP2PRoomMemberImpl.publish',
        context: this._context,
        room: this.room,
        info: errors.invalidPublicationTypeForP2PRoom,
        path: log.prefix,
      });
    }

    const roomPublication = await this._publishAsP2P(stream, options);
    return roomPublication as RoomPublication<T>;
  }

  async unpublish(target: string | RoomPublication) {
    await this._unpublishAsP2P(target).catch((e) => {
      const [errorInfo, error] = e as [ErrorInfo, Error];
      throw createError({
        operationName: 'LocalP2PRoomMemberImpl.unpublish',
        context: this._context,
        room: this.room,
        info: errorInfo,
        path: log.prefix,
        error,
      });
    });
  }

  async unsubscribe(target: string | RoomSubscription) {
    await super.unsubscribe(target).catch((e) => {
      const [errorInfo, error] = e as [ErrorInfo, Error];
      throw createError({
        operationName: 'LocalP2PRoomMemberImpl.unsubscribe',
        context: this._context,
        room: this.room,
        info: errorInfo,
        path: log.prefix,
        error,
      });
    });
  }
}
