import { Event, Logger, PromiseQueue } from '@skyway-sdk/common';
import {
  createError,
  createLogPayload,
  errors as coreErrors,
  LocalAudioStream,
  LocalCustomVideoStream,
  LocalPersonImpl,
  LocalVideoStream,
  MemberImpl,
  MemberType,
  Publication,
  PublicationImpl,
  RemoteMemberImplInterface,
  SkyWayChannelImpl,
  SkyWayContext,
} from '@skyway-sdk/core';
import { SfuRestApiClient } from '@skyway-sdk/sfu-api-client';

import { SfuBotPlugin } from '.';
import { SFUConnection } from './connection';
import { TransportRepository } from './connection/transport/transportRepository';
import { defaultMaxSubscribers } from './const';
import { errors } from './errors';
import { Forwarding, ForwardingConfigure } from './forwarding';
import { SfuBotPluginOptions } from './option';

const log = new Logger('packages/sfu-bot/src/member.ts');

export class SfuBotMember
  extends MemberImpl
  implements RemoteMemberImplInterface
{
  readonly side = 'remote';
  static readonly subtype = 'sfu';
  readonly subtype = SfuBotMember.subtype;
  readonly type: MemberType = 'bot';

  private readonly _context: SkyWayContext;
  private readonly _transportRepository: TransportRepository;
  readonly options: SfuBotPluginOptions;
  private _connections: { [localPersonSystemId: string]: SFUConnection } = {};

  /** @description [japanese] forwardingを開始した時に発火するイベント */
  readonly onForwardingStarted = new Event<{ forwarding: Forwarding }>();
  /** @description [japanese] forwardingを終了した時に発火するイベント */
  readonly onForwardingStopped = new Event<{ forwarding: Forwarding }>();
  /** @description [japanese] forwardingの数が変化した時に発火するイベント */
  readonly onForwardingListChanged = new Event<void>();
  private readonly _api: SfuRestApiClient;
  private _startForwardQueue = new PromiseQueue();
  private _forwardings: { [forwardingId: string]: Forwarding } = {};

  get forwardings() {
    return Object.values(this._forwardings);
  }

  /**@internal */
  constructor(args: {
    channel: SkyWayChannelImpl;
    id: string;
    name?: string;
    metadata?: string | undefined;
    plugin: SfuBotPlugin;
    api: SfuRestApiClient;
    context: SkyWayContext;
    transportRepository: TransportRepository;
    options: SfuBotPluginOptions;
  }) {
    super(args);
    this._api = args.api;
    this._context = args.context;
    this._transportRepository = args.transportRepository;
    this.options = args.options;

    this.onLeft.once(() => {
      log.debug('SfuBotMember left: ', { id: this.id });
      Object.values(this._connections).forEach((c) => {
        c.close({ reason: 'sfu bot left' });
      });
      this._connections = {};
    });
  }

  /**@private */
  _getConnection(localPersonId: string): SFUConnection {
    return this._connections[localPersonId];
  }

  /**@private */
  _getOrCreateConnection(localPerson: LocalPersonImpl): SFUConnection {
    const connection =
      this._getConnection(localPerson.id) ??
      this._createConnection(this.channel, localPerson, this);

    return connection;
  }

  /**@private */
  private _createConnection(
    channel: SkyWayChannelImpl,
    localPerson: LocalPersonImpl,
    endpointBot: SfuBotMember
  ) {
    const connection = new SFUConnection(
      endpointBot._api,
      channel,
      localPerson,
      endpointBot,
      this._transportRepository,
      this._context
    );
    connection.onClose.once(() => {
      delete this._connections[localPerson.id];
    });
    this._connections[localPerson.id] = connection;
    return connection;
  }

  /**
   * @description [japanese] StreamのPublicationをForwardingする
   * @throws {SkyWayError}
   * @example
   * const forwarding = await bot.startForwarding(publication, { maxSubscribers: 99 });
   */
  async startForwarding(
    publication: Publication<
      LocalVideoStream | LocalAudioStream | LocalCustomVideoStream
    >,
    configure: Partial<ForwardingConfigure> = {}
  ) {
    const timestamp = log.info(
      '[start] startForwarding',
      await createLogPayload({
        operationName: 'SfuBotMember.startForwarding',
        channel: this.channel,
      })
    );

    const res = await this._startForwardQueue.push(() =>
      this._startForwarding(
        publication as PublicationImpl<
          LocalAudioStream | LocalVideoStream | LocalCustomVideoStream
        >,
        configure
      )
    );

    log.elapsed(
      timestamp,
      '[end] startForwarding',
      await createLogPayload({
        operationName: 'SfuBotMember.startForwarding',
        channel: this.channel,
      })
    );

    return res;
  }

  private async _startForwarding(
    relayed: PublicationImpl<
      LocalAudioStream | LocalVideoStream | LocalCustomVideoStream
    >,
    configure: Partial<ForwardingConfigure>
  ): Promise<Forwarding> {
    if (configure.maxSubscribers == undefined) {
      configure.maxSubscribers = defaultMaxSubscribers;
    }

    if (this.state !== 'joined') {
      throw createError({
        operationName: 'SfuBotMember._startForwarding',
        context: this._context,
        channel: this.channel,
        info: errors.sfuBotNotInChannel,
        path: log.prefix,
        payload: { status: this.state },
      });
    }

    if (!this.channel._getPublication(relayed.id)) {
      throw createError({
        operationName: 'SfuBotMember._startForwarding',
        context: this._context,
        channel: this.channel,
        info: coreErrors.publicationNotExist,
        path: log.prefix,
      });
    }

    const localPerson = this.channel.localPerson;
    if (!localPerson) {
      throw createError({
        operationName: 'SfuBotMember._startForwarding',
        context: this._context,
        channel: this.channel,
        info: coreErrors.localPersonNotJoinedChannel,
        path: log.prefix,
      });
    }
    if (localPerson.id !== relayed.publisher.id) {
      throw createError({
        operationName: 'SfuBotMember._startForwarding',
        context: this._context,
        info: errors.remotePublisherId,
        path: log.prefix,
        channel: this.channel,
      });
    }

    const ts = log.debug('[start] SfuBotMember startForwarding', {
      publication: relayed.toJSON(),
      configure,
    });

    const connection = this._getOrCreateConnection(localPerson);
    const sender = connection.addSender(relayed);

    const forwarding = await sender
      .startForwarding(configure as ForwardingConfigure)
      .catch((error) => {
        throw createError({
          operationName: 'SfuBotMember._startForwarding',
          context: this._context,
          info: {
            ...errors.internal,
            detail: '[failed] SfuBotMember startForwarding',
          },
          path: log.prefix,
          channel: this.channel,
          error,
          payload: { publication: relayed.toJSON() },
        });
      });
    this._forwardings[forwarding.id] = forwarding;

    this.listenStopForwardEvent(forwarding);
    this.onForwardingStarted.emit({ forwarding });
    this.onForwardingListChanged.emit();

    log.elapsed(ts, '[end] SfuBotMember startForwarding', {
      forwarding: forwarding.toJSON(),
    });

    return forwarding;
  }

  private listenStopForwardEvent(forwarding: Forwarding) {
    const { removeListener } = this.channel.onStreamUnpublished.add((e) => {
      if (e.publication.id === forwarding.id) {
        removeListener();
        forwarding._stop();

        const origin = forwarding.originPublication as PublicationImpl;
        const connection = this._getConnection(origin.publisher.id);
        if (connection) {
          connection.removeSender(origin.id);
        }
        this.onForwardingStopped.emit({ forwarding });
        this.onForwardingListChanged.emit();
      }
    });
  }

  /**
   * @description [japanese] Forwardingを停止する
   */
  stopForwarding = (target: string | Forwarding) =>
    new Promise<void>(async (r, f) => {
      const timestamp = log.info(
        '[start] stopForwarding',
        await createLogPayload({
          operationName: 'SfuBotMember.stopForwarding',
          channel: this.channel,
        })
      );

      if (this.state !== 'joined') {
        f(
          createError({
            operationName: 'SfuBotMember.stopForwarding',
            context: this._context,
            info: errors.sfuBotNotInChannel,
            path: log.prefix,
            channel: this.channel,
            payload: { status: this.state },
          })
        );
        return;
      }

      const forwardingId = typeof target === 'string' ? target : target.id;
      const forwarding = this._forwardings[forwardingId];
      if (!forwarding) {
        f(
          createError({
            operationName: 'SfuBotMember.stopForwarding',
            context: this._context,
            info: errors.forwardingNotFound,
            path: log.prefix,
            channel: this.channel,
            payload: {
              forwardingId,
              _forwardings: Object.keys(this._forwardings),
            },
          })
        );
        return;
      }
      delete this._forwardings[forwarding.id];

      const { promise, fulfilled } = this._api.stopForwarding({
        botId: this.id,
        forwardingId,
      });
      let failed = false;
      promise.catch((e) => {
        failed = true;
        f(e);
      });

      this.onForwardingStopped
        .watch(
          (e) => e.forwarding.id === forwardingId,
          this._context.config.rtcApi.timeout
        )
        .then(async () => {
          log.elapsed(
            timestamp,
            '[end] stopForwarding',
            await createLogPayload({
              operationName: 'SfuBotMember.stopForwarding',
              channel: this.channel,
            })
          );
          r();
        })
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'SfuBotMember.stopForwarding',
                context: this._context,
                info: { ...errors.timeout, detail: 'onForwardingStopped' },
                path: log.prefix,
                channel: this.channel,
                payload: { fulfilled },
                error,
              })
            );
        });
    });

  /**@private */
  _dispose() {}
}
