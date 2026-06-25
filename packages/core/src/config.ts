import { type LogFormat, Logger, type LogLevel } from '@skyway-sdk/common';
import type { RtcApiConfig, RtcRpcApiConfig } from '@skyway-sdk/rtc-api-client';
import deepmerge from 'deepmerge';

import { errors } from './errors';
import { createError } from './util';

export type { RtcApiConfig, RtcRpcApiConfig };

const log = new Logger('packages/core/src/config.ts');

export type SkyWayConfigOptions = {
  /**@internal */
  rtcApi: RtcApiConfig;
  /**@internal */
  iceParamServer: { domain?: string; version?: number; secure?: boolean };
  /**@internal */
  signalingService: { domain?: string; secure?: boolean };
  /**@internal */
  analyticsService: { domain?: string; secure?: boolean };
  rtcConfig: {
    /**
     * @internal
     * @description ms
     * */
    timeout?: number;
    turnPolicy?: TurnPolicy;
    /**
     * @internal
     */
    stunPolicy?: 'enable' | 'disable';
    /**
     * @description [japanese] STUNサーバーへの接続に使用するポート番号。443, 3478のどちらか又は両方を指定できる。デフォルトは443。
     */
    stunPorts?: (443 | 3478)[];
    turnProtocol?: TurnProtocol;
    /**
     * @internal
     * @description ms
     * */
    iceDisconnectBufferTimeout?: number;
  };
  token: { updateRemindSec?: number };
  log: Partial<{ level: LogLevel; format: LogFormat }>;
  /**@internal */
  internal: { disableDPlane?: boolean };
  member: Partial<
    LocalMemberConfig & {
      /**
       * @internal
       * @readonly
       * */
      leaveWhenDisconnected?: boolean;
    }
  >;
};

/**
 * @description [japanese] LocalMemberに関する設定
 * @description [japanese]
 * MemberはpreventAutoLeaveOnBeforeUnloadがfalseもしくは未指定の場合、ブラウザのタブを閉じるとChannelから削除される。
 * preventAutoLeaveOnBeforeUnloadがtrueの場合、
 * もしくはiOS safariのようなbeforeunloadイベントに対応していないブラウザを使用している場合は、
 * タブを閉じたあと最長でkeepaliveIntervalSec + keepaliveIntervalGapSec秒後にChannelから削除される。
 */
export type LocalMemberConfig = {
  /**@description [japanese] trueの場合、beforeunloadイベントで自動的にleaveしない。デフォルトはfalse */
  preventAutoLeaveOnBeforeUnload: boolean;
  /**@description [japanese] KeepAliveを行う周期 */
  keepaliveIntervalSec: number;
  /**@description [japanese] KeepAliveの周期を超えてChannelからMemberが削除されるまでの時間 */
  keepaliveIntervalGapSec: number;
};

/**@internal */
export type MemberInternalConfig = {
  /**@internal */
  disableSignaling?: boolean;
  disableAnalytics?: boolean;
};

export type TurnPolicy = 'enable' | 'disable' | 'turnOnly';

export type TurnProtocol = 'all' | 'udp' | 'tcp' | 'tls';

// SkyWayConfigOptionsの全てのプロパティをRequiredにしてContextConfigクラスへ代入可能となった型
// SkyWayContextInterfaceはこちらを利用することで、クラスを直接参照することなく後方互換性を保つ
export type SkyWayContextConfig = {
  rtcApi: Required<SkyWayConfigOptions['rtcApi']>;
  iceParamServer: Required<SkyWayConfigOptions['iceParamServer']>;
  signalingService: Required<SkyWayConfigOptions['signalingService']>;
  analyticsService: Required<SkyWayConfigOptions['analyticsService']>;
  rtcConfig: Required<SkyWayConfigOptions['rtcConfig']>;
  token: Required<SkyWayConfigOptions['token']>;
  log: Required<SkyWayConfigOptions['log']>;
  internal: Required<SkyWayConfigOptions['internal']>;
  member: Required<SkyWayConfigOptions['member']>;
};

export class ContextConfig implements SkyWayConfigOptions {
  /**@internal */
  rtcApi: Required<SkyWayConfigOptions['rtcApi']> = {
    domain: 'rtc-api.skyway.ntt.com',
    timeout: 30_000,
    secure: true,
    eventSubscribeTimeout: 5000,
  };
  /**@internal */
  iceParamServer: Required<SkyWayConfigOptions['iceParamServer']> = {
    domain: 'ice-params.skyway.ntt.com',
    version: 1,
    secure: true,
  };
  /**@internal */
  signalingService: Required<SkyWayConfigOptions['signalingService']> = {
    domain: 'signaling.skyway.ntt.com',
    secure: true,
  };
  /**@internal */
  analyticsService: Required<SkyWayConfigOptions['analyticsService']> = {
    domain: 'analytics-logging.skyway.ntt.com',
    secure: true,
  };
  // stunPortsのデフォルトは443。未指定の場合443に接続する
  rtcConfig: Required<SkyWayConfigOptions['rtcConfig']> = {
    timeout: 30_000,
    turnPolicy: 'enable',
    turnProtocol: 'all',
    stunPolicy: 'enable',
    stunPorts: [443],
    iceDisconnectBufferTimeout: 5000,
  };
  token: Required<SkyWayConfigOptions['token']> = {
    updateRemindSec: 30,
  };
  log: Required<SkyWayConfigOptions['log']> = {
    level: 'error',
    format: 'string',
  };
  /**@internal */
  internal: Required<SkyWayConfigOptions['internal']> = {
    disableDPlane: false,
  };
  member: Required<SkyWayConfigOptions['member']> = {
    keepaliveIntervalGapSec: 30,
    keepaliveIntervalSec: 30,
    preventAutoLeaveOnBeforeUnload: false,
    leaveWhenDisconnected: false,
  };
  /**@internal */
  constructor(options: Partial<SkyWayConfigOptions> = {}) {
    Object.assign(this, deepmerge(this, options));
    // stunPortsはデフォルト[443]と結合せず、指定があれば上書きする
    if (options.rtcConfig?.stunPorts) {
      this.rtcConfig.stunPorts = options.rtcConfig.stunPorts;
    }
    this._validateStunPorts();
  }

  // stunPortsは443または3478を1つまたは2つ指定できる（空配列・3つ以上・重複・それ以外の値はエラー）
  private _validateStunPorts() {
    const { stunPorts } = this.rtcConfig;
    const isValid =
      Array.isArray(stunPorts) &&
      stunPorts.length >= 1 &&
      stunPorts.length <= 2 &&
      stunPorts.every((port) => [443, 3478].includes(port)) &&
      new Set(stunPorts).size === stunPorts.length;
    if (!isValid) {
      throw createError({
        operationName: 'ContextConfig._validateStunPorts',
        info: errors.invalidStunPorts,
        path: log.prefix,
      });
    }
  }
}
