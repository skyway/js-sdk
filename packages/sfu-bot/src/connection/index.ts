import { Event, Logger, PromiseQueue } from '@skyway-sdk/common';
import {
  createError,
  LocalAudioStream,
  LocalCustomVideoStream,
  LocalPersonImpl,
  LocalVideoStream,
  Publication,
  PublicationImpl,
  SkyWayChannelImpl,
  SkyWayConnection,
  SkyWayContext,
  Subscription,
  SubscriptionImpl,
} from '@skyway-sdk/core';
import { SfuRestApiClient } from '@skyway-sdk/sfu-api-client';

import { errors } from '../errors';
import { SfuBotMember } from '../member';
import { getLayerFromEncodings } from '../util';
import { Receiver } from './receiver';
import { Sender } from './sender';
import { TransportRepository } from './transport/transportRepository';

const log = new Logger('packages/sfu-bot/src/connection/index.ts');

/**@internal */
export class SFUConnection implements SkyWayConnection {
  readonly type = 'sfu';
  readonly onDisconnect = new Event<void>();
  readonly onClose = new Event<void>();
  closed = false;

  /**@private */
  _receivers: {
    [subscriptionId: string]: Receiver;
  } = {};
  /**@private */
  _senders: {
    [forwardingId: string]: Sender;
  } = {};

  /**@internal */
  constructor(
    private readonly _api: SfuRestApiClient,
    readonly channel: SkyWayChannelImpl,
    readonly localPerson: LocalPersonImpl,
    readonly remoteMember: SfuBotMember,
    private _transportRepository: TransportRepository,
    private _context: SkyWayContext
  ) {}

  /**@internal */
  addSender(
    publication: PublicationImpl<
      LocalAudioStream | LocalVideoStream | LocalCustomVideoStream
    >
  ) {
    const sender = new Sender(
      publication,
      this.channel,
      this._api,
      this._transportRepository,
      this.localPerson,
      this.remoteMember,
      this.localPerson.iceManager,
      this._context
    );
    this._senders[publication.id] = sender;

    return sender;
  }

  /**@internal */
  removeSender(originPublicationId: string) {
    log.debug('removeSender', originPublicationId);
    const sender = this._senders[originPublicationId];
    if (!sender) {
      return;
    }
    sender.unproduce();
  }

  async startSubscribing(subscription: SubscriptionImpl) {
    const receiver = new Receiver(
      subscription,
      this._api,
      this._transportRepository,
      this.localPerson,
      this.remoteMember,
      this.localPerson.iceManager,
      this._context
    );
    this._receivers[subscription.id] = receiver;

    const ts = log.debug('[start] _startSubscribing consume');
    const { stream, codec } = await receiver.consume().catch((e) => {
      log.error(
        '[failed] _startSubscribing consume',
        createError({
          operationName: 'SFUConnection.startSubscribing',
          context: this._context,
          channel: this.channel,
          info: { ...errors.internal, detail: 'failed to receiver.consume' },
          error: e,
          path: log.prefix,
          payload: { subscription: subscription.toJSON() },
        })
      );
      throw e;
    });
    log.elapsed(ts, '[end] _startSubscribing consume');

    stream.setIsEnabled(subscription.publication.state === 'enabled');
    subscription.codec = codec;
    subscription._setStream(stream);

    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      const preferredEncoding = subscription.preferredEncoding;
      const encodings = subscription.publication.origin?.encodings;
      if (!preferredEncoding || !encodings || encodings.length === 0) {
        return;
      }
      const layer = getLayerFromEncodings(preferredEncoding, encodings);
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendSubscriptionUpdatePreferredEncodingReport(
        {
          subscriptionId: subscription.id,
          preferredEncodingIndex: layer,
          updatedAt: Date.now(),
        }
      );
    }
  }

  /**@internal */
  async stopSubscribing(subscription: Subscription) {
    const connection = this._receivers[subscription.id];
    if (!connection) {
      return;
    }
    connection.unconsume();
  }

  /**@internal */
  async stopPublishing(publication: Publication) {
    this.removeSender(publication.id);
  }

  /**@internal */
  close({ reason }: { reason?: string } = {}) {
    if (this.closed) {
      return;
    }
    log.debug('close sfu connection', {
      remote: this.remoteMember,
      local: this.localPerson,
      reason,
    });

    this.closed = true;
    Object.values(this._senders).forEach((sender) => {
      sender.close();
    });
    Object.values(this._receivers).forEach((receiver) => {
      receiver.close();
    });
    this._senders = {};
    this._receivers = {};

    this.onClose.emit();
  }

  private _getReceiver(subscriptionId: string): Receiver | undefined {
    return this._receivers[subscriptionId];
  }

  async changePreferredEncoding(subscription: SubscriptionImpl) {
    const preferredEncoding = subscription.preferredEncoding;
    const encodings = subscription.publication.origin?.encodings;
    log.debug('changePreferredEncoding', {
      preferredEncoding,
      encodings,
      subscription,
    });

    if (!preferredEncoding) {
      throw createError({
        operationName: 'SFUConnection.changePreferredEncoding',
        context: this._context,
        channel: this.channel,
        info: errors.invalidPreferredEncoding,
        path: log.prefix,
        payload: { subscription },
      });
    }
    if (!encodings || encodings.length === 0) {
      throw createError({
        operationName: 'SFUConnection.changePreferredEncoding',
        context: this._context,
        channel: this.channel,
        info: errors.invalidEncodings,
        path: log.prefix,
        payload: { subscription },
      });
    }

    const layer = getLayerFromEncodings(preferredEncoding, encodings);

    const receiver = this._getReceiver(subscription.id);
    if (!receiver) {
      throw createError({
        operationName: 'SFUConnection.changePreferredEncoding',
        context: this._context,
        channel: this.channel,
        info: errors.receiverNotFound,
        path: log.prefix,
        payload: { subscription },
      });
    }

    const transport = receiver.transport;
    if (!transport) {
      throw createError({
        operationName: 'SFUConnection.changePreferredEncoding',
        context: this._context,
        channel: this.channel,
        info: { ...errors.internal, detail: 'transport not found' },
        path: log.prefix,
        payload: { subscription },
      });
    }

    const consumer = receiver.consumer;
    if (!consumer) {
      throw createError({
        operationName: 'SFUConnection.changePreferredEncoding',
        context: this._context,
        channel: this.channel,
        info: errors.consumerNotFound,
        path: log.prefix,
        payload: { subscription },
      });
    }

    await this._api.changeConsumerLayer({
      transportId: transport.id,
      consumerId: consumer.id,
      publicationId: subscription.publication.id,
      spatialLayer: layer,
    });

    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendSubscriptionUpdatePreferredEncodingReport(
        {
          subscriptionId: subscription.id,
          preferredEncodingIndex: layer,
          updatedAt: Date.now(),
        }
      );
    }
  }
}
