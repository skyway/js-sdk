import { Events, Logger } from '@skyway-sdk/common';
import model, {
  Channel,
  Member,
  Publication,
  Subscription,
} from '@skyway-sdk/model';
import {
  PublicationDisabledEvent,
  PublicationEnabledEvent,
  PublicationSummary,
  StreamSubscribedEvent,
  StreamUnsubscribedEvent,
  SubscriptionSummary,
} from '@skyway-sdk/rtc-rpc-api-client';
import {
  PublicationMetadataUpdatedEvent,
  StreamPublishedEvent,
  StreamUnpublishedEvent,
} from '@skyway-sdk/rtc-rpc-api-client';

import { Config } from '../config';
import { errors } from '../errors';
import * as event from '../model/event';
import { createError } from '../util';
import { MemberInit, PublicationInit, RtcApi, SubscriptionInit } from './api';
import { EventObserver } from './eventObserver';

const log = new Logger('packages/rtc-api-client/src/domain/channel.ts');

export class ChannelImpl implements model.Channel {
  readonly id: string;
  readonly name: string;
  metadata?: string;
  members: model.Member[];
  getMember(id: string) {
    return this.members.find((s) => s.id === id);
  }
  addMember(member: model.Member) {
    const exist = this.getMember(member.id);
    if (exist) {
      return exist;
    }
    this.members.push(member);
    return member;
  }
  deleteMember(id: string) {
    this.members = this.members.filter((m) => m.id !== id);
  }
  publications: model.Publication[];
  getPublication(id: string) {
    return this.publications.find((s) => s.id === id);
  }
  addPublication(summary: PublicationSummary) {
    const exist = this.getPublication(summary.id);
    if (exist) {
      return exist;
    }
    const publication: Publication = {
      ...summary,
      channelId: this.id,
      codecCapabilities: summary.codecCapabilities ?? [],
      encodings: summary.encodings ?? [],
    };
    this.publications.push(publication);
    return publication;
  }
  deletePublication(publicationId: string) {
    this.publications = this.publications.filter((p) => p.id !== publicationId);
  }
  subscriptions: model.Subscription[];
  getSubscription(id: string) {
    return this.subscriptions.find((s) => s.id === id);
  }
  addSubscription(summary: SubscriptionSummary) {
    const exist = this.getSubscription(summary.id);
    if (exist) {
      return exist;
    }

    const publication = this.getPublication(summary.publicationId)!;

    const subscription: Subscription = {
      ...summary,
      channelId: this.id,
      publisherId: publication.publisherId,
      contentType: publication.contentType,
    };
    this.subscriptions.push(subscription);
    return subscription;
  }
  deleteSubscription(subscriptionId: string) {
    this.subscriptions = this.subscriptions.filter(
      (s) => s.id !== subscriptionId
    );
  }
  version: number;
  disposed = false;

  // events
  private readonly _events = new Events();
  readonly onClosed = this._events.make<event.ChannelClosedEvent>();
  readonly onMetadataUpdated =
    this._events.make<event.ChannelMetadataUpdatedEvent>();
  readonly onMemberListChanged = this._events.make<event.ChangedEvent>();
  readonly onMemberJoined = this._events.make<event.MemberJoinedEvent>();
  readonly onMemberLeft = this._events.make<event.MemberLeftEvent>();
  readonly onMemberMetadataUpdated =
    this._events.make<event.MemberMetadataUpdatedEvent>();
  readonly onPublicationDisabled =
    this._events.make<event.PublicationDisabledEvent>();
  readonly onPublicationEnabled =
    this._events.make<event.PublicationEnabledEvent>();
  readonly onPublicationListChanged = this._events.make<event.ChangedEvent>();
  readonly onStreamPublished = this._events.make<event.StreamPublishedEvent>();
  readonly onStreamUnpublished =
    this._events.make<event.StreamUnpublishedEvent>();
  readonly onPublicationMetadataUpdated =
    this._events.make<event.PublicationMetadataUpdatedEvent>();
  readonly onSubscriptionListChanged = this._events.make<event.ChangedEvent>();
  readonly onPublicationSubscribed =
    this._events.make<event.StreamSubscribedEvent>();
  readonly onPublicationUnsubscribed =
    this._events.make<event.StreamUnsubscribedEvent>();

