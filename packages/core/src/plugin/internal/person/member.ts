import { Event, EventDisposer, Logger } from '@skyway-sdk/common';

import { SkyWayChannelImpl } from '../../../channel';
import { SkyWayContext } from '../../../context';
import { errors } from '../../../errors';
import { RemoteAudioStream } from '../../../media/stream/remote/audio';
import { RemoteDataStream } from '../../../media/stream/remote/data';
import { RemoteVideoStream } from '../../../media/stream/remote/video';
import { MemberImpl } from '../../../member';
import { LocalPersonImpl } from '../../../member/localPerson';
import { Person } from '../../../member/person';
import {
  RemoteMember,
  RemoteMemberImplInterface,
} from '../../../member/remoteMember';
import { Subscription } from '../../../subscription';
import { createError } from '../../../util';
import { P2PConnection } from './connection';
import { PersonPlugin } from './plugin';

const log = new Logger('packages/core/src/plugin/internal/person/member.ts');

export type RemotePerson = RemoteMemberImplInterface &
  Person & {
    /**@description [japanese] この RemotePerson がPublicationをSubscribeしたとき */
    readonly onPublicationSubscribed: Event<{
      subscription: Subscription;
    }>;
    /**@description [japanese] この RemotePerson がPublicationをUnsubscribeしたとき */
    readonly onPublicationUnsubscribed: Event<{ subscription: Subscription }>;
    readonly onPublicationListChanged: Event<void>;
    readonly onSubscriptionListChanged: Event<void>;
    /**@description [japanese] この RemotePerson にPublicationをSubscribeさせる */
    subscribe: (
      publicationId: string
    ) => Promise<{ subscription: Subscription }>;
    /**@description [japanese] この RemotePerson にPublicationをUnsubscribeさせる */
    unsubscribe: (subscriptionId: string) => Promise<void>;
  };

/**@internal */
export class RemotePersonImpl extends MemberImpl implements RemotePerson {
  readonly type = 'person';
  readonly subtype = 'person';
  readonly side = 'remote';
  readonly plugin: PersonPlugin;
  private _connections: { [localPersonSystemId: string]: P2PConnection } = {};
  private _context = this.args.channel._context;
  private _disposer = new EventDisposer();

  readonly onPublicationSubscribed = this._events.make<{
    subscription: Subscription;
    stream?: RemoteVideoStream | RemoteAudioStream | RemoteDataStream;
  }>();
  readonly onPublicationUnsubscribed = this._events.make<{
    subscription: Subscription;
  }>();
  readonly onPublicationListChanged = this._events.make<void>();
  readonly onSubscriptionListChanged = this._events.make<void>();

  constructor(
    private args: {
      channel: SkyWayChannelImpl;
      name?: string;
      id: string;
      metadata?: string;
      plugin: PersonPlugin;
      context: SkyWayContext;
    }
  ) {
    super(args);

    this.plugin = args.plugin;

    this.channel.onPublicationUnsubscribed
      .add(({ subscription }) => {
        if (subscription.subscriber.id === this.id) {
          this.onPublicationUnsubscribed.emit({ subscription });
          this.onSubscriptionListChanged.emit();
        }
      })
      .disposer(this._disposer);
    this.channel.onPublicationSubscribed
      .add(({ subscription }) => {
        if (subscription.subscriber.id === this.id) {
          this.onPublicationSubscribed.emit({ subscription });
          this.onSubscriptionListChanged.emit();
        }
      })
      .disposer(this._disposer);
    this.channel.onStreamPublished
      .add(({ publication }) => {
        if (publication.publisher.id === this.id) {
          this.onPublicationListChanged.emit();
        }
      })
      .disposer(this._disposer);
    this.channel.onStreamUnpublished
      .add(({ publication }) => {
        if (publication.publisher.id === this.id) {
          this.onPublicationListChanged.emit();
        }
      })
      .disposer(this._disposer);
    this.onLeft.once(() => {
      log.debug('RemotePerson left: ', this.toJSON());
      Object.values(this._connections).forEach((connection) => {
        connection.close({ reason: 'remote person left' });
      });
      this._connections = {};
    });
  }

  /**@private */
  _getConnection(localPersonId: string): P2PConnection {
    return this._connections[localPersonId];
  }

  /**@private */
  _getOrCreateConnection(localPerson: LocalPersonImpl): P2PConnection {
    const connection =
      this._getConnection(localPerson.id) ??
      this._createConnection(this.channel, localPerson, this);

    return connection;
  }

  private _createConnection(
    channel: SkyWayChannelImpl,
    localPerson: LocalPersonImpl,
    endpointMember: RemoteMember
  ) {
    if (localPerson.side !== 'local') {
      throw createError({
        operationName: 'RemotePersonImpl._createConnection',
        info: {
          ...errors.invalidArgumentValue,
          detail: 'wrong localPerson type',
        },
        path: log.prefix,
        context: this._context,
        channel: this.channel,
      });
    }
    if (!localPerson._signaling) {
      throw createError({
        operationName: 'RemotePersonImpl._createConnection',
        info: {
          ...errors.missingProperty,
          detail: 'signalingSession not exist',
        },
        path: log.prefix,
        context: this._context,
        channel: this.channel,
      });
    }

    const connection = new P2PConnection(
      localPerson.iceManager,
      localPerson._signaling,
      localPerson._analytics,
      this._context,
      channel.id,
      localPerson,
      endpointMember
    );
    this.plugin._messageBuffers[localPerson.id].resolveMessagingBuffer(
      endpointMember
    );
    connection.onClose.once(() => {
      log.debug('connection closed', this.toJSON(), {
        connectionId: connection.id,
      });
      delete this._connections[localPerson.id];
    });
    this._connections[localPerson.id] = connection;
    return connection;
  }

  subscribe = (publicationId: string) =>
    new Promise<{ subscription: Subscription }>((r, f) => {
      let failed = false;
      this.channel._subscribe(this.id, publicationId).catch((e) => {
        failed = true;
        f(e);
      });

      this.onPublicationSubscribed
        .watch(
          ({ subscription }) => subscription.publication.id === publicationId,
          this._context.config.rtcApi.timeout
        )
        .then(({ subscription }) => {
          r({ subscription });
        })
        .catch(() => {
          if (!failed) {
            f(
              createError({
                operationName: 'RemotePersonImpl.subscribe',
                info: {
                  ...errors.timeout,
                  detail: 'onPublicationSubscribed',
                },
                path: log.prefix,
                context: this._context,
                channel: this.channel,
              })
            );
          }
        });
    });

  async unsubscribe(subscriptionId: string) {
    await this.channel._unsubscribe(subscriptionId);
  }

  _dispose() {
    this._disposer.dispose();
  }
}
