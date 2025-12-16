import { Event } from '@skyway-sdk/common';
import type { Member, MemberSide, MemberState } from '@skyway-sdk/core';

import type { RoomPublication } from '../publication';
import type { RoomType } from '../room';
import type { Room } from '../room/default';
import type { RoomSubscription } from '../subscription';

export interface RoomMember {
  readonly id: string;
  readonly name?: string;
  readonly roomId: string;
  readonly roomName?: string;
  readonly roomType: RoomType;
  readonly metadata?: string;
  readonly side: MemberSide;
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
  abstract readonly side: MemberSide;

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

  constructor(
    protected member: Member,
    public room: Room,
  ) {
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
      this.room._getSubscription(s.id),
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
