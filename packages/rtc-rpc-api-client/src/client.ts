import {
  BackOff,
  Events,
  HttpClient,
  LogFormat,
  Logger,
  LogLevel,
  SkyWayError,
} from '@skyway-sdk/common';
import model, {
  Channel,
  Codec,
  ContentType,
  Encoding,
  Member,
  Publication,
  Subscription,
} from '@skyway-sdk/model';

import { defaultDomain, MaxRetry } from './const';
import { errors } from './errors';
import { ChannelEvent } from './event';
import { RPC } from './rpc';
import { createError, createWarnPayload } from './util';

const log = new Logger('packages/rtc-rpc-api-client/src/client.ts');

/**@internal */
export interface RtcRpcApiConfig {
  domain?: string;
  /**ms */
  timeout?: number;
  secure?: boolean;
}

export type RtcRpcApiClientConfig = RtcRpcApiConfig & {
  token: string;
  log?: Partial<{ level: LogLevel; format: LogFormat }>;
};

export class RtcRpcApiClient {
  closed = false;

  private readonly _domain = this.config.domain ?? defaultDomain;
  private _secure = this.config.secure ?? true;
  private _token = this.config.token;
  /**@private */
  _rpc = new RPC();
  private _subscribingChannelEvents = new Set<string>();
  private _subscribingChannelVersions: { [channelId: string]: number } = {};
  private readonly _httpClient = new HttpClient(
    `http${this.config.secure ? 's' : ''}://${this.config.domain}`
  );
  private _reconnectCount = 0;
  private readonly _reconnectLimit = MaxRetry;

  private readonly _events = new Events();
  readonly onEvent = this._events.make<{
    channelId: string;
    event: ChannelEvent;
  }>();
  readonly onFatalError = this._events.make<SkyWayError>();
  readonly onClose = this._events.make<void>();
  readonly onReconnected = this._events.make<void>();

  constructor(readonly config: RtcRpcApiClientConfig) {
    Logger.level = config.log?.level ?? Logger.level;
    Logger.format = config.log?.format ?? Logger.format;

    log.debug('RtcRpcApiClient spawned', config);

    this._rpc.onNotify.add((notify) => {
      if (notify.method === 'channelEventNotification') {
        const event = notify.params as ChannelEvent;

        this._subscribingChannelVersions[event.data.channel.id] =
          event.data.channel.version;

        this.onEvent.emit({ channelId: event.data.channel.id, event });
      }
    });

    this._rpc.onDisconnected.add(async () => {
      if (
        this._rpc.negotiated &&
        !this._rpc.closed &&
        !this._rpc.reconnecting
      ) {
        await this._reconnect();
      }
    });

    this._rpc.onFatalError.once((e) => {
      log.error('fatal error', e);
      this.onFatalError.emit(e);
      this.close();
    });
  }

  get token() {
    return this._token;
  }

  private async _reconnect() {
    if (this._reconnectCount >= this._reconnectLimit) {
      this._rpc.onFatalError.emit(
        createError({
          operationName: 'RtcRpcApiClient._reconnect',
          info: {
            name: 'failed to reconnect',
            detail: '_reconnectLimit exceeded',
            solution: '',
          },
          path: log.prefix,
        })
      );
      this.close();
      return;
    }
    this._rpc.reconnecting = true;
    log.warn(
      '[start] reconnect',
      createWarnPayload({
        operationName: 'RtcRpcApiClient._reconnect',
        detail: 'reconnect start',
        payload: {
          reconnectCount: this._reconnectCount,
          limit: this._reconnectLimit,
        },
      })
    );

    this._reconnectCount++;
    const backOffTime =
      this._reconnectCount ** 2 * 100 +
      this._reconnectCount ** 2 * 100 * Math.random();
    await new Promise((r) => setTimeout(r, backOffTime));

    try {
      await this.connect().catch((err) => {
        log.warn(
          `[failed] reconnect rtc api`,
          createWarnPayload({
            operationName: 'RtcRpcApiClient._reconnect',
            detail: 'connect rpc failed',
            payload: {
              reconnectCount: this._reconnectCount,
            },
          }),
          err
        );
        throw err;
      });
      this._rpc.reconnecting = false;
      this._reconnectCount = 0;

      this._rpc.resolvePendingRequests();
      await Promise.all(
        [...this._subscribingChannelEvents].map(async (s) => {
          const [appId, channelId] = s.split(':');
          const offset = this._subscribingChannelVersions[channelId];
          await this.subscribeChannelEvents({
            appId,
            channelId,
            offset,
          });
        })
      ).catch((e) => {
        log.warn(
          'subscribeChannelEvents failed',
          createWarnPayload({
            operationName: 'RtcRpcApiClient._reconnect',
            detail: 'subscribeChannelEvents failed',
            payload: {
              reconnectCount: this._reconnectCount,
            },
          }),
          e
        );
        throw e;
      });

      log.warn(
        '[end] reconnect',
        createWarnPayload({
          operationName: 'RtcRpcApiClient._reconnect',
          detail: 'reconnect finished',
          payload: {
            reconnectCount: this._reconnectCount,
          },
        })
      );

      this.onReconnected.emit();
    } catch (error) {
      log.warn(
        '[failed] reconnect',
        createWarnPayload({
          operationName: 'RtcRpcApiClient._reconnect',
          detail: 'reconnect failed',
          payload: {
            reconnectCount: this._reconnectCount,
          },
        }),
        error
      );
      await this._reconnect();
    }
  }