  constructor(
    readonly appId: string,
    {
      id,
      name,
      members,
      metadata,
      publications,
      subscriptions,
      version,
    }: model.Channel,
    private eventObserver: EventObserver,
    private apiClient: RtcApi,
    private config: Config
  ) {
    this.id = id;
    this.name = name;
    this.metadata = metadata;
    this.members = members;
    this.publications = publications;
    this.subscriptions = subscriptions;
    this.version = version;

    eventObserver.onEvent.add((event) => {
      log.debug('received event: ', event);
      this.version = event.data.channel.version;

      try {
        switch (event.type) {
          case 'ChannelDeleted':
            {
              this._channelClosed();
            }
            break;
          case 'ChannelMetadataUpdated':
            {
              this._channelMetadataUpdated(event.data);
            }
            break;
          case 'MemberAdded':
            {
              this._memberJoined(event.data);
            }
            break;
          case 'MemberRemoved':
            {
              this._memberLeft(event.data);
            }
            break;
          case 'MemberMetadataUpdated':
            {
              this._memberMetadataUpdated(event.data);
            }
            break;
          case 'StreamPublished':
            {
              this._streamPublished(event.data);
            }
            break;
          case 'StreamUnpublished':
            {
              this._streamUnpublished(event.data);
            }
            break;
          case 'PublicationMetadataUpdated':
            {
              this._publicationMetadataUpdated(event.data);
            }
            break;
          case 'PublicationDisabled':
            {
              this._publicationDisabled(event.data);
            }
            break;
          case 'PublicationEnabled':
            {
              this._publicationEnabled(event.data);
            }
            break;
          case 'StreamSubscribed':
            {
              this._streamSubscribed(event.data);
            }
            break;
          case 'StreamUnsubscribed':
            {
              this._streamUnsubscribed(event.data);
            }
            break;
        }
      } catch (error) {
        log.error(error);
      }
    });

    apiClient.onClose.once(() => {
      this.dispose();
    });
  }

  private _channelClosed() {
    this.onClosed.emit({});
  }

  private _channelMetadataUpdated(event: event.ChannelMetadataUpdatedEvent) {
    this.metadata = event.channel.metadata;
    this.onMetadataUpdated.emit(event);
  }

  private _memberJoined(event: event.MemberJoinedEvent) {
    this.addMember(event.member);
    this.onMemberJoined.emit(event);
    this.onMemberListChanged.emit({});
  }

  private _memberLeft(event: event.MemberLeftEvent) {
    const member = this.getMember(event.member.id);
    if (!member) {
      throw createError({
        operationName: 'ChannelImpl._memberLeft',
        info: errors.memberNotFound,
        path: log.prefix,
        payload: { event },
        appId: this.appId,
        channelId: this.id,
      });
    }

    this.deleteMember(member.id);
    this.onMemberLeft.emit({ member });
    this.onMemberListChanged.emit({});
  }

  private _memberMetadataUpdated(event: event.MemberMetadataUpdatedEvent) {
    const member = this.getMember(event.member.id);
    if (!member) {
      throw createError({
        operationName: 'ChannelImpl._memberMetadataUpdated',
        info: errors.memberNotFound,
        path: log.prefix,
        payload: { event },
        appId: this.appId,
        channelId: this.id,
      });
    }

    member.metadata = event.member.metadata;
    this.onMemberMetadataUpdated.emit(event);
  }

  private _streamPublished(event: StreamPublishedEvent['data']) {
    const publication: Publication = this.addPublication(event.publication);

    const outgoing: event.StreamPublishedEvent = {
      ...event,
      publication,
    };

    this.onStreamPublished.emit(outgoing);
    this.onPublicationListChanged.emit({});
  }

