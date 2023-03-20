import { Logger, SkyWayError } from '@skyway-sdk/common';
import { Event } from '@skyway-sdk/common';
import { Channel } from '@skyway-sdk/model';
import { RtcRpcApiClient } from '@skyway-sdk/rtc-rpc-api-client';

import { channelFactory, ChannelInit, RtcApi } from '.';
import { Config, ConfigOptions } from './config';
import { ChannelQuery } from './domain/api';
import { EventObserver } from './domain/eventObserver';
import { RtcApiImpl } from './infrastructure/api';
import { EventObserverImpl } from './infrastructure/eventObserver';

const log = new Logger('packages/rtc-api-client/src/client.ts');

export type RtcApiClientArgs = {
  appId: string;
  token: string;
} & Partial<ConfigOptions>;

export class RtcApiClient {
  /** @throws {@link SkyWayError} */
  static async Create(args: RtcApiClientArgs): Promise<RtcApiClient> {
    const config = new Config(args);
    if (config.log) {
      Logger.level = config.log.level;
      Logger.format = config.log.format;
    }
    log.debug('RtcApiClient spawned', config);

    const rpc = new RtcRpcApiClient({
      ...config.rtcApi,
      token: args.token,
      log: config.log,
    });

    const api = new RtcApiImpl(rpc);
    await api.connect();

    const eventObserverFactory = (appId: string, channel: Channel) =>
      new EventObserverImpl(appId, rpc, channel, config.rtcApi);

    return new RtcApiClient(args.appId, config, api, eventObserverFactory);
  }

  closed = false;

  readonly onFatalError = new Event<SkyWayError>();

  private constructor(
    readonly appId: string,
    readonly config: Config,
    private apiClient: RtcApi,
    private _eventObserverFactory: (
      appId: string,
      channel: Channel
    ) => EventObserver
  ) {
    this.apiClient.onFatalError.pipe(this.onFatalError);
  }

  async updateAuthToken(token: string) {
    await this.apiClient.updateAuthToken(token);
  }

  /**ms */
  async getServerUnixtimeInMs() {
    return this.apiClient.getServerUnixtime(this.appId);
  }

  /**sec */
  async getServerUnixtimeInSec() {
    return Math.floor((await this.getServerUnixtimeInMs()) / 1000);
  }

  /**@throws {@link SkyWayError} */
  async createChannel(init: ChannelInit = {}) {
    log.debug('[start] apiClient.createChannel', { init });
    const channelDto = await this.apiClient
      .createChannel(this.appId, init)
      .catch((e) => {
        log.debug('[failed] apiClient.createChannel', { init, e });
        throw e;
      });
    log.debug('[end] apiClient.createChannel', { init, channelDto });

    const channel = channelFactory(
      this.appId,
      this._eventObserverFactory(this.appId, channelDto),
      this.apiClient,
      channelDto,
      this.config
    );
    return channel;
  }

  async findChannel(query: ChannelQuery) {
    log.debug('[start] apiClient.getChannel', { query });
    const channelDto = await this.apiClient
      .getChannel(this.appId, query)
      .catch((e) => {
        log.debug('[failed] apiClient.getChannel', { query, e });
        throw e;
      });

    const channel = channelFactory(
      this.appId,
      this._eventObserverFactory(this.appId, channelDto),
      this.apiClient,
      channelDto,
      this.config
    );
    log.debug('[end] apiClient.getChannel', { channelId: channel.id });

    return channel;
  }

  async findOrCreateChannel(query: ChannelInit) {
    log.debug('[start] apiClient.findOrCreateChannel', { query });
    const channelDto = await this.apiClient
      .findOrCreateChannel(this.appId, query)
      .catch((e) => {
        log.debug('[failed] apiClient.findOrCreateChannel', { query, e });
        throw e;
      });
    log.debug('[end] apiClient.findOrCreateChannel', { query });

    const channel = channelFactory(
      this.appId,
      this._eventObserverFactory(this.appId, channelDto),
      this.apiClient,
      channelDto,
      this.config
    );
    return channel;
  }

  deleteChannel(channelId: Channel['id']) {
    return this.apiClient.deleteChannel(this.appId, channelId);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;

    log.debug('closed', { appid: this.appId });
    this.apiClient.close();
  }
}