  async updateToken(token: string) {
    log.debug('token update', { token });
    this._token = token;
    await this._updateAuthToken();
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;

    log.debug('closed');

    this._rpc.close();

    this.onClose.emit();
    this._events.dispose();
  }

  async health() {
    const response = await this._httpClient.get('/health');

    return response;
  }

  /** @throws {@link SkyWayError} */
  async connect() {
    log.debug('connect to rtc api rpc', this._domain);
    await this._rpc
      .connect({
        domain: this._domain,
        token: this.token,
        secure: this._secure,
      })
      .catch((e) => {
        throw createError({
          operationName: 'RtcRpcApiClient.connect',
          info: errors.failedToConnectRtcAPI,
          error: e,
          path: log.prefix,
        });
      });
  }

  private _channelSubscribed(appId: string, channelId: string) {
    this._subscribingChannelEvents.add(appId + ':' + channelId);
    log.debug('_channelSubscribed', {
      appId,
      channelId,
      _subscribingChannelEvents: [...this._subscribingChannelEvents],
    });
  }

  private _isSubscribingChannel(appId: string, channelId: string) {
    return this._subscribingChannelEvents.has(appId + ':' + channelId);
  }

  async createChannel({
    name,
    metadata,
    appId,
  }: {
    name?: Channel['name'];
    metadata?: string;
    appId: string;
  }) {
    const { channel } = await this._rpc.request<{
      channel: { id: string; version: number };
    }>('createChannel', {
      name,
      metadata,
      appId,
      authToken: this.token,
    });
    this._channelSubscribed(appId, channel.id);

    return channel;
  }

  async findOrCreateChannel({
    name,
    metadata,
    appId,
  }: {
    appId: string;
    name?: Channel['name'];
    metadata?: string;
  }) {
    const { channel } = await this._rpc.request<{ channel: model.Channel }>(
      'findOrCreateChannel',
      {
        name,
        metadata,
        appId,
        authToken: this.token,
      }
    );
    this._channelSubscribed(appId, channel.id);

    return channel;
  }

  async getChannel({ appId, id }: { appId: string; id: Channel['id'] }) {
    const res = await this._rpc.request<{ channel: model.Channel }>(
      'getChannel',
      {
        id,
        appId,
        authToken: this.token,
      }
    );

    // getChannelは暗黙的にEventがsubscribeされない
    if (!this._isSubscribingChannel(appId, id)) {
      this._channelSubscribed(appId, id);
      await this.subscribeChannelEvents({
        appId,
        channelId: id,
        offset: res.channel.version,
      });
    }

    return res.channel;
  }

  async getChannelByName({
    name,
    appId,
  }: {
    appId: string;
    name: Channel['name'];
  }) {
    const res = await this._rpc.request<{ channel: model.Channel }>(
      'getChannelByName',
      {
        name,
        appId,
        authToken: this.token,
      }
    );

    const channelId = res.channel.id;
    // getChannelByNameは暗黙的にEventがsubscribeされない
    if (!this._isSubscribingChannel(appId, channelId)) {
      this._channelSubscribed(appId, channelId);
      await this.subscribeChannelEvents({
        appId,
        channelId,
        offset: res.channel.version,
      });
    }

    return res.channel;
  }