  private _streamUnpublished(event: StreamUnpublishedEvent['data']) {
    const publication = this.getPublication(event.publication.id);
    if (!publication) {
      throw createError({
        operationName: 'ChannelImpl._streamUnpublished',
        info: errors.publicationNotFound,
        path: log.prefix,
        payload: { event },
        appId: this.appId,
        channelId: this.id,
      });
    }

    this.deletePublication(publication.id);

    const outgoing: event.StreamUnpublishedEvent = { ...event, publication };

    this.onStreamUnpublished.emit(outgoing);
    this.onPublicationListChanged.emit({});
  }

  private _publicationMetadataUpdated(
    event: PublicationMetadataUpdatedEvent['data']
  ) {
    const publication = this.getPublication(event.publication.id);
    if (!publication) {
      throw createError({
        operationName: 'ChannelImpl._publicationMetadataUpdated',
        info: errors.publicationNotFound,
        path: log.prefix,
        payload: { event },
        appId: this.appId,
        channelId: this.id,
      });
    }

    publication.metadata = event.publication.metadata;

    const outgoing: event.PublicationMetadataUpdatedEvent = {
      ...event,
      publication,
    };
    this.onPublicationMetadataUpdated.emit(outgoing);
  }

  private _publicationDisabled(event: PublicationDisabledEvent['data']) {
    const publication = this.getPublication(event.publication.id);
    if (!publication) {
      throw createError({
        operationName: 'ChannelImpl._publicationDisabled',
        info: errors.publicationNotFound,
        path: log.prefix,
        payload: { event },
        appId: this.appId,
        channelId: this.id,
      });
    }
    publication.isEnabled = event.publication.isEnabled;

    const outgoing: event.PublicationDisabledEvent = {
      publication,
    };
    this.onPublicationDisabled.emit(outgoing);
  }

  private _publicationEnabled(incoming: PublicationEnabledEvent['data']) {
    const publication = this.getPublication(incoming.publication.id);
    if (!publication) {
      throw createError({
        operationName: 'ChannelImpl._publicationEnabled',
        info: errors.publicationNotFound,
        path: log.prefix,
        payload: { event },
        appId: this.appId,
        channelId: this.id,
      });
    }
    publication.isEnabled = incoming.publication.isEnabled;

    const outgoing: event.PublicationEnabledEvent = {
      publication,
    };
    this.onPublicationEnabled.emit(outgoing);
  }

  private _streamSubscribed(incoming: StreamSubscribedEvent['data']) {
    const subscription = this.addSubscription(incoming.subscription);

    const outgoing: event.StreamSubscribedEvent = {
      ...incoming,
      subscription,
    };

    this.onPublicationSubscribed.emit(outgoing);
    this.onSubscriptionListChanged.emit({});
  }

  private _streamUnsubscribed(event: StreamUnsubscribedEvent['data']) {
    const subscription = this.getSubscription(event.subscription.id);
    if (!subscription) {
      throw createError({
        operationName: 'ChannelImpl._streamUnsubscribed',
        info: errors.subscriptionNotFound,
        path: log.prefix,
        payload: { event },
        appId: this.appId,
        channelId: this.id,
      });
    }

    this.deleteSubscription(subscription.id);

    const outgoing: event.StreamUnsubscribedEvent = {
      ...event,
      subscription,
    };

    this.onPublicationUnsubscribed.emit(outgoing);
    this.onSubscriptionListChanged.emit({});
  }

