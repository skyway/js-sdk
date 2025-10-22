import {
  LocalPersonAdapter,
  LocalStream,
  SkyWayChannelImpl,
  SubscriptionImpl,
} from '@skyway-sdk/core';

import {
  LocalP2PRoomMember,
  LocalP2PRoomMemberImpl,
} from '../member/local/p2p';
import { RemoteRoomMemberImpl } from '../member/remote/base';
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
  localRoomMember?: LocalP2PRoomMemberImpl;

  constructor(channel: SkyWayChannelImpl) {
    super('p2p', channel);
  }

  protected _setChannelState() {
    this._channel.members.forEach((m) => {
      const member = new RemoteRoomMemberImpl(m, this);
      this._members[m.id] = member;
    });
    this._channel.publications.forEach((p) => {
      this._addPublication(p);
    });
    this._channel.subscriptions.forEach((s) => {
      this._addSubscription(s as SubscriptionImpl);
    });
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
}
