import { Event, SkyWayError } from '@skyway-sdk/common';
import { Logger } from '@skyway-sdk/common';
import { Events } from '@skyway-sdk/common';
import model from '@skyway-sdk/model';
import {
  ChannelImpl,
  ChannelInit,
  ChannelQuery,
  MemberInit,
  PublicationInit,
} from '@skyway-sdk/rtc-api-client';

import { MemberInternalConfig, LocalMemberConfig } from '../config';
import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { Member } from '../member';
import {
  createLocalPerson,
  LocalPerson,
  LocalPersonAdapter,
  LocalPersonImpl,
} from '../member/localPerson';
import {
  RemoteMember,
  RemoteMemberImplInterface,
} from '../member/remoteMember';
import { Publication, PublicationImpl } from '../publication';
import { createPublication } from '../publication/factory';
import { Subscription, SubscriptionImpl } from '../subscription';
import { createSubscription } from '../subscription/factory';
import { createError, createLogPayload } from '../util';
import {
  ChannelClosedEvent,
  ChannelMetadataUpdatedEvent,
  ListChangedEvent,
  MemberJoinedEvent,
  MemberLeftEvent,
  MemberMetadataUpdatedEvent,
  PublicationDisabledEvent,
  PublicationEnabledEvent,
  PublicationMetadataUpdatedEvent,
  StreamPublishedEvent,
  StreamSubscribedEvent,
  StreamUnpublishedEvent,
  StreamUnsubscribedEvent,
} from './event';

export type { ChannelInit, ChannelQuery, MemberInit };

const log = new Logger('packages/core/src/channel/index.ts');

export interface Channel {
  readonly id: string;
  readonly name?: string;
  readonly appId: string;
  metadata?: string;
  state: ChannelState;

  /**
   * @description [japanese] このChannelが閉じられた時に発生するイベント
   */
  readonly onClosed: Event<ChannelClosedEvent>;
  /**
   * @description [japanese] このChannelのMetadataが更新された時に発生するイベント
   */
  readonly onMetadataUpdated: Event<ChannelMetadataUpdatedEvent>;

  /**@description [japanese] このChannelのMemberの数が変化した時に発生するイベント */
  readonly onMemberListChanged: Event<ListChangedEvent>;
  /**
   * @description [japanese] ChannelにMemberが参加した時に発生するイベント
   */
  readonly onMemberJoined: Event<MemberJoinedEvent>;
  /**
   * @description [japanese] ChannelからMemberが退出した時に発生するイベント
   */
  readonly onMemberLeft: Event<MemberLeftEvent>;
  /**
   * @description [japanese] MemberのMetadataが更新された時に発生するイベント
   */
  readonly onMemberMetadataUpdated: Event<MemberMetadataUpdatedEvent>;

  /**
   * @description [japanese] ChannelにStreamがPublishされた時に発生するイベント
   */
  readonly onStreamPublished: Event<StreamPublishedEvent>;
  /**
   * @description [japanese] ChannelからStreamがUnpublishされた時に発生するイベント
   */
  readonly onStreamUnpublished: Event<StreamUnpublishedEvent>;
  /**@description [japanese] このChannelのPublicationの数が変化した時に発生するイベント */
  readonly onPublicationListChanged: Event<ListChangedEvent>;
  /**
   * @description [japanese] StreamのPublicationのMetadataが更新された時に発生するイベント
   */
  readonly onPublicationMetadataUpdated: Event<PublicationMetadataUpdatedEvent>;
  /**@description [japanese] このChannelのPublicationが有効化された時に発生するイベント */
  readonly onPublicationEnabled: Event<PublicationEnabledEvent>;
  /**@description [japanese] このChannelのPublicationが無効化された時に発生するイベント */
  readonly onPublicationDisabled: Event<PublicationDisabledEvent>;

  /**
   * @description [japanese] ChannelのPublicationがSubscribeされた時に発生するイベント
   */
  readonly onPublicationSubscribed: Event<StreamSubscribedEvent>;
  /**
   * @description [japanese] ChannelのPublicationがUnsubscribeされた時に発生するイベント
   */
  readonly onPublicationUnsubscribed: Event<StreamUnsubscribedEvent>;
  /**@description [japanese] このChannelのSubscriptionの数が変化した時に発生するイベント */
  readonly onSubscriptionListChanged: Event<ListChangedEvent>;