  updateChannelMetadata = (metadata: string) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient
        .updateChannelMetadata(this.appId, this.id, metadata)
        .catch((e) => {
          failed = true;
          f(e);
        });
      this.onMetadataUpdated
        .watch((e) => e.channel.metadata === metadata)
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.updateChannelMetadata',
                info: { ...errors.timeout, detail: 'onMetadataUpdated' },
                path: log.prefix,
                error,
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  async joinChannel(memberInit: MemberInit) {
    if (memberInit.type) {
      memberInit.type = (memberInit.type[0].toUpperCase() +
        memberInit.type.slice(1)) as any;
    }
    if (memberInit.subtype) {
      memberInit.subtype = (memberInit.subtype[0].toUpperCase() +
        memberInit.subtype.slice(1)) as any;
    }

    log.debug('[start] joinChannel', { memberInit });
    const res = await this.apiClient.join(this.appId, this.id, {
      ...memberInit,
    });

    const member =
      this.getMember(res.id) ??
      (
        await this.onMemberJoined
          .watch((e) => e.member.id === res.id, this.config.rtcApi.timeout)
          .catch((error) => {
            throw createError({
              operationName: 'ChannelImpl.joinChannel',
              info: { ...errors.timeout, detail: 'onMemberJoined' },
              path: log.prefix,
              error,
              appId: this.appId,
              channelId: this.id,
            });
          })
      ).member;
    log.debug('[end] joinChannel', { member });
    return member;
  }

  leave = (channelId: Channel['id'], memberId: Member['id']) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient.leave(this.appId, channelId, memberId).catch((e) => {
        failed = true;
        f(e);
      });
      this.onMemberLeft
        .watch((e) => e.member.id === memberId, this.config.rtcApi.timeout)
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.leave',
                info: { ...errors.timeout, detail: 'onMemberLeft' },
                path: log.prefix,
                error,
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  updateMemberTtl(memberId: Member['id'], ttlSec: number) {
    return this.apiClient.updateMemberTtl(
      this.appId,
      this.id,
      memberId,
      ttlSec
    );
  }

  updateMemberMetadata = (memberId: Member['id'], metadata: string) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient
        .updateMemberMetadata(this.appId, this.id, memberId, metadata)
        .catch((e) => {
          failed = true;
          f(e);
        });
      this.onMemberMetadataUpdated
        .watch(
          (e) => e.member.id === memberId && e.member.metadata === metadata
        )
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.updateMemberMetadata',
                info: { ...errors.timeout, detail: 'onMemberMetadataUpdated' },
                path: log.prefix,
                error,
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  /**@throws {SkyWayError} */
  async publish(init: Omit<PublicationInit, 'channel'>): Promise<Publication> {
    const ts = log.debug('[start] apiClient.publish', { init });
    const channelId = this.id;
    const publicationId = await this.apiClient.publish(this.appId, {
      ...init,
      channel: channelId,
    });

    const publicationDto: Publication = {
      id: publicationId,
      channelId,
      publisherId: init.publisher,
      origin: init.origin,
      contentType: init.contentType,
      metadata: init.metadata,
      codecCapabilities: init.codecCapabilities ?? [],
      encodings: init.encodings ?? [],
      isEnabled: init.isEnabled ?? true,
    };
    log.elapsed(ts, '[ongoing] apiClient.publish', { publicationDto });

    const exist = this.getPublication(publicationId);
    if (exist) {
      return exist;
    }

    const { publication } = await this.onStreamPublished
      .watch(
        (e) => e.publication.id === publicationId,
        this.config.rtcApi.timeout
      )
      .catch((error) => {
        throw createError({
          operationName: 'ChannelImpl.publish',
          info: { ...errors.timeout, detail: 'onStreamPublished' },
          path: log.prefix,
          error,
          payload: { publicationDto },
          appId: this.appId,
          channelId: this.id,
        });
      });
    log.elapsed(ts, '[end] apiClient.publish', { publicationDto });

    return publication;
  }