  async deleteChannel({ id, appId }: { appId: string; id: Channel['id'] }) {
    await this._rpc.request<{}>('deleteChannel', {
      id,
      appId,
      authToken: this.token,
    });
  }

  async updateChannelMetadata({
    id,
    metadata,
    appId,
  }: {
    id: Channel['id'];
    appId: string;
    metadata: string;
  }) {
    await this._rpc.request<{ version: number }>('updateChannelMetadata', {
      id,
      metadata,
      appId,
      authToken: this.token,
    });
  }

  async addMember({
    channelId,
    name,
    metadata,
    subscribeChannelEvents,
    appId,
    ttlSec,
    subtype,
    type,
  }: {
    appId: string;
    channelId: Channel['id'];
    name?: Member['name'];
    metadata?: Member['metadata'];
    subscribeChannelEvents?: boolean;
    /**unixtimestamp in seconds */
    ttlSec?: number;
    type?: string;
    subtype?: string;
  }) {
    const res = await this._rpc.request<{
      memberId: model.Member['id'];
      version: model.Channel['version'];
    }>('addMember', {
      channelId,
      name,
      metadata,
      subscribeChannelEvents,
      appId,
      ttlSec: ttlSec && parseInt(ttlSec.toString()),
      authToken: this.token,
      subtype,
      type,
    });
    return res;
  }

  async updateMemberTtl(
    args: {
      appId: string;
      channelId: string;
      memberId: string;
      /**unixtimestamp in seconds */
      ttlSec: number;
    },
    backoff = new BackOff({ times: 8 })
  ) {
    const { appId, channelId, memberId, ttlSec } = args;

    try {
      await this._rpc.request<{
        version: model.Channel['version'];
      }>('updateMemberTtl', {
        appId,
        channelId,
        memberId,
        ttlSec: ttlSec && parseInt(ttlSec.toString()),
        authToken: this.token,
      });
    } catch (e: any) {
      if (!backoff.exceeded) {
        log.warn(
          'retry updateMemberTtl',
          createWarnPayload({
            operationName: 'RtcRpcApiClient.updateMemberTtl',
            detail: 'retry updateMemberTtl',
            appId,
            channelId,
            memberId,
            payload: { backoff: backoff.count },
          }),
          e
        );
        await backoff.wait();
        await this.updateMemberTtl(args, backoff);
      } else {
        const error = new SkyWayError({
          path: log.prefix,
          info: errors.failedToUpdateMemberTTL,
          error: e,
        });
        throw error;
      }
    }
  }

  async updateMemberMetadata({
    channelId,
    memberId,
    metadata,
    appId,
  }: {
    appId: string;
    channelId: string;
    memberId: string;
    metadata: string;
  }) {
    await this._rpc.request<{ version: number }>('updateMemberMetadata', {
      channelId,
      memberId,
      metadata,
      appId,
      authToken: this.token,
    });
  }

  async leaveChannel({
    channelId,
    id,
    appId,
  }: {
    appId: string;
    channelId: string;
    id: string;
  }) {
    await this._rpc.request<{ version: number }>('removeMember', {
      channelId,
      id,
      appId,
      authToken: this.token,
    });
  }

  async publishStream({
    appId,
    channelId,
    publisherId,
    contentType,
    metadata,
    origin,
    codecCapabilities,
    encodings,
  }: {
    appId: string;
    channelId: string;
    publisherId: string;
    contentType: ContentType;
    metadata?: string;
    origin?: string;
    codecCapabilities?: Codec[];
    encodings?: Encoding[];
  }) {
    const res = await this._rpc.request<{
      id: Publication['id'];
      version: number;
    }>('publishStream', {
      channelId,
      publisherId,
      contentType: contentType[0].toUpperCase() + contentType.slice(1),
      metadata,
      origin,
      codecCapabilities,
      encodings: encodings?.map((e) => ({
        id: e.id,
      })),
      appId,
      authToken: this.token,
    });
    return { publicationId: res.id };
  }

  async disablePublication({
    channelId,
    publicationId,
    appId,
  }: {
    appId: string;
    channelId: string;
    publicationId: string;
  }) {
    await this._rpc.request<{
      version: number;
    }>('disablePublication', {
      channelId,
      appId,
      publicationId,
      authToken: this.token,
    });
  }

