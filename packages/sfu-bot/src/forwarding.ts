import { Event, Logger } from '@skyway-sdk/common';
import {
  createError,
  Publication,
  SkyWayContext,
  Subscription,
} from '@skyway-sdk/core';
import { SfuRestApiClient } from '@skyway-sdk/sfu-api-client';

import { errors } from './errors';

const log = new Logger('packages/sfu-bot/src/connection/sender.ts');

export class Forwarding {
  state: ForwardingState = 'started';
  configure: ForwardingConfigure = this.props.configure;
  originPublication: Publication = this.props.originPublication;
  relayingPublication: Publication = this.props.relayingPublication;

  private _identifierKey: string = this.props.identifierKey;
  private _api: SfuRestApiClient = this.props.api;
  private _context: SkyWayContext = this.props.context;

  /** @description [japanese] forwardingが終了された時に発火するイベント */
  readonly onStopped = new Event<void>();

  /**@internal */
  constructor(
    private props: {
      configure: ForwardingConfigure;
      originPublication: Publication;
      relayingPublication: Publication;
      api: SfuRestApiClient;
      context: SkyWayContext;
      identifierKey: string;
    }
  ) {
    this.relayingPublication.onSubscribed.add(async (e) => {
      await this.confirmSubscription(e.subscription).catch((e) => e);
    });
    this.relayingPublication.subscriptions.forEach(async (subscription) => {
      await this.confirmSubscription(subscription).catch((e) => e);
    });
  }

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

  /**
   * @deprecated
   */
  async confirmSubscription(subscription: Subscription) {
    log.debug('[start] Forwarding confirmSubscription');
    const { message } = await this._api
      .confirmSubscription({
        forwardingId: this.id,
        subscriptionId: subscription.id,
        identifierKey: this._identifierKey,
      })
      .catch((error) => {
        log.error('Forwarding confirmSubscription failed:', error);
        throw createError({
          operationName: 'Forwarding.confirmSubscription',
          context: this._context,
          info: errors.confirmSubscriptionFailed,
          path: log.prefix,
          payload: error,
        });
      });
    log.debug('[end] Forwarding confirmSubscription', { message });
  }
}

export type ForwardingState = 'started' | 'stopped';

export interface ForwardingConfigure {
  maxSubscribers: number;
}
