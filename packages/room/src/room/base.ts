import { Events, Logger } from '@skyway-sdk/common';
import type {
  ChannelState,
  LocalPersonAdapter,
  LocalStream,
  Member,
  MemberMetadataUpdatedEvent,
  PersonInit,
  Publication,
  PublicationImpl,
  RemoteStream,
  SkyWayChannelImpl,
  SkyWayContext,
  SubscriptionImpl,
} from '@skyway-sdk/core';
import type { PublicationType } from '@skyway-sdk/model';
import { SFUBotMember, type SFUBotPlugin } from '@skyway-sdk/sfu-bot';

import { errors } from '../errors';
import type { RoomMember, RoomMemberImpl } from '../member';
import type {
  LocalRoomMember,
  LocalRoomMemberImpl,
} from '../member/local/default';
import type { LocalP2PRoomMemberImpl } from '../member/local/p2p';
import type { LocalSFURoomMemberImpl } from '../member/local/sfu';
import { RemoteRoomMemberImpl } from '../member/remote/base';
import { type RoomPublication, RoomPublicationImpl } from '../publication';
import { type RoomSubscription, RoomSubscriptionImpl } from '../subscription';
import { createError } from '../util';
import type { RoomType } from '.';
import type { Room } from './default';
import type * as event from './event';

const log = new Logger('packages/room/src/room/base.ts');

export type RoomState = ChannelState;

/**@internal */
export abstract class RoomBase implements Room {
  readonly type: RoomType;
  protected abstract _disableSignaling: boolean;
  protected _members: { [memberId: string]: RoomMemberImpl } = {};

  /**@private */
  static async _createBot(context: SkyWayContext, channel: SkyWayChannelImpl) {
    const plugin = context.plugins.find(
      (p) => p.subtype === 'sfu',
    ) as SFUBotPlugin;

    const bot = channel.members.find((m) => m.subtype === SFUBotMember.subtype);
    if (!bot) {
      await plugin.createBot(channel);
    }
    return plugin;
  }
  /**@private */
  _getMember(id: string) {
    return this._members[id];
  }
  protected _publications: { [publicationId: string]: RoomPublicationImpl } =
    {};
  /**@private */
  _getPublication(id: string) {
    return this._publications[id];
  }
  /**@private */
  _getOriginPublication(publicationId: string) {
    const origin = (this.publications as RoomPublicationImpl[]).find(
      (p) => p._publication.origin?.id === publicationId,
    );
    return origin;
  }
  /**@private */
  _addPublication<T extends LocalStream>(p: Publication): RoomPublication<T> {
    const exist = this._publications[p.id];
    if (exist) {
      return exist as RoomPublicationImpl<T>;
    }

    const publication = new RoomPublicationImpl<T>(p, this);
    this._publications[p.id] = publication;
    return publication;
  }
  protected _subscriptions: { [subscriptionId: string]: RoomSubscriptionImpl } =
    {};
  /**@private */
  _getSubscription(id: string) {
    return this._subscriptions[id];
  }
  /**@private */
  _addSubscription(s: SubscriptionImpl): RoomSubscriptionImpl<RemoteStream> {
    const exist = this._subscriptions[s.id];
    if (exist) {
      return exist;
    }

    const subscription = new RoomSubscriptionImpl(s, this);
    this._subscriptions[s.id] = subscription;
    return subscription;
  }

  localRoomMember?: LocalRoomMember;

  readonly _context = this._channel._context;
  private readonly _events = new Events();
  readonly onClosed = this._events.make<event.RoomClosedEvent>();
  readonly onMetadataUpdated =
    this._events.make<event.RoomMetadataUpdatedEvent>();

  readonly onMemberJoined = this._events.make<event.MemberJoinedEvent>();
  readonly onMemberLeft = this._events.make<event.MemberLeftEvent>();
  readonly onMemberListChanged = this._events.make<event.ListChangedEvent>();
  readonly onMemberMetadataUpdated =
    this._events.make<event.MemberMetadataUpdatedEvent>();

