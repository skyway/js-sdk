import {
  type EventInterface,
  Events,
  Logger,
  type RuntimeInfo,
  SkyWayError,
  type SkyWayErrorInterface,
} from '@skyway-sdk/common';
import type model from '@skyway-sdk/model';
import type { MemberType } from '@skyway-sdk/model';
import { RtcApiClient } from '@skyway-sdk/rtc-api-client';
import { SkyWayAuthToken } from '@skyway-sdk/token';
import { v4 as uuidV4 } from 'uuid';
import { createForDevelopmentAuthTokenString } from './auth/createForDevelopmentAuthTokenString';
import type { SkyWayChannelImpl } from './channel';
import {
  ContextConfig,
  type SkyWayConfigOptions,
  type SkyWayContextConfig,
} from './config';
import { errors } from './errors';
import {
  type AnalyticsSession,
  setupAnalyticsSession,
} from './external/analytics';
import type { RemoteMemberImplInterface } from './member/remoteMember';
import type {
  SkyWayPlugin,
  SkyWayPluginInterface,
} from './plugin/interface/plugin';
import { registerPersonPlugin } from './plugin/internal/person/plugin';
import { UnknownPlugin } from './plugin/internal/unknown/plugin';
import { createError, createWarnPayload, getRuntimeInfo } from './util';
import { PACKAGE_VERSION } from './version';

const log = new Logger('packages/core/src/context.ts');

export interface SkyWayContextInterface {
  /**@description [japanese] コンテキストの設定 */
  config: SkyWayContextConfig;
  /**@description [japanese] SkyWayのアプリケーションID */
  readonly appId: string;
  /**@description [japanese] コンテキストが破棄済みかどうかを示すフラグ */
  readonly disposed: boolean;
  /**@description [japanese] トークンのエンコード済み文字列 */
  readonly authTokenString: string;

  /**@description [japanese] トークンの期限がまもなく切れることを通知するイベント */
  readonly onTokenUpdateReminder: EventInterface<void>;
  /**@description [japanese] トークンの期限切れを通知するイベント。このイベントが発火された場合、トークンを更新するまでサービスを利用できない */
  readonly onTokenExpired: EventInterface<void>;
  /**@description [japanese] 回復不能なエラーが発生したことを通知するイベント。インターネット接続状況を確認した上で別のインスタンスを作り直す必要がある */
  readonly onFatalError: EventInterface<SkyWayErrorInterface>;
  /**@description [japanese] トークンが更新されたことを通知するイベント */
  readonly onTokenUpdated: EventInterface<string>;
  /**@description [japanese] コンテキストが破棄されたことを通知するイベント */
  readonly onDisposed: EventInterface<void>;

  /**@private @deprecated */
  readonly _onTokenUpdated: EventInterface<string>;
  /**@private @deprecated */
  readonly _onDisposed: EventInterface<void>;

  /**@description [japanese] トークンの更新 */
  updateAuthToken(token: string): Promise<void>;
  /**@description [japanese] プラグインの登録 */
  registerPlugin(plugin: SkyWayPluginInterface): void;
  /**
   * @description [japanese] コンテキストの利用を終了し次のリソースを解放する
   * - イベントリスナー
   * - バックエンドサーバとの通信
   * - コンテキストを参照する全Channelインスタンス
   */
  dispose(): void;
}

export class SkyWayContext implements SkyWayContextInterface {
  /**@internal */
  static version = PACKAGE_VERSION;

  /**@internal */
  static id = uuidV4();

  /**
   * @description [japanese] 開発用途向けContextの作成
   */
  static async CreateForDevelopment(
    appId: string,
    secretKey: string,
    configOptions: Partial<SkyWayConfigOptions> = {},
  ) {
    const warningPayload = createWarnPayload({
      operationName: 'SkyWayContext.CreateForDevelopment',
      detail:
        'To prevent leakage of authentication information, please refrain from using this method in release versions of your app.',
      payload: { appId },
    });

    console.warn('SkyWayContext.CreateForDevelopment', warningPayload);

    const tokenString = createForDevelopmentAuthTokenString({
      appId,
      secretKey,
    });

    const context = await SkyWayContext.Create(tokenString, configOptions);

    const autoUpdateAuthToken = async (): Promise<void> => {
      const newTokenString = createForDevelopmentAuthTokenString({
        appId,
        secretKey,
      });

      try {
        await context.updateAuthToken(newTokenString);
      } catch (error) {
        log.warn(
          '[failed] SkyWayContext.CreateForDevelopment.autoUpdateAuthToken',
          {
            detail: error,
            appId,
          },
        );
      }
    };

    const { removeListener } = context.onTokenUpdateReminder.add(async () => {
      await autoUpdateAuthToken();
    });
    context.onDisposed.once(() => {
      removeListener();
    });

    return context;
  }

