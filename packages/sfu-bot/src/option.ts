import {
  defaultSfuApiOptions,
  SfuApiOptions,
} from '@skyway-sdk/sfu-api-client';

export type SfuBotPluginOptions = Omit<SfuApiOptions, 'log'> & {
  endpointTimeout: number;
  ackTimeout: number;
  disableRestartIce: boolean;
  peerConnectionJitterTimeout: number;
};

export const defaultSfuBotPluginOptions: SfuBotPluginOptions = {
  ...defaultSfuApiOptions,
  endpointTimeout: 30_000,
  ackTimeout: 10_000,
  peerConnectionJitterTimeout: 5_000,
  disableRestartIce: false,
};