  readonly onStreamPublished = this._events.make<event.StreamPublishedEvent>();
  readonly onStreamUnpublished =
    this._events.make<event.StreamUnpublishedEvent>();
  readonly onPublicationListChanged =
    this._events.make<event.ListChangedEvent>();
  readonly onPublicationMetadataUpdated =
    this._events.make<event.PublicationMetadataUpdatedEvent>();
  readonly onPublicationEnabled =
    this._events.make<event.PublicationEnabledEvent>();
  readonly onPublicationDisabled =
    this._events.make<event.PublicationDisabledEvent>();

  readonly onPublicationSubscribed =
    this._events.make<event.StreamSubscribedEvent>();
  readonly onPublicationUnsubscribed =
    this._events.make<event.StreamUnsubscribedEvent>();
  readonly onSubscriptionListChanged =
    this._events.make<event.ListChangedEvent>();

  get id() {
    return this._channel.id;
  }

  get name() {
    return this._channel.name;
  }

  get metadata() {
    return this._channel.metadata;
  }

  get state() {
    return this._channel.state as RoomState;
  }

  get disposed() {
    return this._channel.disposed;
  }

  constructor(
    type: RoomType,
    public _channel: SkyWayChannelImpl,
  ) {
    this.type = type;

    this._channel.onClosed.pipe(this.onClosed);
    this._channel.onMetadataUpdated.pipe(this.onMetadataUpdated);
    this._channel.onMemberMetadataUpdated.add((e) =>
      this._handleOnMemberMetadataUpdate(e),
    );

    this._setChannelState();
    this._setChannelListener();
  }

  private _handleOnMemberMetadataUpdate(e: MemberMetadataUpdatedEvent) {
    const member = this._getMember(e.member.id);
    this.onMemberMetadataUpdated.emit({ member, metadata: e.metadata });
  }

