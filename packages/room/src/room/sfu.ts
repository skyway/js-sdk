import {
  LocalPersonAdapter,
  PublicationImpl,
  SkyWayChannelImpl,
  SkyWayContext,
} from '@skyway-sdk/core';
import { SFUBotPlugin } from '@skyway-sdk/sfu-bot';

import {
  LocalSFURoomMember,
  LocalSFURoomMemberImpl,
} from '../member/local/sfu';
import { RoomPublicationImpl } from '../publication';
import { RoomBase, RoomMemberInit } from './base';
import { Room } from './default';

export interface SFURoom extends Room {
  /**@description [japanese] SFURoomにMemberを参加させる */
  join: (memberInit?: RoomMemberInit) => Promise<LocalSFURoomMember>;
}

/**@internal */
export class SFURoomImpl extends RoomBase implements SFURoom {
  protected _disableSignaling = true;
  static async Create(context: SkyWayContext, channel: SkyWayChannelImpl) {
    const plugin = await this._createBot(context, channel);
    const room = new SFURoomImpl(channel, plugin);
    return room;
  }

  localRoomMember?: LocalSFURoomMemberImpl;

  private constructor(
    channel: SkyWayChannelImpl,
    readonly _plugin: SFUBotPlugin
  ) {
    super('sfu', channel);
  }

  protected _getTargetPublication(
    publicationId: string
  ): RoomPublicationImpl | undefined {
    return this._getOriginPublication(publicationId);
  }

  protected _createLocalRoomMember<T extends LocalSFURoomMemberImpl>(
    local: LocalPersonAdapter,
    room: this
  ): T {
    return new LocalSFURoomMemberImpl(local, room) as T;
  }

  protected _isAcceptablePublication(p: PublicationImpl): boolean {
    // sfuのoriginとp2pを除外する
    if (p.type !== 'sfu' || !p.origin) {
      return false;
    }
    return true;
  }
}
