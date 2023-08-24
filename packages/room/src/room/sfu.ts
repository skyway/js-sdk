import { Logger } from '@skyway-sdk/common';
import {
  LocalPersonAdapter,
  Member,
  PublicationImpl,
  SkyWayChannelImpl,
  SkyWayContext,
  SubscriptionImpl,
} from '@skyway-sdk/core';
import { SfuBotMember, SfuBotPlugin } from '@skyway-sdk/sfu-bot';

import {
  LocalSFURoomMember,
  LocalSFURoomMemberImpl,
} from '../member/local/sfu';
import { RemoteRoomMemberImpl } from '../member/remote/base';
import { RoomPublicationImpl } from '../publication';
import { Room, RoomImpl, RoomMemberInit } from './base';

const log = new Logger('packages/room/src/room/sfu.ts');

export interface SfuRoom extends Room {
  /**@description [japanese] SfuRoomにMemberを参加させる */
  join: (memberInit?: RoomMemberInit) => Promise<LocalSFURoomMember>;
}

/**@internal */

export class SfuRoomImpl extends RoomImpl implements SfuRoom {
  static async Create(context: SkyWayContext, channel: SkyWayChannelImpl) {
    const plugin = context.plugins.find(
      (p) => p.subtype === 'sfu'
    ) as SfuBotPlugin;

    const bot = channel.members.find((m) => m.subtype === SfuBotMember.subtype);
    if (!bot) {
      await plugin.createBot(channel);
    }

    const room = new SfuRoomImpl(channel, plugin);
    return room;
  }

  localRoomMember?: LocalSFURoomMemberImpl;

  private constructor(
    channel: SkyWayChannelImpl,
    readonly _plugin: SfuBotPlugin
  ) {
    super('sfu', channel);

    this.setChannelState();
    this.setChannelListener();
  }

  protected setChannelState() {
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

  protected setChannelListener() {
    this._channel.onMemberJoined.add((e) => this._handleOnMemberJoin(e.member));
    this._channel.onMemberLeft.add((e) => this._handleOnMemberLeft(e.member));

    this._channel.onStreamPublished.add((e) => {
      this._handleOnStreamPublish(e.publication as PublicationImpl);
    });
    this._channel.onStreamUnpublished.add((e) =>
      this._handleOnStreamUnpublish(e.publication as PublicationImpl)
    );
    this._channel.onPublicationMetadataUpdated.add((e) => {
      this._handleOnPublicationMetadataUpdate(e.publication as PublicationImpl);
    });
    this._channel.onPublicationEnabled.add((e) => {
      this._handleOnPublicationEnabled(e.publication as PublicationImpl);
    });
    this._channel.onPublicationDisabled.add((e) => {
      this._handleOnPublicationDisabled(e.publication as PublicationImpl);
    });

    this._channel.onPublicationSubscribed.add((e) => {
      this._handleOnStreamSubscribe(e.subscription as SubscriptionImpl);
    });
    this._channel.onPublicationUnsubscribed.add((e) =>
      this._handleOnStreamUnsubscribe(e.subscription as SubscriptionImpl)
    );
  }

  private _handleOnMemberJoin(m: Member) {
    if (m.type === 'bot') {
      return;
    }
    const member = new RemoteRoomMemberImpl(m, this);
    this._members[m.id] = member;

    this.onMemberJoined.emit({ member });
    this.onMemberListChanged.emit({});
  }

  private _handleOnMemberLeft(m: Member) {
    const member = this._getMember(m.id);
    if (!member) {
      // should be sfu
      return;
    }

    delete this._members[m.id];
    member._dispose();

    this.onMemberLeft.emit({ member });
    this.onMemberListChanged.emit({});
  }

  private _handleOnStreamPublish(p: PublicationImpl) {
    if (!p.origin?.id) {
      return;
    }

    const publication = this._addPublication(p);
    this.onStreamPublished.emit({ publication });
    this.onPublicationListChanged.emit({});
  }

  private _handleOnStreamUnpublish(p: PublicationImpl) {
    if (!p.origin?.id) {
      return;
    }

    const publication = this._getPublication(p.id);
    delete this._publications[p.id];

    this.onStreamUnpublished.emit({ publication });
    this.onPublicationListChanged.emit({});
  }

  private _getRelayedPublication(publicationId: string) {
    const relayed = (this.publications as RoomPublicationImpl[]).find(
      (p) => p._publication.origin?.id === publicationId
    );
    return relayed;
  }

  private _handleOnPublicationMetadataUpdate(p: PublicationImpl) {
    const publication = this._getRelayedPublication(p.id);
    if (!publication) return;

    this.onPublicationMetadataUpdated.emit({
      publication,
      metadata: publication.metadata!,
    });
  }

  private _handleOnPublicationEnabled(p: PublicationImpl) {
    const publication = this._getRelayedPublication(p.id);
    if (!publication) return;

    this.onPublicationEnabled.emit({ publication });
  }

  private _handleOnPublicationDisabled(p: PublicationImpl) {
    const publication = this._getRelayedPublication(p.id);
    if (!publication) return;

    this.onPublicationDisabled.emit({ publication });
  }

  private _handleOnStreamSubscribe(s: SubscriptionImpl) {
    if (s.subscriber.type === 'bot') {
      return;
    }
    const subscription = this._addSubscription(s);
    this.onPublicationSubscribed.emit({ subscription });
    this.onSubscriptionListChanged.emit({});
  }

  private _handleOnStreamUnsubscribe(s: SubscriptionImpl) {
    if (s.subscriber.type === 'bot') {
      return;
    }
    const subscription = this._getSubscription(s.id);
    delete this._subscriptions[s.id];

    this.onPublicationUnsubscribed.emit({ subscription });
    this.onSubscriptionListChanged.emit({});
  }

  async join(memberInit: RoomMemberInit = {}) {
    const local = await this.joinChannel({
      ...memberInit,
      disableSignaling: true,
    });

    const localRoomMember = new LocalSFURoomMemberImpl(
      local as LocalPersonAdapter,
      this
    );
    this.localRoomMember = localRoomMember;
    localRoomMember.onLeft.once(() => {
      this.localRoomMember = undefined;
    });

    log.debug('member joined', memberInit);
    return localRoomMember;
  }
}
