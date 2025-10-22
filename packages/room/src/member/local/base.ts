import { Logger } from '@skyway-sdk/common';
import { Event, SkyWayError } from '@skyway-sdk/common';
import {
  LocalDataStream,
  LocalPerson,
  LocalPersonAdapter,
  LocalStream,
  PublicationOptions,
  RemoteAudioStream,
  RemoteDataStream,
  RemoteVideoStream,
  SubscriptionImpl,
  SubscriptionOptions,
} from '@skyway-sdk/core';
import { errors as sfuErrors, SFUBotMember } from '@skyway-sdk/sfu-bot';

import { defaultMaxSubscribers } from '../../const';
import { errors } from '../../errors';
import { RoomMemberImpl } from '../../member';
import { RoomPublication } from '../../publication';
import { Room } from '../../room/default';
import { RoomSubscription } from '../../subscription';
import { RemoteRoomMemberImpl } from '../remote/base';
import { LocalRoomMember } from './default';

const log = new Logger('packages/room/src/member/local/base.ts');

/**@internal */
export abstract class LocalRoomMemberBase
  extends RoomMemberImpl
  implements LocalRoomMember
{
  readonly side = 'local';
  readonly _local = this._member as LocalPerson;
  readonly onStreamPublished = new Event<{ publication: RoomPublication }>();
  readonly onStreamUnpublished = new Event<{ publication: RoomPublication }>();
  readonly onPublicationListChanged = new Event<void>();
  readonly onPublicationSubscribed = new Event<{
    subscription: RoomSubscription;
    stream: RemoteVideoStream | RemoteAudioStream | RemoteDataStream;
  }>();
  readonly onPublicationUnsubscribed = new Event<{
    subscription: RoomSubscription;
  }>();
  readonly onSubscriptionListChanged = new Event<void>();
  readonly onFatalError = new Event<SkyWayError>();

  readonly _context = this.room._context;

  /**@private */
  constructor(member: LocalPersonAdapter, room: Room) {
    super(member, room);

    this._local.onPublicationSubscribed.add(async (e) => {
      const roomSubscription = room._addSubscription(
        e.subscription as SubscriptionImpl
      );
      this.onPublicationSubscribed.emit({
        subscription: roomSubscription,
        stream: e.stream,
      });
    });
    this._local.onFatalError.pipe(this.onFatalError);

    this._listenRoomEvent();

    this.onStreamPublished.add(() => this.onPublicationListChanged.emit());
    this.onStreamUnpublished.add(() => this.onPublicationListChanged.emit());
    this.onPublicationSubscribed.add(() =>
      this.onSubscriptionListChanged.emit()
    );
    this.onPublicationUnsubscribed.add(() =>
      this.onSubscriptionListChanged.emit()
    );
  }

  get subscriptions() {
    return this.member.subscriptions
      .map((s) => this.room._getSubscription(s.id))
      .filter((s) => s.stream);
  }

  protected _listenRoomEvent() {
    this.room.onPublicationUnsubscribed.add((e) => {
      if (
        (e.subscription.subscriber as RemoteRoomMemberImpl)._member.id ===
        this._local.id
      ) {
        this.onPublicationUnsubscribed.emit(e);
      }
    });
  }

  abstract publish<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options?: RoomPublicationOptions
  ): Promise<RoomPublication<T>>;

  abstract unpublish(publicationId: string | RoomPublication): Promise<void>;

  /** internal */
  async _publishAsP2P<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options: PublicationOptions = {}
  ): Promise<RoomPublication<T>> {
    const publication = await this._local.publish(stream, options);

    const roomPublication = this.room._addPublication<T>(publication);
    this.onStreamPublished.emit({ publication: roomPublication });

    return roomPublication;
  }

  /** internal */
  async _publishAsSFU<T extends LocalStream = LocalStream>(
    stream: LocalStream,
    options: PublicationOptions & SFURoomPublicationOptions = {}
  ): Promise<RoomPublication<T>> {
    if (stream instanceof LocalDataStream) {
      throw errors.sfuPublicationNotSupportDataStream;
    }

    options.type = 'sfu';
    options.maxSubscribers = options.maxSubscribers ?? defaultMaxSubscribers;

    const origin = await this._local.publish(stream, options);
    const bot = this.room._channel.members.find(
      (m) => m.subtype === SFUBotMember.subtype
    ) as SFUBotMember;
    if (!bot) {
      throw sfuErrors.sfuBotNotInChannel;
    }

    const forwarding = await bot.startForwarding(origin, {
      maxSubscribers: options.maxSubscribers,
    });
    const relayingPublication = forwarding.relayingPublication;

    const roomPublication = this.room._addPublication<T>(relayingPublication);
    this.onStreamPublished.emit({ publication: roomPublication });

    return roomPublication;
  }

  /** internal */
  async _unpublishAsP2P(target: string | RoomPublication) {
    const publicationId = typeof target === 'string' ? target : target.id;
    this._local.unpublish(publicationId).catch((error) => {
      log.error('_unpublishAsP2P error', error, { target }, this.toJSON());
    });
    const { publication } = await this.room.onStreamUnpublished
      .watch(
        (e) => e.publication.id === publicationId,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw [{ ...errors.timeout, detail: 'onStreamUnpublished' }, error];
      });

    this.onStreamUnpublished.emit({ publication });
  }

  /** internal */
  async _unpublishAsSFU(target: string | RoomPublication) {
    const publicationId = typeof target === 'string' ? target : target.id;
    const publication = this.room._getPublication(publicationId);
    const origin = publication._publication.origin;
    if (!origin) {
      throw [errors.publicationNotHasOrigin];
    }

    this._local.unpublish(origin.id).catch((error) => {
      log.error('_unpublishAsSFU error', error, { target }, this.toJSON());
    });
    await this.room.onStreamUnpublished
      .watch(
        (e) => e.publication.id === publicationId,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw [{ ...errors.timeout, detail: 'onStreamUnpublished' }, error];
      });

    this.onStreamUnpublished.emit({ publication });
  }

  async subscribe<
    T extends RemoteVideoStream | RemoteAudioStream | RemoteDataStream
  >(
    target: string | RoomPublication,
    options?: SubscriptionOptions
  ): Promise<{ subscription: RoomSubscription<T>; stream: T }> {
    const publicationId = typeof target === 'string' ? target : target.id;
    const { subscription, stream } = await this._local.subscribe(
      publicationId,
      options
    );

    const roomSubscription = this.room._addSubscription(
      subscription as SubscriptionImpl
    );

    return {
      subscription: roomSubscription as RoomSubscription<T>,
      stream: stream as T,
    };
  }

  async unsubscribe(target: string | RoomSubscription) {
    const subscriptionId = typeof target === 'string' ? target : target.id;
    this._local.unsubscribe(subscriptionId).catch((error) => {
      log.error('unsubscribe error', error, { target }, this.toJSON());
    });
    await this.room.onPublicationUnsubscribed
      .watch(
        (e) => e.subscription.id === subscriptionId,
        this._context.config.rtcApi.timeout
      )
      .catch((error) => {
        throw [
          { ...errors.timeout, detail: 'onPublicationUnsubscribed' },
          error,
        ];
      });
  }
}

export type SFURoomPublicationOptions = {
  /** only for sfu publish */
  maxSubscribers?: number;
};

export type RoomPublicationOptions = PublicationOptions &
  SFURoomPublicationOptions;
