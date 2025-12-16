import type { Event } from '@skyway-sdk/common';
import type { ChannelEvent } from '@skyway-sdk/rtc-rpc-api-client';

export interface EventObserver {
  onEvent: Event<ChannelEvent>;

  dispose: () => void;
}
