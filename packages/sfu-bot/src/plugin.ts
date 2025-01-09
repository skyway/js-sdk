import { Logger } from '@skyway-sdk/common';
import {
  Channel,
  createError,
  createLogPayload,
  SkyWayChannelImpl,
  SkyWayPlugin,
} from '@skyway-sdk/core';
import model from '@skyway-sdk/model';
import { SfuApiOptions, SfuRestApiClient } from '@skyway-sdk/sfu-api-client';

import { TransportRepository } from './connection/transport/transportRepository';
import { errors } from './errors';
import { SfuBotMember } from './member';
import {
  defaultSfuBotPluginOptions,
  SfuBotPluginOptions as SfuBotPluginOptions,
} from './option';
import { PACKAGE_VERSION } from './version';

export type { SfuApiOptions };

const log = new Logger('packages/sfu-bot/src/plugin.ts');

export class SfuBotPlugin extends SkyWayPlugin {
  static readonly subtype = SfuBotMember.subtype;
  readonly subtype = SfuBotPlugin.subtype;
  readonly options: SfuBotPluginOptions;
  private _api!: SfuRestApiClient;
  /**@private */
  _transportRepository!: TransportRepository;

  constructor(_options: Partial<SfuBotPluginOptions> = {}) {
    super();

    this.options = {
      ...defaultSfuBotPluginOptions,
      ..._options,
    };

    this._onContextAttached.once((context) => {
      Logger.level = context.config.log.level;
      Logger.format = context.config.log.format;

      log.info('SfuBotPlugin spawned', {
        operationName: 'SfuBotPlugin.constructor',
        endpoint: { sfu: this.options.domain },
        options: this.options,
        sdkName: 'sfu-bot',
        sdkVersion: PACKAGE_VERSION,
      });

      this._api = new SfuRestApiClient(context.authTokenString, {
        ...this.options,
        log: context.config.log,
      });
      this._transportRepository = new TransportRepository(context, this._api);
      context._onTokenUpdated.add((token) => {
        this._api.updateToken(token);
      });
    });

    this._whenDisposeLocalPerson = async (person) => {
      this._transportRepository.deleteTransports(person.id);
    };
  }

  /**@private */
  _createRemoteMember = (channel: SkyWayChannelImpl, sfuBot: model.Member) => {
    const member = new SfuBotMember({
      ...this._context!,
      channel,
      id: sfuBot.id,
      name: sfuBot.name,
      metadata: sfuBot.metadata,
      plugin: this,
      api: this._api,
      context: this._context!,
      transportRepository: this._transportRepository,
      options: this.options,
    });
    return member;
  };

  /**
   * @description [japanese] SFU BotをChannelに呼び出す
   */
  createBot = async (channel: Channel) => {
    const timestamp = log.info(
      '[start] createBot',
      await createLogPayload({
        operationName: 'SfuBotPlugin.createBot',
        channel: channel as SkyWayChannelImpl,
      })
    );
    const appId = this._context!.authToken.getAppId();
    const botId = await this._api.createBot({
      appId,
      channelId: channel.id,
    });
    const member =
      (channel as SkyWayChannelImpl)._getMember(botId) ??
      (
        await channel.onMemberJoined
          .watch(
            (e) => e.member.id === botId,
            this._context!.config.rtcApi.timeout
          )
          .catch((error) => {
            throw createError({
              operationName: 'SfuBotPlugin.createBot',
              info: { ...errors.timeout, detail: 'onMemberJoined' },
              path: log.prefix,
              error,
              context: this._context,
            });
          })
      ).member;

    log.elapsed(
      timestamp,
      '[end] createBot',
      await createLogPayload({
        operationName: 'SfuBotPlugin.createBot',
        channel,
      })
    );

    return member as SfuBotMember;
  };

  /**
   * @description [japanese] SFU BotをChannelから削除する。
   * @remarks SkyWayAuthToken v3 を利用した場合はこのメソッドを使うことができません。代替手段として Channel.leave メソッドまたは Member.leave メソッドを使用して SFU Bot を Channel から退出させてください。
   */
  deleteBot = async (channel: Channel, botId: string) =>
    new Promise<void>(async (r, f) => {
      const timestamp = log.info(
        '[start] deleteBot',
        await createLogPayload({
          operationName: 'SfuBotPlugin.deleteBot',
          channel,
        })
      );

      let failed = false;
      this._api.deleteBot({ botId }).catch((e) => {
        failed = true;
        f(e);
      });

      channel.onMemberLeft
        .watch(
          (e) => e.member.id === botId,
          this._context!.config.rtcApi.timeout
        )
        .then(async () => {
          log.elapsed(
            timestamp,
            '[end] deleteBot',
            await createLogPayload({
              operationName: 'SfuBotPlugin.deleteBot',
              channel,
            })
          );
          r();
        })
        .catch((error) => {
          if (!failed)
            f(
              createError({
                operationName: 'SfuBotPlugin.deleteBot',
                info: { ...errors.timeout, detail: 'onMemberLeft' },
                path: log.prefix,
                channel,
                error,
                context: this._context,
              })
            );
        });
    });
}
