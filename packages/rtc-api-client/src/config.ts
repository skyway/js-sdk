import { LogFormat, LogLevel } from '@skyway-sdk/common';
import { RtcRpcApiConfig } from '@skyway-sdk/rtc-rpc-api-client';
import deepmerge from 'deepmerge';

export { RtcRpcApiConfig };

/**@internal */
export type RtcApiConfig = RtcRpcApiConfig & { eventSubscribeTimeout?: number };

export interface ConfigOptions {
  rtcApi: RtcApiConfig;
  log?: Partial<{ level: LogLevel; format: LogFormat }>;
}

export type TurnPolicy = 'enable' | 'disable' | 'turnOnly';

export class Config implements ConfigOptions {
  rtcApi: Required<ConfigOptions['rtcApi']> = {
    domain: 'rtc-api.skyway.ntt.com',
    timeout: 30_000,
    secure: true,
    eventSubscribeTimeout: 5000,
  };
  log: Required<ConfigOptions['log']> = {
    level: 'error',
    format: 'object',
  };

  constructor(options: Partial<ConfigOptions> = {}) {
    Object.assign(this, deepmerge(this, options));
  }
}
