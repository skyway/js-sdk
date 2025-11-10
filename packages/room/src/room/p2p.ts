import {
  LocalPersonAdapter,
  LocalStream,
  PublicationImpl,
  SkyWayChannelImpl,
} from '@skyway-sdk/core';

import {
  LocalP2PRoomMember,
  LocalP2PRoomMemberImpl,
} from '../member/local/p2p';
import { RoomPublication } from '../publication';
import { RoomBase, RoomMemberInit } from './base';
import { Room } from './default';

export interface P2PRoom extends Room {
  /**
   * @description [japanese] RoomにMemberを参加させる
   */
  join: (memberInit?: RoomMemberInit) => Promise<LocalP2PRoomMember>;
}

/**@internal */
export class P2PRoomImpl extends RoomBase implements P2PRoom {
  protected _disableSignaling = false;
  localRoomMember?: LocalP2PRoomMemberImpl;

  constructor(channel: SkyWayChannelImpl) {
    super('p2p', channel);
  }

  protected _getTargetPublication(
    publicationId: string
  ): RoomPublication<LocalStream> | undefined {
    return this._getPublication(publicationId);
  }

  protected _createLocalRoomMember<T extends LocalP2PRoomMemberImpl>(
    local: LocalPersonAdapter,
    room: this
  ): T {
    return new LocalP2PRoomMemberImpl(local, room) as T;
  }

  protected _isAcceptablePublication(p: PublicationImpl): boolean {
    // p2p以外を除外する
    if (p.type !== 'p2p') {
      return false;
    }
    return true;
  }
}
