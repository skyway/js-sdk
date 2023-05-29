import { Logger } from '@skyway-sdk/common';
import {
  LocalPersonAdapter,
  Member,
  Publication,
  SkyWayChannelImpl,
  Subscription,
  SubscriptionImpl,
} from '@skyway-sdk/core';

import {
  LocalP2PRoomMember,
  LocalP2PRoomMemberImpl,
} from '../member/local/p2p';
import { RemoteRoomMemberImpl } from '../member/remote/base';
import { Room, RoomImpl, RoomMemberInit } from './base';

const log = new Logger('packages/room/src/room/p2p.ts');

export interface P2PRoom extends Room {
  /**
   * @description [japanese] RoomにMemberを参加させる
   */
  join: (memberInit?: RoomMemberInit) => Promise<LocalP2PRoomMember>;
}

/**@internal */
export class P2PRoomImpl extends RoomImpl implements P2PRoom {
  localRoomMember?: LocalP2PRoomMemberImpl;

  constructor(channel: SkyWayChannelImpl) {
    super('p2p', channel);

    this.setChannelState();
    this.setChannelListener();
  }

  protected setChannelState() {
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

  protected setChannelListener() {
    this._channel.onMemberJoined.add((e) => this._handleOnMemberJoin(e.member));
    this._channel.onMemberLeft.add((e) => this._handleOnMemberLeft(e.member));

    this._channel.onStreamPublished.add((e) =>
      this._handleOnStreamPublish(e.publication)
    );
    this._channel.onStreamUnpublished.add((e) =>
      this._handleOnStreamUnpublish(e.publication)
    );
    this._channel.onPublicationMetadataUpdated.add((e) => {
      this._handleOnPublicationMetadataUpdate(e.publication);
    });
    this._channel.onPublicationEnabled.add((e) => {
      this._handleOnPublicationEnabled(e.publication);
    });
    this._channel.onPublicationDisabled.add((e) => {
      this._handleOnPublicationDisabled(e.publication);
    });

    this._channel.onPublicationSubscribed.add((e) =>
      this._handleOnStreamSubscribe(e.subscription as SubscriptionImpl)
    );
    this._channel.onPublicationUnsubscribed.add((e) =>
      this._handleOnStreamUnsubscribe(e.subscription)
    );
  }

  private _handleOnMemberJoin(m: Member) {
    if (this._getMember(m.id)) {
      return;
    }

    const member = new RemoteRoomMemberImpl(m, this);
    this._members[m.id] = member;
    this.onMemberJoined.emit({ member });
    this.onMemberListChanged.emit({});
  }

  private _handleOnMemberLeft(m: Member) {
    const member = this._getMember(m.id);
    delete this._members[m.id];
    member._dispose();

    this.onMemberLeft.emit({ member });
    this.onMemberListChanged.emit({});
  }

  private _handleOnStreamPublish(p: Publication) {
    if (this._getPublication(p.id)) {
      return;
    }

    const publication = this._addPublication(p);

    this.onStreamPublished.emit({ publication });
    this.onPublicationListChanged.emit({});
  }

  private _handleOnStreamUnpublish(p: Publication) {
    const publication = this._getPublication(p.id);
    delete this._publications[p.id];

    this.onStreamUnpublished.emit({ publication });
    this.onPublicationListChanged.emit({});
  }

  private _handleOnPublicationMetadataUpdate(p: Publication) {
    const publication = this._getPublication(p.id);
    this.onPublicationMetadataUpdated.emit({
      publication,
      metadata: publication.metadata!,
    });
  }

  private _handleOnPublicationEnabled(p: Publication) {
    const publication = this._getPublication(p.id);
    this.onPublicationEnabled.emit({ publication });
  }

  private _handleOnPublicationDisabled(p: Publication) {
    const publication = this._getPublication(p.id);
    this.onPublicationDisabled.emit({ publication });
  }

  private _handleOnStreamSubscribe(s: SubscriptionImpl) {
    if (this._getSubscription(s.id)) {
      return;
    }

    const subscription = this._addSubscription(s);

    this.onPublicationSubscribed.emit({ subscription });
    this.onSubscriptionListChanged.emit({});
  }

  private _handleOnStreamUnsubscribe(s: Subscription) {
    const subscription = this._getSubscription(s.id);
    delete this._subscriptions[s.id];

    this.onPublicationUnsubscribed.emit({ subscription });
    this.onSubscriptionListChanged.emit({});
  }

  async join(memberInit: RoomMemberInit = {}) {
    const local = await this.joinChannel(memberInit);

    const localRoomMember = new LocalP2PRoomMemberImpl(
      local as LocalPersonAdapter,
      this
    );
    log.debug('member joined', memberInit);
    this.localRoomMember = localRoomMember;
    localRoomMember.onLeft.once(() => {
      this.localRoomMember = undefined;
    });

    return localRoomMember;
  }
}