  private _setChannelState() {
    this._channel.members.forEach((m) => {
      if (m.type === 'bot') {
        return;
      }
      const member = new RemoteRoomMemberImpl(m, this);
      this._members[m.id] = member;
    });

    this._channel.publications.forEach((p) => {
      if (!this._isAcceptablePublication(p as PublicationImpl)) {
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

  private _setChannelListener() {
    this._channel.onMemberJoined.add((e) => this._handleOnMemberJoin(e.member));
    this._channel.onMemberLeft.add((e) => this._handleOnMemberLeft(e.member));
    this._channel.onStreamPublished.add((e) =>
      this._handleOnStreamPublish(e.publication as PublicationImpl),
    );
    this._channel.onStreamUnpublished.add((e) =>
      this._handleOnStreamUnpublish(e.publication as PublicationImpl),
    );
    this._channel.onPublicationMetadataUpdated.add((e) =>
      this._handleOnPublicationMetadataUpdate(e.publication as PublicationImpl),
    );
    this._channel.onPublicationEnabled.add((e) =>
      this._handleOnPublicationEnabled(e.publication as PublicationImpl),
    );
    this._channel.onPublicationDisabled.add((e) =>
      this._handleOnPublicationDisabled(e.publication as PublicationImpl),
    );
    this._channel.onPublicationSubscribed.add((e) =>
      this._handleOnStreamSubscribe(e.subscription as SubscriptionImpl),
    );
    this._channel.onPublicationUnsubscribed.add((e) =>
      this._handleOnStreamUnsubscribe(e.subscription as SubscriptionImpl),
    );
  }

  private _handleOnMemberJoin(m: Member) {
    if (m.type === 'bot') {
      return;
    }

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
    if (!member) {
      // should be bot
      return;
    }

    delete this._members[m.id];

    if (m.side === 'remote') {
      (member as RemoteRoomMemberImpl)._dispose();
    }

    this.onMemberLeft.emit({ member });
    this.onMemberListChanged.emit({});
  }

  private _handleOnStreamPublish(p: PublicationImpl) {
    if (!this._isAcceptablePublication(p)) {
      return;
    }

    if (this._getPublication(p.id)) {
      return;
    }

    const publication = this._addPublication(p);
    this.onStreamPublished.emit({ publication });
    this.onPublicationListChanged.emit({});
  }

  private _handleOnStreamUnpublish(p: PublicationImpl) {
    if (!this._isAcceptablePublication(p)) {
      return;
    }

    const publication = this._getPublication(p.id);
    delete this._publications[p.id];

    this.onStreamUnpublished.emit({ publication });
    this.onPublicationListChanged.emit({});
  }

  private _handleOnPublicationMetadataUpdate(p: PublicationImpl) {
    const publication = this._getTargetPublication(p.id, p.type);
    if (!publication) return;

    this.onPublicationMetadataUpdated.emit({
      publication,
      metadata: publication.metadata!,
    });
  }

  private _handleOnPublicationEnabled(p: PublicationImpl) {
    const publication = this._getTargetPublication(p.id, p.type);
    if (!publication) return;

    this.onPublicationEnabled.emit({ publication });
  }

  private _handleOnPublicationDisabled(p: PublicationImpl) {
    const publication = this._getTargetPublication(p.id, p.type);
    if (!publication) return;

    this.onPublicationDisabled.emit({ publication });
  }

  private _handleOnStreamSubscribe(s: SubscriptionImpl) {
    if (s.subscriber.type === 'bot') {
      return;
    }

    if (this._getSubscription(s.id)) {
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

  get members(): RoomMember[] {
    return Object.values(this._members);
  }

  get publications(): RoomPublication[] {
    return Object.values(this._publications);
  }

  get subscriptions(): RoomSubscription[] {
    return Object.values(this._subscriptions);
  }

  private async _joinChannel(roomMemberInit: RoomMemberInit = {}) {
    if (this.state !== 'opened') {
      throw createError({
        operationName: 'RoomImpl.joinChannel',
        context: this._context,
        room: this,
        info: errors.roomNotOpened,
        path: log.prefix,
      });
    }

    const local = await this._channel.join(roomMemberInit);

    if (!this._getMember(local.id)) {
      await this.onMemberJoined
        .watch((e) => {
          return (e.member as RoomMemberImpl)._member.id === local.id;
        }, this._context.config.rtcApi.timeout)
        .catch((error) => {
          throw createError({
            operationName: 'RoomImpl.joinChannel',
            context: this._context,
            room: this,
            info: { ...errors.timeout, detail: 'RoomImpl onMemberJoined' },
            path: log.prefix,
            error,
          });
        });
    }
    return local;
  }

  protected abstract _getTargetPublication(
    publicationId: string,
    publicationType?: PublicationType,
  ): RoomPublication | undefined;

  protected abstract _createLocalRoomMember<
    T extends
      | LocalRoomMemberImpl
      | LocalP2PRoomMemberImpl
      | LocalSFURoomMemberImpl,
  >(local: LocalPersonAdapter, room: this): T;

  protected abstract _isAcceptablePublication(p: PublicationImpl): boolean;

  async join<
    T extends
      | LocalRoomMemberImpl
      | LocalP2PRoomMemberImpl
      | LocalSFURoomMemberImpl,
  >(memberInit: RoomMemberInit = {}): Promise<T> {
    const local = await this._joinChannel({
      ...memberInit,
      disableSignaling: this._disableSignaling,
    });

    const localRoomMember = this._createLocalRoomMember<T>(
      local as LocalPersonAdapter,
      this,
    );

    log.debug('member joined', memberInit);
    this.localRoomMember = localRoomMember;
    this._members[localRoomMember.id] = localRoomMember;

    localRoomMember.onLeft.once(() => {
      this.localRoomMember = undefined;
    });

    return localRoomMember;
  }

  async leave(member: RoomMember) {
    await this._channel.leave((member as RoomMemberImpl)._member);
  }

  updateMetadata(metadata: string) {
    return this._channel.updateMetadata(metadata);
  }

  async close() {
    await this._channel.close();
  }

  async dispose() {
    return this._channel.dispose();
  }

  toJSON() {
    return {
      type: this.type,
      id: this.id,
      name: this.name,
      metadata: this.metadata,
      members: this.members,
      publications: this.publications,
      subscriptions: this.subscriptions,
    };
  }
}

export type RoomMemberInit = PersonInit;