  unpublish = (publicationId: Publication['id']) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient
        .unpublish(this.appId, this.id, publicationId)
        .catch((e) => {
          failed = true;
          f(e);
        });
      this.onStreamUnpublished
        .watch((e) => e.publication.id === publicationId)
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.unpublish',
                info: { ...errors.timeout, detail: 'onStreamUnpublished' },
                path: log.prefix,
                error,
                payload: { publicationId },
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  updatePublicationMetadata = (
    publicationId: Publication['id'],
    metadata: string
  ) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient
        .updatePublicationMetadata(this.appId, this.id, publicationId, metadata)
        .catch((e) => {
          failed = true;
          f(e);
        });
      this.onPublicationMetadataUpdated
        .watch(
          (e) =>
            e.publication.id === publicationId &&
            e.publication.metadata === metadata
        )
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.updatePublicationMetadata',
                info: {
                  ...errors.timeout,
                  detail: 'onPublicationMetadataUpdated',
                },
                path: log.prefix,
                error,
                payload: { publicationId },
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  disablePublication = (publicationId: Publication['id']) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient
        .disablePublication(this.appId, this.id, publicationId)
        .catch((e) => {
          failed = true;
          f(e);
        });
      this.onPublicationDisabled
        .watch((e) => e.publication.id === publicationId)
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.disablePublication',
                info: { ...errors.timeout, detail: 'onPublicationDisabled' },
                path: log.prefix,
                error,
                payload: { publicationId },
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  enablePublication = (publicationId: Publication['id']) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient
        .enablePublication(this.appId, this.id, publicationId)
        .catch((e) => {
          failed = true;
          f(e);
        });
      this.onPublicationEnabled
        .watch((e) => e.publication.id === publicationId)
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.enablePublication',
                info: { ...errors.timeout, detail: 'onPublicationEnabled' },
                path: log.prefix,
                error,
                payload: { publicationId },
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  /**@throws {@link SkyWayError} */
  async subscribe(
    init: Omit<SubscriptionInit, 'channel'>
  ): Promise<model.Subscription> {
    const ts = log.debug('[start] apiClient.subscribe', { init });
    const subscriptionId = await this.apiClient.subscribe(this.appId, {
      ...init,
      channel: this,
    });

    const subscriptionDto: Subscription = {
      id: subscriptionId,
      publicationId: init.publication.id,
      channelId: this.id,
      publisherId: init.publication.publisherId,
      subscriberId: init.subscriber.id,
      contentType: init.publication.contentType,
    };
    log.elapsed(ts, '[ongoing] apiClient.subscribe', { subscriptionDto });

    const exist = this.getSubscription(subscriptionId);
    if (exist) {
      log.elapsed(ts, '[end] apiClient.subscribe', { subscriptionDto });
      return exist;
    }

    const { subscription } = await this.onPublicationSubscribed
      .watch(
        (e) => e.subscription.id === subscriptionId,
        this.config.rtcApi.timeout
      )
      .catch((error) => {
        log.elapsed(ts, '[fail] apiClient.subscribe', error);
        throw createError({
          operationName: 'ChannelImpl.subscribe',
          info: { ...errors.timeout, detail: 'onPublicationSubscribed' },
          path: log.prefix,
          error,
          payload: { subscriptionDto },
        });
      });
    log.elapsed(ts, '[end] apiClient.subscribe', { subscriptionDto });

    return subscription;
  }

  unsubscribe = (subscriptionId: Subscription['id']) =>
    new Promise<void>((r, f) => {
      let failed = false;
      this.apiClient
        .unsubscribe(this.appId, this.id, subscriptionId)
        .catch((e) => {
          failed = true;
          f(e);
        });
      this.onPublicationUnsubscribed
        .watch((e) => e.subscription.id === subscriptionId)
        .then(() => r())
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'ChannelImpl.unsubscribe',
                info: {
                  ...errors.timeout,
                  detail: 'onPublicationUnsubscribed',
                },
                path: log.prefix,
                error,
                payload: { subscriptionId },
                appId: this.appId,
                channelId: this.id,
              })
            );
        });
    });

  close() {
    return this.apiClient.deleteChannel(this.appId, this.id);
  }

  /**
   * リソースの解放
   * - Channelイベントの購読停止
   * - イベントリスナー
   */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    log.debug('disposed', { id: this.id });

    this.eventObserver.dispose();
    this._events.dispose();
  }
}

export function channelFactory(
  appId: string,
  eventObserver: EventObserver,
  api: RtcApi,
  channelDto: Channel,
  config: Config
) {
  const channel = new ChannelImpl(
    appId,
    channelDto,
    eventObserver,
    api,
    config
  );
  return channel;
}