  /**
   * @description [japanese] Contextの作成
   */
  static async Create(
    authTokenString: string,
    configOptions: Partial<SkyWayConfigOptions> = {},
  ) {
    const config = new ContextConfig(configOptions);
    Logger.level = config.log.level;
    Logger.format = config.log.format;

    const token = SkyWayAuthToken.Decode(authTokenString);

    const { osName, osVersion, browserName, browserVersion } = getRuntimeInfo();
    const runtime = {
      sdkName: 'core',
      sdkVersion: SkyWayContext.version,
      osName,
      osVersion,
      browserName,
      browserVersion,
    };
    const endpoint = {
      rapi: config.rtcApi.domain,
      signaling: config.signalingService.domain,
      ice: config.iceParamServer.domain,
    };

    log.info('core sdk spawned', {
      operationName: 'SkyWayContext.Create',
      runtime,
      endpoint,
      config,
      token,
    });

    try {
      const appId = token.getAppId();
      const api = await RtcApiClient.Create({
        appId,
        token: authTokenString,
        log: config.log,
        rtcApi: config.rtcApi,
      });
      const context = new SkyWayContext(api, config, token, {
        endpoint,
        runtime,
      });

      await context._setTokenExpireTimer();

      if (token.getAnalyticsEnabled()) {
        context.analyticsSession = await setupAnalyticsSession(context);
      }

      return context;
    } catch (error: any) {
      throw createError({
        operationName: 'SkyWayContext.Create',
        info: errors.connectRtcApiFailed,
        error,
        path: log.prefix,
      });
    }
  }

  readonly appId: string;
  disposed = false;

  /**@internal */
  public plugins: SkyWayPlugin[] = [];
  private _unknownPlugin = new UnknownPlugin();

  /**@internal */
  public analyticsSession: AnalyticsSession | undefined;

  /**@private */
  readonly _api: RtcApiClient;
  private _authTokenString: string;
  /**seconds */
  private _remindSec = this.config.token.updateRemindSec;
  private _tokenUpdateRemindTimer: any;
  private _tokenExpiredTimer: any;

  private _events = new Events();
  /**
   * @description [japanese] トークンの期限がまもなく切れることを通知するイベント
   * @example
   * context.onTokenUpdateReminder.add(() => {
      context.updateAuthToken(tokenString);
    });
   */
  readonly onTokenUpdateReminder = this._events.make<void>();
  /**
   * @description [japanese] トークンの期限切れを通知するイベント。このイベントが発火された場合、トークンを更新するまでサービスを利用できない
   */
  readonly onTokenExpired = this._events.make<void>();

  /**
   * @description [japanese] SkyWayの利用中にネットワークの瞬断などが原因で再接続が開始されたときに発火するイベント
   */
  readonly onReconnectStart = this._events.make<void>();

  /**
   * @description [japanese] SkyWayの再接続が成功したときに発火するイベント
   */
  readonly onReconnectSuccess = this._events.make<void>();

  /**
   * @description [japanese] 回復不能なエラーが発生したことを通知するイベント。インターネット接続状況を確認した上で別のインスタンスを作り直す必要がある
   */
  readonly onFatalError = this._events.make<SkyWayErrorInterface>();

  /**@private @deprecated */
  readonly _onTokenUpdated = this._events.make<string>();
  /**@private @deprecated */
  readonly _onDisposed = this._events.make<void>();

  /**@description [japanese] トークンが更新されたことを通知するイベント */
  readonly onTokenUpdated = this._events.make<string>();
  /**@description [japanese] コンテキストが破棄されたことを通知するイベント */
  readonly onDisposed = this._events.make<void>();

  /**@private */
  constructor(
    api: RtcApiClient,
    public config: ContextConfig,
    public authToken: SkyWayAuthToken,
    /**@internal */
    readonly info: { endpoint: EndpointInfo; runtime: RuntimeInfo },
  ) {
    this._authTokenString = authToken.tokenString!;
    this.appId = this.authToken.getAppId();

    registerPersonPlugin(this);

    this._api = api;
    this._api.onReconnectStart.add(() => {
      log.info('onReconnectStart', { appId: this.appId });
      this.onReconnectStart.emit();
    });
    this._api.onReconnectSuccess.add(() => {
      log.info('onReconnectSuccess', { appId: this.appId });
      this.onReconnectSuccess.emit();
    });
    this._api.onFatalError.once((error) => {
      log.error('onFatalError', { appId: this.appId, error });
      this.onFatalError.emit(
        createError({
          operationName: 'SkyWayContext._api.onFatalError',
          context: this,
          info: errors.rtcApiFatalError,
          error,
          path: log.prefix,
        }),
      );
      this.dispose();
    });
  }