  /**
   * @description [japanese] Channel中のMemberの一覧を取得する
   */
  members: RemoteMember[];

  /**
   * @description [japanese] Channel中のLocalPersonを取得する
   */
  localPerson?: LocalPerson;

  /**
   * @description [japanese] Channel中のBotの一覧を取得する
   */
  bots: RemoteMember[];

  /**
   * @description [japanese] Channel中のPublicationの一覧を取得する
   */
  publications: Publication[];

  /**
   * @description [japanese] Channel中のSubscriptionの一覧を取得する
   */
  subscriptions: Subscription[];

  /**
   * @description [japanese] ChannelにMemberを追加する
   */
  join: (
    memberInit?: {
      name?: MemberInit['name'];
      metadata?: MemberInit['metadata'];
    } & Partial<LocalMemberConfig>
  ) => Promise<LocalPerson>;

  /**
   * @description [japanese] ChannelからMemberを退出させる
   */
  leave: (member: Member) => Promise<void>;

  /**
   * @deprecated
   * @description [japanese] 別のChannelのMemberを移動させる
   */
  moveChannel: (adapter: LocalPerson) => Promise<void>;

  /**
   * @description [japanese] ChannelのMetadataを更新する
   */
  updateMetadata: (metadata: string) => Promise<void>;

  /**
   * @description [japanese] Channelを閉じる。
   */
  close: () => Promise<void>;
  /**
   * @description [japanese] Channelを閉じずにChannelインスタンスの利用を終了し次のリソースを解放する。
   * - サーバとの通信
   * - イベントリスナー
   * - LocalPersonのインスタンス
   */
  dispose: () => void;
}

/**@internal */
export class SkyWayChannelImpl implements Channel {
  readonly id: model.Channel['id'] = this._channelImpl.id;
  readonly name: model.Channel['name'] = this._channelImpl.name;
  readonly appId = this._context.appId;
  _localPerson?: LocalPersonImpl;
  disposed = false;
  readonly config = this._context.config;

  private _state: ChannelState = 'opened';
  private readonly _api = this._context._api;

  private _members: {
    [memberId: model.Channel['id']]: RemoteMemberImplInterface;
  } = {};
  /**@private */
  _getMember = (id: string) => this._members[id];
  private _addMember(memberDto: model.Member) {
    const exist = this._getMember(memberDto.id);
    if (exist) {
      return exist;
    }
    const member = this._context._createRemoteMember(this, memberDto);
    this._members[member.id] = member as RemoteMemberImplInterface;
    return member;
  }
  private _removeMember(memberId: model.Channel['id']) {
    delete this._members[memberId];
  }

  private _publications: { [publicationId: string]: PublicationImpl } = {};
  /**@private */
  _getPublication = (id: string) => this._publications[id];
  /**@private */
  _addPublication(p: model.Publication) {
    const exist = this._getPublication(p.id);
    if (exist) {
      return exist;
    }
    const publication = createPublication(this, p);
    this._publications[p.id] = publication;
    return publication;
  }
  private _removePublication(publicationId: string) {
    delete this._publications[publicationId];
  }

  private _subscriptions: { [subscriptionId: string]: SubscriptionImpl } = {};
  /**@private */
  _getSubscription = (id: string) => this._subscriptions[id];
  /**@private */
  _addSubscription(s: model.Subscription) {
    const exist = this._getSubscription(s.id);
    if (exist) {
      return exist;
    }
    const subscription = createSubscription(this, s);
    this._subscriptions[s.id] = subscription;
    return subscription;
  }
  private _removeSubscription(subscriptionId: string) {
    delete this._subscriptions[subscriptionId];
  }

  // events
  private readonly _events = new Events();
  readonly onClosed = this._events.make<ChannelClosedEvent>();
  readonly onMetadataUpdated = this._events.make<ChannelMetadataUpdatedEvent>();

  readonly onMemberListChanged = this._events.make<ListChangedEvent>();
  readonly onMemberJoined = this._events.make<MemberJoinedEvent>();
  readonly onMemberLeft = this._events.make<MemberLeftEvent>();
  readonly onMemberMetadataUpdated =
    this._events.make<MemberMetadataUpdatedEvent>();

