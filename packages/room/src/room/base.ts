import { Event, Events, Logger } from '@skyway-sdk/common';
import {
  ChannelState,
  LocalStream,
  MemberMetadataUpdatedEvent,
  PersonInit,
  Publication,
  SkyWayChannelImpl,
  SubscriptionImpl,
} from '@skyway-sdk/core';
import { v4 } from 'uuid';

import { errors } from '../errors';
import { RoomMember, RoomMemberImpl } from '../member';
import { LocalRoomMember, LocalRoomMemberImpl } from '../member/local/base';
import { RemoteRoomMember, RemoteRoomMemberImpl } from '../member/remote/base';
import { RoomPublication, RoomPublicationImpl } from '../publication';
import { RoomSubscription, RoomSubscriptionImpl } from '../subscription';
import { createError } from '../util';
import { RoomType } from '.';
import * as event from './event';

const log = new Logger('packages/room/src/room/base.ts');

export type RoomState = ChannelState;

export interface Room {
  readonly type: RoomType;
  readonly id: string;
  readonly name?: string;
  readonly metadata?: string;
  readonly state: RoomState;
  readonly disposed: boolean;

  /**
   * @description [japanese] Roomが閉じられたときに発火するイベント
   */
  readonly onClosed: Event<event.RoomClosedEvent>;
  /**
   * @description [japanese] RoomのMetadataが更新されたときに発火するイベント
   */
  readonly onMetadataUpdated: Event<event.RoomMetadataUpdatedEvent>;

  /**
   * @description [japanese] RoomにMemberが参加したときに発火するイベント
   */
  readonly onMemberJoined: Event<event.MemberJoinedEvent>;
  /**
   * @description [japanese] RoomからMemberが離脱したときに発火するイベント
   */
  readonly onMemberLeft: Event<event.MemberLeftEvent>;
  /**
   * @description [japanese] Memberの数が変化した時に発火するイベント
   */
  readonly onMemberListChanged: Event<event.ListChangedEvent>;
  /**
   * @description [japanese] Room上のMemberのメタデータが変更されたときに発火するイベント
   */
  readonly onMemberMetadataUpdated: Event<event.MemberMetadataUpdatedEvent>;

  /**
   * @description [japanese] RoomにStreamがPublishされたときに発火するイベント
   */
  readonly onStreamPublished: Event<event.StreamPublishedEvent>;
  /**
   * @description [japanese] RoomからStreamがUnPublishされたときに発火するイベント
   */
  readonly onStreamUnpublished: Event<event.StreamUnpublishedEvent>;
  /**
   * @description [japanese] Publicationの数が変化した時に発火するイベント
   */
  readonly onPublicationListChanged: Event<event.ListChangedEvent>;
  /**
   * @description [japanese] Room上のPublicationのメタデータが変更されたときに発火するイベント
   */
  readonly onPublicationMetadataUpdated: Event<event.PublicationMetadataUpdatedEvent>;
  /**
   * @description [japanese] Publicationが有効化された時に発火するイベント
   */
  readonly onPublicationEnabled: Event<event.PublicationEnabledEvent>;
  /**
   * @description [japanese] Publicationが無効化された時に発火するイベント
   */
  readonly onPublicationDisabled: Event<event.PublicationDisabledEvent>;

  /**
   * @description [japanese] Room上のStreamがSubscribeされたときに発火するイベント
   */
  readonly onPublicationSubscribed: Event<event.StreamSubscribedEvent>;
  /**
   * @description [japanese] Room上のStreamがUnSubscribeされたときに発火するイベント
   */
  readonly onPublicationUnsubscribed: Event<event.StreamUnsubscribedEvent>;
  /**
   * @description [japanese] Subscriptionの数が変化した時に発火するイベント
   */
  readonly onSubscriptionListChanged: Event<event.ListChangedEvent>;

  /**
   * @description [japanese] Roomに参加しているMemberの一覧を取得する
   */
  readonly members: RemoteRoomMember[];
  /**
   * @description [japanese] RoomにPublishされているStreamのPublicationの一覧を取得する
   */
  readonly publications: RoomPublication[];
  /**
   * @description [japanese] Room上のStreamのSubscriptionの一覧を取得する
   */
  readonly subscriptions: RoomSubscription[];
  localRoomMember?: LocalRoomMember;

  /**
   * @description [japanese] RoomにMemberを追加する
   */
  join: (memberInit?: RoomMemberInit) => Promise<LocalRoomMember>;
  /**
   * @description [japanese] RoomからMemberを退室させる
   */
  leave: (member: RoomMember) => Promise<void>;
  /**
   * @description [japanese] 別のRoomのMemberを移動させる
   */
  moveRoom: (member: LocalRoomMember) => Promise<LocalRoomMember>;
  /**
   * @description [japanese] Roomのmetadataを更新する
   */
  updateMetadata: (metadata: string) => Promise<void>;
  /**
   * @description [japanese] Roomを閉じる
   */
  close: () => Promise<void>;
  /**
   * @description [japanese] Roomを閉じずにRoomインスタンスの利用を終了し次のリソースを解放する。
   * - サーバとの通信
   * - イベントリスナー
   * - LocalMemberのインスタンス
   */
  dispose: () => Promise<void>;
}

/**@internal */
export abstract class RoomImpl implements Room {
  readonly type: RoomType;
  protected _members: { [memberId: string]: RemoteRoomMemberImpl } = {};
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
  _addSubscription(s: SubscriptionImpl) {
    const exist = this._subscriptions[s.id];
    if (exist) {
      return exist;
    }

    const subscription = new RoomSubscriptionImpl(s, this);
    this._subscriptions[s.id] = subscription;
    return subscription;
  }

  localRoomMember?: LocalRoomMemberImpl;

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

  constructor(type: RoomType, public _channel: SkyWayChannelImpl) {
    this.type = type;

    this._channel.onClosed.pipe(this.onClosed);
    this._channel.onMetadataUpdated.pipe(this.onMetadataUpdated);
    this._channel.onMemberMetadataUpdated.add((e) => {
      this._handleOnMemberMetadataUpdate(e);
    });
  }

  private _handleOnMemberMetadataUpdate(e: MemberMetadataUpdatedEvent) {
    const member = this._getMember(e.member.id);
    this.onMemberMetadataUpdated.emit({ member, metadata: e.metadata });
  }

  protected abstract setChannelState(): void;

  protected abstract setChannelListener(): void;

  get members(): RemoteRoomMember[] {
    return Object.values(this._members);
  }

  get publications(): RoomPublication[] {
    return Object.values(this._publications);
  }

  get subscriptions(): RoomSubscription[] {
    return Object.values(this._subscriptions);
  }

  protected async joinChannel(roomMemberInit: RoomMemberInit = {}) {
    if (this.state !== 'opened') {
      throw createError({
        operationName: 'RoomImpl.joinChannel',
        context: this._context,
        room: this,
        info: errors.roomNotOpened,
        path: log.prefix,
      });
    }

    roomMemberInit.name = roomMemberInit.name ?? v4();
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

  abstract join(memberInit?: RoomMemberInit): Promise<LocalRoomMember>;

  async leave(member: RoomMember) {
    await this._channel.leave((member as RoomMemberImpl)._member);
  }

  async moveRoom(member: LocalRoomMember) {
    await this._channel.moveChannel((member as LocalRoomMemberImpl)._local);
    member._updateRoom(this);
    return member;
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
