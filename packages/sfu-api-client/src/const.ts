import type { SFUApiOptions } from '.';

export const defaultSFUApiOptions: Omit<SFUApiOptions, 'log'> = {
  domain: 'sfu.skyway.ntt.com',
  secure: true,
  version: 4,
};
