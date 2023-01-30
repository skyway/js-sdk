import { Event } from '@skyway-sdk/common';
import { Publication } from '@skyway-sdk/core';

export class Forwarding {
  state: ForwardingState = 'started';
  /** @description [japanese] forwardingが終了された時に発火するイベント */
  readonly onStopped = new Event<void>();

  /**@internal */
  constructor(
    readonly configure: ForwardingConfigure,
    readonly originPublication: Publication,
    readonly relayingPublication: Publication
  ) {}

  get id() {
    return this.relayingPublication.id;
  }

  /**@private */
  _stop() {
    this.state = 'stopped';
    this.onStopped.emit();
  }

  /**@internal */
  toJSON() {
    return {
      id: this.id,
      configure: this.configure,
      originPublication: this.originPublication,
      relayingPublication: this.relayingPublication,
    };
  }
}

export type ForwardingState = 'started' | 'stopped';

export interface ForwardingConfigure {
  maxSubscribers: number;
}
