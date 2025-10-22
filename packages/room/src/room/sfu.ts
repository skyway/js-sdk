import {
  LocalPersonAdapter,
  Member,
  PublicationImpl,
  SkyWayChannelImpl,
  SkyWayContext,
  SubscriptionImpl,
} from '@skyway-sdk/core';
import { SFUBotPlugin } from '@skyway-sdk/sfu-bot';

import {
  LocalSFURoomMember,
  LocalSFURoomMemberImpl,
} from '../member/local/sfu';
import { RemoteRoomMemberImpl } from '../member/remote/base';
import { RoomPublicationImpl } from '../publication';
import { RoomBase, RoomMemberInit } from './base';
import { Room } from './default';

export interface SFURoom extends Room {
  /**@description [japanese] SFURoomにMemberを参加させる */
  join: (memberInit?: RoomMemberInit) => Promise<LocalSFURoomMember>;
}

/**@internal */
export class SFURoomImpl extends RoomBase implements SFURoom {
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

  protected _setChannelState() {
    this._channel.members.forEach((m) => {
      if (m.type === 'bot') {
        return;
      }
      const member = new RemoteRoomMemberImpl(m, this);
      this._members[m.id] = member;
    });
    this._channel.publications.forEach((p) => {
      if (!p.origin) {
        return;
      }

      this._addPublication(p);
    });
    this._channel.subscriptions.forEach((s) => {
      if (s.subscriber.type === 'bot') {
        return;
      }
      this._addSubscription(s as SubscriptionImpl);
    });
  }

  protected _handleOnMemberJoin(m: Member) {
    if (m.type === 'bot') {
      return;
    }
    super._handleOnMemberJoin(m);
  }

  protected _handleOnMemberLeft(m: Member) {
    const member = this._getMember(m.id);
    if (!member) {
      // should be sfu
      return;
    }
    super._handleOnMemberLeft(m);
  }

  protected _handleOnStreamPublish(p: PublicationImpl) {
    if (!p.origin?.id) {
      return;
    }
    super._handleOnStreamPublish(p);
  }

  protected _handleOnStreamUnpublish(p: PublicationImpl) {
    if (!p.origin?.id) {
      return;
    }
    super._handleOnStreamUnpublish(p);
  }

  protected _handleOnStreamSubscribe(s: SubscriptionImpl) {
    if (s.subscriber.type === 'bot') {
      return;
    }
    super._handleOnStreamSubscribe(s);
  }

  protected _handleOnStreamUnsubscribe(s: SubscriptionImpl) {
    if (s.subscriber.type === 'bot') {
      return;
    }
    super._handleOnStreamUnsubscribe(s);
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
}
