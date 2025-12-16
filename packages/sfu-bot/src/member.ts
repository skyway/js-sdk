import { Event, Logger, PromiseQueue } from '@skyway-sdk/common';
import {
  errors as coreErrors,
  createError,
  createLogPayload,
  type LocalAudioStream,
  type LocalCustomVideoStream,
  type LocalPersonImpl,
  type LocalVideoStream,
  MemberImpl,
  type MemberType,
  type Publication,
  type PublicationImpl,
  type RemoteMemberImplInterface,
  type SkyWayChannelImpl,
  type SkyWayContext,
} from '@skyway-sdk/core';
import type { SFURestApiClient } from '@skyway-sdk/sfu-api-client';

import type { SFUBotPlugin } from '.';
import { SFUConnection } from './connection';
import type { TransportRepository } from './connection/transport/transportRepository';
import { defaultMaxSubscribers } from './const';
import { errors } from './errors';
import type { Forwarding, ForwardingConfigure } from './forwarding';
import type { SFUBotPluginOptions } from './option';

const log = new Logger('packages/sfu-bot/src/member.ts');

export class SFUBotMember
  extends MemberImpl
  implements RemoteMemberImplInterface
{
  readonly side = 'remote';
  static readonly subtype = 'sfu';
  readonly subtype = SFUBotMember.subtype;
  readonly type: MemberType = 'bot';

  private readonly _context: SkyWayContext;
  private readonly _transportRepository: TransportRepository;
  readonly options: SFUBotPluginOptions;
  private _connections: { [localPersonSystemId: string]: SFUConnection } = {};

  /** @description [japanese] forwardingを開始した時に発火するイベント */
  readonly onForwardingStarted = new Event<{ forwarding: Forwarding }>();
  /** @description [japanese] forwardingを終了した時に発火するイベント */
  readonly onForwardingStopped = new Event<{ forwarding: Forwarding }>();
  /** @description [japanese] forwardingの数が変化した時に発火するイベント */
  readonly onForwardingListChanged = new Event<void>();
  private readonly _api: SFURestApiClient;
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
    plugin: SFUBotPlugin;
    api: SFURestApiClient;
    context: SkyWayContext;
    transportRepository: TransportRepository;
    options: SFUBotPluginOptions;
  }) {
    super(args);
    this._api = args.api;
    this._context = args.context;
    this._transportRepository = args.transportRepository;
    this.options = args.options;

    this.onLeft.once(() => {
      log.debug('SFUBotMember left: ', { id: this.id });
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
    endpointBot: SFUBotMember,
  ) {
    const connection = new SFUConnection(
      endpointBot._api,
      channel,
      localPerson,
      endpointBot,
      this._transportRepository,
      this._context,
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
    configure: Partial<ForwardingConfigure> = {},
  ) {
    const timestamp = log.info(
      '[start] startForwarding',
      await createLogPayload({
        operationName: 'SFUBotMember.startForwarding',
        channel: this.channel,
      }),
    );

    const res = await this._startForwardQueue.push(() =>
      this._startForwarding(
        publication as PublicationImpl<
          LocalAudioStream | LocalVideoStream | LocalCustomVideoStream
        >,
        configure,
      ),
    );

    log.elapsed(
      timestamp,
      '[end] startForwarding',
      await createLogPayload({
        operationName: 'SFUBotMember.startForwarding',
        channel: this.channel,
      }),
    );

    return res;
  }

  private async _startForwarding(
    origin: PublicationImpl<
      LocalAudioStream | LocalVideoStream | LocalCustomVideoStream
    >,
    configure: Partial<ForwardingConfigure>,
  ): Promise<Forwarding> {
    if (configure.maxSubscribers === undefined) {
      configure.maxSubscribers = defaultMaxSubscribers;
    }

    if (this.state !== 'joined') {
      throw createError({
        operationName: 'SFUBotMember._startForwarding',
        context: this._context,
        channel: this.channel,
        info: errors.sfuBotNotInChannel,
        path: log.prefix,
        payload: { status: this.state },
      });
    }

    if (!this.channel._getPublication(origin.id)) {
      throw createError({
        operationName: 'SFUBotMember._startForwarding',
        context: this._context,
        channel: this.channel,
        info: coreErrors.publicationNotExist,
        path: log.prefix,
      });
    }

    const localPerson = this.channel.localPerson;
    if (!localPerson) {
      throw createError({
        operationName: 'SFUBotMember._startForwarding',
        context: this._context,
        channel: this.channel,
        info: coreErrors.localPersonNotJoinedChannel,
        path: log.prefix,
      });
    }
    if (localPerson.id !== origin.publisher.id) {
      throw createError({
        operationName: 'SFUBotMember._startForwarding',
        context: this._context,
        info: errors.remotePublisherId,
        path: log.prefix,
        channel: this.channel,
      });
    }

    const ts = log.debug('[start] SFUBotMember startForwarding', {
      publication: origin.toJSON(),
      configure,
    });

    const connection = this._getOrCreateConnection(localPerson);
    const sender = connection.addSender(origin);

    const forwarding = await sender
      .startForwarding(configure as ForwardingConfigure)
      .catch((error) => {
        throw createError({
          operationName: 'SFUBotMember._startForwarding',
          context: this._context,
          info: {
            ...errors.internal,
            detail: '[failed] SFUBotMember startForwarding',
          },
          path: log.prefix,
          channel: this.channel,
          error,
          payload: { publication: origin.toJSON() },
        });
      });
    this._forwardings[forwarding.id] = forwarding;

    this.listenStopForwardEvent(forwarding);
    this.onForwardingStarted.emit({ forwarding });
    this.onForwardingListChanged.emit();

    log.elapsed(ts, '[end] SFUBotMember startForwarding', {
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
    new Promise<void>((r, f) => {
      if (this.state !== 'joined') {
        f(
          createError({
            operationName: 'SFUBotMember.stopForwarding',
            context: this._context,
            info: errors.sfuBotNotInChannel,
            path: log.prefix,
            channel: this.channel,
            payload: { status: this.state },
          }),
        );
        return;
      }

      const forwardingId = typeof target === 'string' ? target : target.id;
      const forwarding = this._forwardings[forwardingId];
      if (!forwarding) {
        f(
          createError({
            operationName: 'SFUBotMember.stopForwarding',
            context: this._context,
            info: errors.forwardingNotFound,
            path: log.prefix,
            channel: this.channel,
            payload: {
              forwardingId,
              _forwardings: Object.keys(this._forwardings),
            },
          }),
        );
        return;
      }

      const executeStop = async () => {
        const timestamp = log.info(
          '[start] stopForwarding',
          await createLogPayload({
            operationName: 'SFUBotMember.stopForwarding',
            channel: this.channel,
          }),
        );

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
            this._context.config.rtcApi.timeout,
          )
          .then(async () => {
            log.elapsed(
              timestamp,
              '[end] stopForwarding',
              await createLogPayload({
                operationName: 'SFUBotMember.stopForwarding',
                channel: this.channel,
              }),
            );
            r();
          })
          .catch((error) => {
            if (!failed)
              f(
                createError({
                  operationName: 'SFUBotMember.stopForwarding',
                  context: this._context,
                  info: { ...errors.timeout, detail: 'onForwardingStopped' },
                  path: log.prefix,
                  channel: this.channel,
                  payload: { fulfilled },
                  error,
                }),
              );
          });
      };

      executeStop().catch(f);
    });

  /**@private */
  _dispose() {}
}
