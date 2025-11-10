import { Event } from '@skyway-sdk/common';
import {
  LocalPersonAdapter,
  LocalStream,
  Publication,
  PublicationImpl,
  RemoteStream,
  SkyWayChannelImpl,
  SkyWayContext,
  SubscriptionImpl,
} from '@skyway-sdk/core';
import { PublicationType } from '@skyway-sdk/model';
import { SFUBotPlugin } from '@skyway-sdk/sfu-bot';

import { RoomMember, RoomMemberImpl } from '../member';
import { LocalRoomMember, LocalRoomMemberImpl } from '../member/local/default';
import { RoomPublication, RoomPublicationImpl } from '../publication';
import { RoomSubscription, RoomSubscriptionImpl } from '../subscription';
import { RoomType } from '.';
import { RoomBase, RoomMemberInit, RoomState } from './base';
import * as event from './event';

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
  readonly members: RoomMember[];
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

  /**@internal */
  _channel: SkyWayChannelImpl;

  /**@internal */
  _context: SkyWayContext;

  /**@private */
  _getPublication(id: string): RoomPublicationImpl;

  /**@private */
  _getSubscription(id: string): RoomSubscriptionImpl;

  /**@private */
  _addPublication<T extends LocalStream>(p: Publication): RoomPublication<T>;

  /**@private */
  _addSubscription(s: SubscriptionImpl): RoomSubscriptionImpl<RemoteStream>;

  /**@private */
  _getMember(id: string): RoomMemberImpl;
}

/**@internal */
export class RoomImpl extends RoomBase implements Room {
  protected _disableSignaling = false;
  static async Create(context: SkyWayContext, channel: SkyWayChannelImpl) {
    const plugin = await this._createBot(context, channel);

    const room = new RoomImpl(channel, plugin);
    return room;
  }

  localRoomMember?: LocalRoomMember;

  private constructor(
    channel: SkyWayChannelImpl,
    readonly _plugin: SFUBotPlugin
  ) {
    super('default', channel);
  }

  protected _getTargetPublication(
    publicationId: string,
    publicationType: PublicationType
  ): RoomPublication<LocalStream> | undefined {
    return publicationType === 'sfu'
      ? this._getOriginPublication(publicationId)
      : this._getPublication(publicationId);
  }

  protected _createLocalRoomMember<T extends LocalRoomMemberImpl>(
    local: LocalPersonAdapter,
    room: this
  ): T {
    return new LocalRoomMemberImpl(local, room) as T;
  }

  protected _isAcceptablePublication(p: PublicationImpl): boolean {
    // sfuのoriginのみ除外する
    if (p.type === 'sfu' && !p.origin) {
      return false;
    }

    return true;
  }
}