  /**@description [japanese] トークンのエンコード済み文字列 */
  get authTokenString() {
    return this._authTokenString;
  }

  /**@internal */
  async _setTokenExpireTimer() {
    // seconds
    const now = await this._api.getServerUnixtimeInSec();

    const expiresInSec = this.authToken.exp - now;
    if (expiresInSec < 0) {
      throw createError({
        operationName: 'SkyWayContext._setTokenExpireTimer',
        context: this,
        info: errors.invalidExpireTokenValue,
        path: log.prefix,
        payload: { exp: this.authToken.exp, now },
      });
    }

    if (this._tokenUpdateRemindTimer) {
      clearTimeout(this._tokenUpdateRemindTimer);
    }
    const tokenExpireRemindTimeSec = expiresInSec - this._remindSec;
    if (tokenExpireRemindTimeSec < 0) {
      throw createError({
        operationName: 'SkyWayContext._setTokenExpireTimer',
        context: this,
        info: errors.invalidRemindExpireTokenValue,
        path: log.prefix,
        payload: { expiresInSec, remindSec: this._remindSec },
      });
    }
    log.debug('_setTokenExpireTimer', {
      expiresInSec,
      tokenExpireReminderTimeSec: tokenExpireRemindTimeSec,
    });

    this._tokenUpdateRemindTimer = setTimeout(() => {
      log.debug('tokenUpdateReminder', { appid: this.appId });
      this.onTokenUpdateReminder.emit();
    }, tokenExpireRemindTimeSec * 1000);

    if (this._tokenExpiredTimer) {
      clearTimeout(this._tokenExpiredTimer);
    }
    this._tokenExpiredTimer = setTimeout(() => {
      log.debug('tokenExpired', { appid: this.appId });
      this.onTokenExpired.emit();
    }, expiresInSec * 1000);
  }

  /**
   * @description [japanese] トークンの更新
   */
  async updateAuthToken(token: string) {
    const newToken = SkyWayAuthToken.Decode(token);
    const newAppId = newToken.getAppId();
    log.info(
      { operationName: 'SkyWayContext.updateAuthToken' },
      { oldToken: this.authToken, newToken },
    );

    if (newAppId !== this.appId) {
      throw createError({
        operationName: 'SkyWayContext.updateAuthToken',
        context: this,
        info: errors.invalidTokenAppId,
        path: log.prefix,
        payload: { invalid: newAppId, expect: this.appId },
      });
    }

    this._authTokenString = token;
    this.authToken = newToken;

    this._onTokenUpdated.emit(token);
    this.onTokenUpdated.emit(token);
    await this._setTokenExpireTimer();

    await this._api.updateAuthToken(token).catch((e) => {
      log.warn('[failed] SkyWayContext.updateAuthToken', { detail: e });

      if (
        e instanceof SkyWayError &&
        e.info?.name === 'projectUsageLimitExceeded'
      ) {
        this.dispose();
        clearTimeout(this._tokenExpiredTimer);
      }

      throw e;
    });
  }

  /**
   * @description [japanese] プラグインの登録
   */
  registerPlugin(plugin: SkyWayPlugin) {
    if (this.plugins.find((p) => p.subtype === plugin.subtype)) {
      return;
    }
    plugin._attachContext(this);
    this.plugins.push(plugin);
  }

  /**@private */
  _createRemoteMember(
    channel: SkyWayChannelImpl,
    memberDto: model.Member,
  ): RemoteMemberImplInterface {
    log.debug('createRemoteMember', { memberDto });

    memberDto.type = memberDto.type.toLowerCase() as MemberType;
    memberDto.subtype = memberDto.subtype.toLowerCase();

    let plugin = this.plugins.find((p) => p.subtype === memberDto.subtype);
    if (!plugin) {
      plugin = this._unknownPlugin;
    }
    const member = plugin._createRemoteMember(channel, memberDto);
    return member;
  }

  /**
   * @description [japanese] Contextの利用を終了し次のリソースを解放する
   * - イベントリスナー
   * - バックエンドサーバとの通信
   * - コンテキストを参照する全Channelインスタンス
   */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    log.debug('disposed', { appid: this.appId });

    clearTimeout(this._tokenUpdateRemindTimer);

    this._onDisposed.emit();
    this.onDisposed.emit();
    this._events.dispose();

    this._api.close();

    Logger._onLogForAnalytics = () => {};
  }
}

/**@internal */
export interface EndpointInfo {
  rapi: string;
  signaling: string;
  ice: string;
}
