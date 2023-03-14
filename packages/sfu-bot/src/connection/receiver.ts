import { EventDisposer, Logger } from '@skyway-sdk/common';
import {
  createError,
  IceManager,
  LocalPersonImpl,
  RemoteStream,
  SkyWayContext,
  statsToArray,
  SubscriptionImpl,
  uuidV4,
} from '@skyway-sdk/core';
import { createRemoteStream } from '@skyway-sdk/core';
import { SfuRestApiClient } from '@skyway-sdk/sfu-api-client';
import { Consumer } from 'mediasoup-client/lib/Consumer';

import { errors } from '../errors';
import { SfuBotMember } from '../member';
import { getLayerFromEncodings } from '../util';
import { SfuTransport } from './transport/transport';
import { TransportRepository } from './transport/transportRepository';

const log = new Logger('packages/sfu-bot/src/connection/receiver.ts');

export class Receiver {
  consumer?: Consumer;
  transport?: SfuTransport;

  private _disposer = new EventDisposer();

  constructor(
    readonly subscription: SubscriptionImpl,
    private readonly _api: SfuRestApiClient,
    private readonly _transportRepository: TransportRepository,
    private _localPerson: LocalPersonImpl,
    private _bot: SfuBotMember,
    private _iceManager: IceManager,
    private _context: SkyWayContext
  ) {}

  toJSON() {
    return {
      transport: this.transport,
      subscription: this.subscription,
    };
  }

  /**@throws {maxSubscriberExceededError} */
  async consume() {
    let rtpCapabilities = this._transportRepository.rtpCapabilities;
    if (!rtpCapabilities) {
      log.debug('[start] getCapabilities');
      rtpCapabilities = await this._api.getRtpCapabilities({
        botId: this._bot.id,
        forwardingId: this.subscription.publication.id,
        originPublicationId: this.subscription.publication.origin!.id,
      });
      log.debug('[end] getCapabilities');

      await this._transportRepository.loadDevice(rtpCapabilities).catch((e) => {
        throw createError({
          operationName: 'Receiver.consume',
          context: this._context,
          channel: this._localPerson.channel,
          info: { ...errors.internal, detail: 'sfu loadDevice failed' },
          path: log.prefix,
          error: e,
        });
      });
    }

    const spatialLayer = this.subscription.preferredEncoding
      ? getLayerFromEncodings(
          this.subscription.preferredEncoding,
          this.subscription.publication.origin?.encodings ?? []
        )
      : undefined;

    log.debug('[start] createConsumer', { subscription: this.subscription });

    const { consumerOptions, transportOptions, transportId, producerId } =
      await this._api.createConsumer({
        botId: this._bot.id,
        forwardingId: this.subscription.publication.id,
        rtpCapabilities,
        subscriptionId: this.subscription.id,
        subscriberId: this.subscription.subscriber.id,
        spatialLayer,
        originPublicationId: this.subscription.publication.origin!.id,
      });
    if (transportOptions) {
      this._transportRepository.createTransport(
        this._localPerson.id,
        this._bot,
        transportOptions as any,
        'recv',
        this._iceManager
      );
    }

    this.transport = this._transportRepository.getTransport(
      this._localPerson.id,
      transportId
    );
    if (!this.transport) {
      log.warn('transport is under race condition', { transportId });
      await this._transportRepository.onTransportCreated
        .watch((id) => id === transportId, this._bot.options.endpointTimeout)
        .catch((e) => {
          throw createError({
            operationName: 'Receiver.consume',
            context: this._context,
            channel: this._localPerson.channel,
            info: {
              ...errors.timeout,
              detail: 'receiver sfuTransport not found',
            },
            path: log.prefix,
            error: e,
            payload: {
              transportOptions,
              transportId,
              producerId,
              consumerOptions,
              subscription: this.subscription,
            },
          });
        });
      this.transport = this._transportRepository.getTransport(
        this._localPerson.id,
        transportId
      );
    }

    log.debug('[end] createConsumer');

    log.debug('[start] consume', {
      consumerOptions,
      subscription: this.subscription,
    });
    const consumer = await this.transport.msTransport
      .consume({
        ...consumerOptions,
        producerId,
      })
      .catch((e) => {
        throw createError({
          operationName: 'Receiver.consume',
          context: this._context,
          channel: this._localPerson.channel,
          info: {
            ...errors.internal,
            detail: 'consume failed, maybe subscribing unsupported codec',
          },
          path: log.prefix,
          error: e,
        });
      });
    this.consumer = consumer;
    log.debug('[end] consume', { subscription: this.subscription });

    const [selectedCodec] = consumer.rtpParameters.codecs;

    const stream = createRemoteStream(uuidV4(), consumer.track, selectedCodec);
    const codec = {
      mimeType: selectedCodec.mimeType,
      parameters: selectedCodec.parameters,
    };
    this._setupTransportAccessForStream(stream, consumer);

    return { stream, codec };
  }

  private _setupTransportAccessForStream(
    stream: RemoteStream,
    consumer: Consumer
  ) {
    const transport = this.transport!;
    const pc = this.pc!;

    stream._getTransport = () => ({
      rtcPeerConnection: pc,
      connectionState: transport.connectionState,
      info: this,
    });
    stream._getStats = async () => {
      const stats = await consumer.getStats();
      let arr = statsToArray(stats);
      arr = arr.map((stats) => {
        stats['sfuTransportId'] = transport.id;
        return stats;
      });
      return arr;
    };
    this._disposer.push(() => {
      stream._getTransport = () => undefined;
    });
    transport.onConnectionStateChanged
      .add((state) => stream.onConnectionStateChanged.emit(state))
      .disposer(this._disposer);
  }

  unconsume() {
    if (!this.consumer) {
      log.debug('unconsume failed, consumer not exist', {
        subscription: this.subscription,
      });
      return;
    }

    this.consumer.close();
    this.consumer = undefined;
  }

  close() {
    this._disposer.dispose();
  }

  get pc() {
    return this.transport?.pc;
  }
}