  async enablePublication({
    channelId,
    publicationId,
    appId,
  }: {
    appId: string;
    channelId: string;
    publicationId: string;
  }) {
    await this._rpc.request<{
      version: number;
    }>('enablePublication', {
      channelId,
      appId,
      publicationId,
      authToken: this.token,
    });
  }

  async updatePublicationMetadata({
    channelId,
    publicationId,
    appId,
    metadata,
  }: {
    appId: string;
    channelId: string;
    publicationId: string;
    metadata: string;
  }) {
    await this._rpc.request<{ version: number }>('updatePublicationMetadata', {
      channelId,
      publicationId,
      metadata,
      appId,
      authToken: this.token,
    });
  }

  async unpublishStream({
    channelId,
    publicationId,
    appId,
  }: {
    appId: string;
    channelId: string;
    publicationId: string;
  }) {
    await this._rpc.request<{ version: number }>('unpublishStream', {
      channelId,
      publicationId,
      appId,
      authToken: this.token,
    });
  }

  async subscribeStream({
    channelId,
    subscriberId,
    publicationId,
    appId,
  }: {
    appId: string;
    channelId: Channel['id'];
    subscriberId: Member['id'];
    publicationId: Publication['id'];
  }) {
    const res = await this._rpc.request<{
      id: Subscription['id'];
      version: number;
    }>('subscribeStream', {
      channelId,
      subscriberId,
      publicationId,
      appId,
      authToken: this.token,
    });
    return { subscriptionId: res.id };
  }

  async unsubscribeStream({
    channelId,
    subscriptionId,
    appId,
  }: {
    appId: string;
    channelId: string;
    subscriptionId: string;
  }) {
    await this._rpc.request<{
      version: number;
    }>('unsubscribeStream', {
      channelId,
      subscriptionId,
      appId,
      authToken: this.token,
    });
  }

  /**
   * @returns Date.now()
   */
  async getServerUnixtime(
    args: { appId: string },
    backoff = new BackOff({ times: 8 })
  ): Promise<number> {
    const { appId } = args;
    try {
      const res = await this._rpc.request<{
        unixtime: number;
      }>('getServerUnixtime', {
        appId,
        authToken: this.token,
      });
      return res.unixtime;
    } catch (error) {
      if (!backoff.exceeded) {
        log.warn(
          createWarnPayload({
            operationName: 'RtcRpcApiClient.getServerUnixtime',
            detail: 'retry getServerUnixtime',
            appId,
            payload: { backoff: backoff.count },
          }),
          error
        );
        await backoff.wait();
        return this.getServerUnixtime(args, backoff);
      } else {
        throw error;
      }
    }
  }

  /**@description [japanese] 現在のセッションに関連付けられている SkyWayAuthToken を更新します */
  private async _updateAuthToken() {
    await this._rpc.request<{
      version: number;
    }>('updateAuthToken', {
      authToken: this.token,
    });
  }

  /**
   * @description
   * - 指定した Channel の Event を Subscribe していなければ Event が生じるたびに Notification が送られるようになります。
   * - Subscribeした時点で、指定された offset (default to 0) の version から、最新の version までのイベントが送られます。
   */
  async subscribeChannelEvents({
    appId,
    channelId,
    offset,
  }: {
    appId: string;
    channelId: Channel['id'];
    offset?: number;
  }) {
    try {
      log.debug('[start] subscribeChannelEvents', { offset });
      await this._rpc.request('subscribeChannelEvents', {
        appId,
        authToken: this.token,
        channelId,
        offset,
      });
      log.debug('[end] subscribeChannelEvents', { offset });
    } catch (error: any) {
      if (
        error instanceof SkyWayError &&
        error.info.name === errors.connectionDisconnected.name
      ) {
        log.warn(
          'reconnect happened while subscribeChannelEvents. retry',
          createWarnPayload({
            operationName: 'RtcRpcApiClient.subscribeChannelEvents',
            detail: 'reconnect happened while subscribeChannelEvents. retry',
            appId,
            channelId,
            payload: { offset },
          }),
          error
        );
        await this.subscribeChannelEvents({ appId, channelId, offset });
      } else {
        log.error(
          '[failed] subscribeChannelEvents',
          createError({
            operationName: 'RtcRpcApiClient.subscribeChannelEvents',
            info: {
              ...errors.internalError,
              detail: 'subscribeChannelEvents failed',
            },
            path: log.prefix,
            error,
            payload: { offset },
            appId,
            channelId,
          })
        );
        throw error;
      }
    }
  }
}
