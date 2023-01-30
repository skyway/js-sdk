import { Event } from '@skyway-sdk/common';
import { ChannelEvent } from '@skyway-sdk/rtc-rpc-api-client';

export interface EventObserver {
  onEvent: Event<ChannelEvent>;

  dispose: () => void;
}
