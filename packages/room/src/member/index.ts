import { Event } from '@skyway-sdk/common';
import { Member, MemberState } from '@skyway-sdk/core';

import { RoomPublication } from '../publication';
import { RoomType } from '../room';
import { RoomImpl } from '../room/base';
import { RoomSubscription } from '../subscription';

export interface RoomMember {
  readonly id: string;
  readonly name?: string;
  readonly roomId: string;
  readonly roomName?: string;
  readonly roomType: RoomType;
  readonly metadata?: string;
  state: RoomMemberState;
  /**@description [japanese] Memberが Publish した Publication のリスト */
  readonly publications: RoomPublication[];
  /**@description [japanese] Memberが Subscribe している Subscription のリスト */
  readonly subscriptions: RoomSubscription[];
  /**@description [japanese] MemberがRoomから出たときに発火するイベント*/
  readonly onLeft: Event<void>;
  /**@description [japanese] Memberのメタデータが更新された時に発火するイベント*/
  readonly onMetadataUpdated: Event<string>;
  /**@description [japanese] Memberのメタデータを更新する */
  updateMetadata: (metadata: string) => Promise<void>;
  /**
   * @description [japanese] Channelから退室する
   */
  leave: () => Promise<void>;
}

/**@internal */
export abstract class RoomMemberImpl implements RoomMember {
  readonly onLeft = new Event<void>();
  readonly onMetadataUpdated: Event<string>;

  get id() {
    return this.member.id;
  }
  get name() {
    return this.member.name;
  }
  get roomId() {
    return this.room.id;
  }
  get roomName() {
    return this.room.name;
  }
  get roomType() {
    return this.room.type;
  }

  get state() {
    return this.member.state;
  }

  get metadata() {
    return this.member.metadata;
  }

  constructor(protected member: Member, public room: RoomImpl) {
    const { removeListener } = room.onMemberLeft.add((e) => {
      if (e.member.id === this.member.id) {
        removeListener();
        this.onLeft.emit();
      }
    });
    this.onMetadataUpdated = member.onMetadataUpdated;
  }

  /**@private */
  get _member() {
    return this.member;
  }

  get publications() {
    return this.room.publications.filter((p) => p.publisher.id === this.id);
  }

  get subscriptions() {
    return this.member.subscriptions.map((s) =>
      this.room._getSubscription(s.id)
    );
  }

  updateMetadata(metadata: string) {
    return this.member.updateMetadata(metadata);
  }

  leave() {
    return this.member.leave();
  }

  /**@internal */
  toJSON() {
    return { id: this.id, name: this.name, metadata: this.metadata };
  }
}

export type RoomMemberState = MemberState;