  readonly onPublicationListChanged = this._events.make<ListChangedEvent>();
  readonly onStreamPublished = this._events.make<StreamPublishedEvent>();
  readonly onStreamUnpublished = this._events.make<StreamUnpublishedEvent>();
  readonly onPublicationMetadataUpdated =
    this._events.make<PublicationMetadataUpdatedEvent>();
  readonly onPublicationEnabled = this._events.make<PublicationEnabledEvent>();
  readonly onPublicationDisabled =
    this._events.make<PublicationDisabledEvent>();

  readonly onSubscriptionListChanged = this._events.make<ListChangedEvent>();
  readonly onPublicationSubscribed = this._events.make<StreamSubscribedEvent>();
  readonly onPublicationUnsubscribed =
    this._events.make<StreamUnsubscribedEvent>();

  /**@private */
  readonly _onDisposed = this._events.make<void>();

  constructor(
    /**@private */
    readonly _context: SkyWayContext,
    /**@private */
    private readonly _channelImpl: ChannelImpl
  ) {
    this._setupPropertiesFromChannel();
    this._setupListenChannelEvent();

    _context._onDisposed.once(() => {
      this.dispose();
    });

    log.debug('channel spawned', this.toJSON());
  }

  get localPerson() {
    return this._localPerson;
  }

  get members() {
    return Object.values(this._members);
  }

  get bots(): RemoteMember[] {
    return this.members.filter((m) => m.type === 'bot') as RemoteMember[];
  }

  get publications(): Publication[] {
    return Object.values(this._publications);
  }

  get subscriptions(): Subscription[] {
    return Object.values(this._subscriptions);
  }

  get metadata() {
    return this._channelImpl.metadata;
  }

