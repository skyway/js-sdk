import { SfuApiOptions } from '.';

export const defaultSfuApiOptions: Omit<SfuApiOptions, 'log'> = {
  domain: 'sfu.skyway.ntt.com',
  secure: true,
  version: 4,
};
