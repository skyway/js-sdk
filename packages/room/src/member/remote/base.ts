import { Event, EventDisposer, Logger } from '@skyway-sdk/common';
import { Member, RemotePersonImpl } from '@skyway-sdk/core';

import { errors } from '../../errors';
import { RoomMember, RoomMemberImpl } from '../../member';
import { RoomImpl } from '../../room/base';
import { RoomSubscription } from '../../subscription';
import { createError } from '../../util';

const log = new Logger('packages/room/src/member/remote/base.ts');

export interface RemoteRoomMember extends RoomMember {
  readonly side: 'remote';
  /**@description [japanese] この RemoteRoomMember がPublicationをSubscribeしたとき */
  readonly onPublicationSubscribed: Event<{ subscription: RoomSubscription }>;
  /**@description [japanese] この RemoteRoomMember がPublicationをUnsubscribeしたとき */
  readonly onPublicationUnsubscribed: Event<{ subscription: RoomSubscription }>;
  /**@description [japanese] MemberのSubscriptionの数が変化したとき */
  readonly onSubscriptionListChanged: Event<void>;
  /**@description [japanese] MemberのPublicationの数が変化したとき */
  readonly onPublicationListChanged: Event<void>;
  /**@description [japanese] この RemoteRoomMember にPublicationをSubscribeさせる */
  subscribe: (
    publicationId: string
  ) => Promise<{ subscription: RoomSubscription }>;
  /**@description [japanese] この RemoteRoomMember にPublicationをUnsubscribeさせる */
  unsubscribe: (subscriptionId: string) => Promise<void>;
}

/**@internal */
export class RemoteRoomMemberImpl
  extends RoomMemberImpl
  implements RemoteRoomMember
{
  readonly side = 'remote';

  readonly onPublicationSubscribed = new Event<{
    subscription: RoomSubscription;
  }>();
  readonly onPublicationUnsubscribed = new Event<{
    subscription: RoomSubscription;
  }>();
  readonly onSubscriptionListChanged = new Event<void>();
  readonly onPublicationListChanged = new Event<void>();

  private _disposer = new EventDisposer();

  constructor(member: Member, room: RoomImpl) {
    super(member, room);

    room.onPublicationSubscribed
      .add((e) => {
        if (
          (e.subscription.subscriber as RemoteRoomMemberImpl)._member.id ===
          member.id
        ) {
          this.onPublicationSubscribed.emit(e);
          this.onSubscriptionListChanged.emit();
        }
      })
      .disposer(this._disposer);

    room.onPublicationUnsubscribed
      .add((e) => {
        if (
          (e.subscription.subscriber as RemoteRoomMemberImpl)._member.id ===
          member.id
        ) {
          this.onPublicationUnsubscribed.emit(e);
          this.onSubscriptionListChanged.emit();
        }
      })
      .disposer(this._disposer);

    if (member instanceof RemotePersonImpl) {
      member.onPublicationListChanged
        .pipe(this.onPublicationListChanged)
        .disposer(this._disposer);
    }
  }

  subscribe = (publicationId: string) =>
    new Promise<{ subscription: RoomSubscription }>((r, f) => {
      if (!(this.member instanceof RemotePersonImpl)) {
        f(
          createError({
            operationName: 'RemoteRoomMemberImpl.subscribe',
            context: this.room._context,
            room: this.room,
            info: errors.subscribeOtherMemberType,
            path: log.prefix,
          })
        );
        return;
      }

      let failed = false;
      this.member.subscribe(publicationId).catch((e) => {
        failed = true;
        f(e);
      });

      this.onPublicationSubscribed
        .watch((e) => e.subscription.publication.id === publicationId)
        .then((e) => r(e))
        .catch((e) => {
          if (!failed) f(e);
        });
    });

  unsubscribe = (subscriptionId: string) =>
    new Promise<void>((r, f) => {
      if (!(this.member instanceof RemotePersonImpl)) {
        f(
          createError({
            operationName: 'RemoteRoomMemberImpl.unsubscribe',
            context: this.room._context,
            room: this.room,
            info: errors.subscribeOtherMemberType,
            path: log.prefix,
          })
        );
        return;
      }

      let failed = false;
      this.member.unsubscribe(subscriptionId).catch((e) => {
        failed = true;
        f(e);
      });

      this.onPublicationUnsubscribed
        .watch((e) => e.subscription.id === subscriptionId)
        .then(() => r())
        .catch((e) => {
          if (!failed) f(e);
        });
    });

  /**@private */
  _dispose() {
    this._disposer.dispose();
  }
}