  get state() {
    return this._state;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      appId: this.appId,
      metadata: this.metadata,
      members: this.members,
      publications: this.publications,
      subscriptions: this.subscriptions,
    };
  }

  private _setupPropertiesFromChannel() {
    this._channelImpl.members.forEach((memberDto) => {
      this._addMember(memberDto);
    });
    this._channelImpl.publications.forEach((publicationDto) => {
      this._addPublication(publicationDto);
    });
    this._channelImpl.subscriptions.forEach((subscriptionDto) => {
      this._addSubscription(subscriptionDto);
    });
  }

  private _setupListenChannelEvent() {
    this._channelImpl.onClosed.add(() => this._handleOnChannelClose());
    this._channelImpl.onMetadataUpdated.add(({ channel }) =>
      this._handleOnChannelMetadataUpdate(channel.metadata)
    );

    this._channelImpl.onMemberJoined.add(({ member }) => {
      this._handleOnMemberJoin(member);
    });
    this._channelImpl.onMemberLeft.add(({ member }) => {
      this._handleOnMemberLeft(member);
    });
    this._channelImpl.onMemberListChanged.pipe(this.onMemberListChanged);
    this._channelImpl.onMemberMetadataUpdated.add(({ member }) => {
      this._handleOnMemberMetadataUpdate(member, member.metadata!);
    });

    this._channelImpl.onStreamPublished.add(({ publication }) => {
      this._handleOnStreamPublish(publication);
    });
    this._channelImpl.onStreamUnpublished.add(({ publication }) => {
      this._handleOnStreamUnpublish(publication);
    });
    this._channelImpl.onPublicationListChanged.pipe(
      this.onPublicationListChanged
    );
    this._channelImpl.onPublicationMetadataUpdated.add(({ publication }) => {
      this._handleOnPublicationMetadataUpdate(
        publication,
        publication.metadata!
      );
    });
    this._channelImpl.onPublicationEnabled.add(
      async ({ publication }) =>
        await this._handleOnPublicationEnabled(publication)
    );
    this._channelImpl.onPublicationDisabled.add(
      async ({ publication }) =>
        await this._handleOnPublicationDisabled(publication)
    );
    this._channelImpl.onPublicationSubscribed.add(({ subscription }) => {
      this._handleOnStreamSubscribe(subscription);
    });
    this._channelImpl.onPublicationUnsubscribed.add(({ subscription }) => {
      this._handleOnStreamUnsubscribe(subscription);
    });
    this._channelImpl.onSubscriptionListChanged.pipe(
      this.onSubscriptionListChanged
    );
  }

  private _handleOnChannelClose() {
    this._state = 'closed';
    this.onClosed.emit({});

    this.dispose();
  }

  private _handleOnChannelMetadataUpdate(metadata: string) {
    this.onMetadataUpdated.emit({ metadata });
  }

  private _handleOnMemberJoin(memberDto: model.Member) {
    const member = this._addMember(memberDto);
    this.onMemberJoined.emit({ member });
  }

  private _handleOnMemberLeft(memberDto: model.Member) {
    const member = this._getMember(memberDto.id);
    this._removeMember(member.id);
    member._left();

    if (this.localPerson?.id === memberDto.id) {
      this.localPerson._left();
      this._localPerson = undefined;
    }

    this.onMemberLeft.emit({ member });
  }

  private _handleOnMemberMetadataUpdate(
    memberDto: model.Member,
    metadata: string
  ) {
    const member = this._getMember(memberDto.id);
    member._metadataUpdated(metadata);

    if (this.localPerson?.id === memberDto.id) {
      this.localPerson._metadataUpdated(metadata);
    }

    this.onMemberMetadataUpdated.emit({ member, metadata });
  }

  private _handleOnStreamPublish(publicationDto: model.Publication) {
    const publication = this._addPublication(publicationDto);

    this.onStreamPublished.emit({ publication });
  }

  private _handleOnStreamUnpublish(publicationDto: model.Publication) {
    const publication = this._getPublication(publicationDto.id);

    this._removePublication(publication.id);

    publication._unpublished();
    this.onStreamUnpublished.emit({ publication });
  }

  private _handleOnPublicationMetadataUpdate(
    publicationDto: model.Publication,
    metadata: string
  ) {
    const publication = this._getPublication(publicationDto.id);
    publication._updateMetadata(metadata);

    this.onPublicationMetadataUpdated.emit({ publication, metadata });
  }

  private async _handleOnPublicationEnabled(publicationDto: model.Publication) {
    const publication = this._getPublication(publicationDto.id);
    publication._enable();

    this.onPublicationEnabled.emit({ publication });
  }

  private async _handleOnPublicationDisabled(
    publicationDto: model.Publication
  ) {
    const publication = this._getPublication(publicationDto.id);
    await publication._disable();

    this.onPublicationDisabled.emit({ publication });
  }

  private _handleOnStreamSubscribe(subscriptionDto: model.Subscription) {
    const subscription = this._addSubscription(subscriptionDto);

    const publication = this._getPublication(subscription.publication.id);
    publication._subscribed(subscription);

    this.onPublicationSubscribed.emit({ subscription });
  }

  private _handleOnStreamUnsubscribe(subscriptionDto: model.Subscription) {
    const subscription = this._getSubscription(subscriptionDto.id);
    this._removeSubscription(subscription.id);
    subscription._canceled();

    const publication = this._getPublication(subscription.publication.id);
    publication._unsubscribed(subscription);

    this.onPublicationUnsubscribed.emit({ subscription });
  }

  async join(options: PersonInit = {}) {
    const timestamp = log.info(
      '[start] join',
      await createLogPayload({
        operationName: 'SkyWayChannelImpl.join',
        channel: this,
      })
    );

    if (this._localPerson) {
      throw createError({
        operationName: 'SkyWayChannelImpl.join',
        path: log.prefix,
        info: errors.alreadyLocalPersonExist,
        channel: this,
        context: this._context,
      });
    }

    if (options.name != undefined) {
      const exist = this.members.find((m) => m.name === options.name);
      if (exist) {
        throw createError({
          operationName: 'SkyWayChannelImpl.join',
          path: log.prefix,
          info: errors.alreadySameNameMemberExist,
          channel: this,
          context: this._context,
          payload: options,
        });
      }
    }

    options.keepaliveIntervalSec ??= this.config.member.keepaliveIntervalSec;
    options.keepaliveIntervalGapSec ??=
      this.config.member.keepaliveIntervalGapSec;
    options.preventAutoLeaveOnBeforeUnload ??=
      this.config.member.preventAutoLeaveOnBeforeUnload;

    const init: MemberInit = {
      ...options,
      type: 'person',
      subtype: 'person',
    };
    if (options.keepaliveIntervalSec !== null) {
      init['ttlSec'] =
        (await this._context._api.getServerUnixtimeInSec()) +
        options.keepaliveIntervalSec;
    }

    const member = await this._channelImpl.joinChannel(init).catch((e) => {
      log.error('[failed] join', e);
      throw e;
    });
    log.elapsed(timestamp, '[elapsed] join / channelImpl.joinChannel', {
      member,
    });

    const person = await this._createLocalPerson(member, options);
    const adapter = new LocalPersonAdapter(person);
    log.elapsed(timestamp, '[end] join', { person });

    return adapter as LocalPerson;
  }

  readonly leave = async (member: Member) =>
    this._channelImpl.leave(this.id, member.id);

  async moveChannel(adapter: LocalPerson) {
    if (this._localPerson) {
      throw createError({
        operationName: 'SkyWayChannelImpl.moveChannel',
        path: log.prefix,
        info: errors.alreadyLocalPersonExist,
        channel: this,
        context: this._context,
      });
    }

    if (!(adapter instanceof LocalPersonAdapter)) {
      throw createError({
        operationName: 'SkyWayChannelImpl.moveChannel',
        path: log.prefix,
        info: errors.invalidArgumentValue,
        channel: this,
        context: this._context,
      });
    }

    const leaveChannel = adapter.channel;
    if (this.id === leaveChannel.id) {
      throw createError({
        operationName: 'SkyWayChannelImpl.moveChannel',
        path: log.prefix,
        info: errors.cantMoveSameIdChannel,
        channel: this,
        context: this._context,
      });
    }
    await leaveChannel.leave(adapter);

    const init: MemberInit = {
      name: adapter.name,
      type: adapter.type,
      subtype: adapter.subtype,
      metadata: adapter.metadata,
    };
    if (adapter.keepaliveIntervalSec != undefined) {
      init['ttlSec'] =
        (await this._context._api.getServerUnixtimeInSec()) +
        adapter.keepaliveIntervalSec;
    }
    const member = await this._channelImpl.joinChannel(init);
    const person = await this._createLocalPerson(member, {
      keepaliveIntervalSec: adapter.keepaliveIntervalSec,
      keepaliveIntervalGapSec: adapter.keepaliveIntervalGapSec,
      disableSignaling: adapter.disableSignaling,
      disableAnalytics: adapter.disableAnalytics,
    });
    adapter.apply(person);
  }

  private async _createLocalPerson(
    member: model.Member,
    config: PersonInit
  ): Promise<LocalPersonImpl> {
    const person = await createLocalPerson(this._context, this, member, config);
    this._localPerson = person;

    return person;
  }

  readonly updateMetadata = (metadata: string) =>
    this._channelImpl.updateChannelMetadata(metadata);

  readonly close = () =>
    new Promise<void>(async (r, f) => {
      if (this.state === 'closed') {
        f(
          createError({
            operationName: 'SkyWayChannelImpl.close',
            path: log.prefix,
            info: errors.alreadyChannelClosed,
            channel: this,
            context: this._context,
            payload: this.toJSON(),
          })
        );
        return;
      }

      const timestamp = log.info(
        '[start] close channel',
        await createLogPayload({
          operationName: 'SkyWayChannelImpl.close',
          channel: this,
        })
      );

      try {
        await this._channelImpl.close().catch((e) => {
          const error = createError({
            operationName: 'SkyWayChannelImpl.close',
            context: this._context,
            info: { ...errors.internal, detail: '_api.deleteChannel failed' },
            error: e,
            path: log.prefix,
            channel: this,
          });
          throw error;
        });

        if (this._state !== 'closed') {
          await this.onClosed
            .asPromise(this._context.config.rtcApi.timeout)
            .catch((e) => {
              const error = createError({
                operationName: 'SkyWayChannelImpl.close',
                context: this._context,
                info: { ...errors.timeout, detail: 'channel.onClosed' },
                error: e,
                path: log.prefix,
                channel: this,
              });
              throw error;
            });
        }
      } catch (error: any) {
        log.error((error as SkyWayError).message, error);
        f(error);
      }

      log.elapsed(
        timestamp,
        '[end] close channel',
        await createLogPayload({
          operationName: 'SkyWayChannelImpl.close',
          channel: this,
        })
      );

      r();
    });

  /**@private */
  readonly _updateMemberTtl = (memberId: string, ttlSec: number) =>
    this._channelImpl.updateMemberTtl(memberId, ttlSec);

  /**@private */
  readonly _updateMemberMetadata = (memberId: string, metadata: string) =>
    this._channelImpl.updateMemberMetadata(memberId, metadata);

  /**@private */
  /**@throws  {SkyWayError} */
  readonly _publish = (init: PublicationInit) =>
    this._channelImpl.publish(init);

  /**@private */
  readonly _unpublish = async (publicationId: string) =>
    this._channelImpl.unpublish(publicationId);

  /**@private
   * @throws {@link SkyWayError}
   */
  readonly _subscribe = (subscriberId: string, publicationId: string) => {
    const publication = this._getPublication(publicationId);

    const subscriber = this._getMember(subscriberId);
    if (subscriber == undefined) {
      throw createError({
        operationName: 'SkyWayChannelImpl._subscribe',
        path: log.prefix,
        info: {
          ...errors.internal,
          detail: 'subscriber not found',
        },
        channel: this,
        context: this._context,
        payload: { subscriberId, publicationId },
      });
    }

    return this._channelImpl.subscribe({
      publication: publication.toJSON(),
      subscriber: subscriber.toJSON(),
    });
  };

  /**@private */
  readonly _unsubscribe = async (subscriptionId: string) => {
    if (!this._getSubscription(subscriptionId)) {
      throw createError({
        operationName: 'SkyWayChannelImpl._unsubscribe',
        path: log.prefix,
        info: {
          ...errors.internal,
          detail: "can't unsubscribe not exist subscription",
        },
        channel: this,
        context: this._context,
        payload: { subscriptionId },
      });
    }

    await this._channelImpl.unsubscribe(subscriptionId);
  };

  /**@private */
  readonly _updatePublicationMetadata = (
    publicationId: string,
    metadata: string
  ) => this._channelImpl.updatePublicationMetadata(publicationId, metadata);

  /**@private */
  readonly _disablePublication = (publicationId: string) =>
    this._channelImpl.disablePublication(publicationId);

  /**@private */
  readonly _enablePublication = (publicationId: string) =>
    this._channelImpl.enablePublication(publicationId);

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    log.debug('disposed', this.toJSON());

    this._channelImpl.dispose();

    this._onDisposed.emit();
    this._events.dispose();
  }
}

export class SkyWayChannel {
  /**
   * @description [japanese] Channelの作成
   */
  static async Create(
    context: SkyWayContext,
    init: ChannelInit = {}
  ): Promise<Channel> {
    const timestamp = log.info('[start] createChannel', {
      operationName: 'SkyWayChannel.Create',
    });
    const channelImpl = await context._api.createChannel(init).catch((e) => {
      log.error('[failed] createChannel', e);
      throw e;
    });
    const channel = new SkyWayChannelImpl(context, channelImpl);
    log.elapsed(timestamp, '[end] createChannel');
    return channel;
  }

  /**
   * @description [japanese] 既存のChannelの取得
   */
  static async Find(
    context: SkyWayContext,
    query: ChannelQuery
  ): Promise<Channel> {
    const timestamp = log.info('[start] findChannel', {
      operationName: 'SkyWayChannel.Find',
    });
    const channelImpl = await context._api.findChannel(query).catch((e) => {
      log.error('[failed] findChannel', e);
      throw e;
    });
    const channel = new SkyWayChannelImpl(context, channelImpl);
    log.elapsed(timestamp, '[end] findChannel');
    return channel;
  }

  /**
   * @description [japanese] Channelの取得を試み、存在しなければ作成する
   */
  static async FindOrCreate(
    context: SkyWayContext,
    query: ChannelInit
  ): Promise<Channel> {
    const timestamp = log.info('[start] findOrCreateChannel', {
      operationName: 'SkyWayChannel.FindOrCreate',
    });
    const channelImpl = await context._api
      .findOrCreateChannel(query)
      .catch((e) => {
        log.error('[failed] findOrCreateChannel', e);
        throw e;
      });
    const channel = new SkyWayChannelImpl(context, channelImpl);
    log.elapsed(timestamp, '[end] findOrCreateChannel');
    return channel;
  }

  /**@private */
  constructor() {}
}

export type ChannelState = 'opened' | 'closed';

export type PersonInit = {
  name?: MemberInit['name'];
  metadata?: MemberInit['metadata'];
} & Partial<LocalMemberConfig> &
  MemberInternalConfig;
