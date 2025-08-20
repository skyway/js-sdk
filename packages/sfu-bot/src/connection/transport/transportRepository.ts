import { Event, Logger } from '@skyway-sdk/common';
import {
  AnalyticsSession,
  createError,
  getRuntimeInfo,
  IceManager,
  SkyWayContext,
} from '@skyway-sdk/core';
import { SfuRestApiClient } from '@skyway-sdk/sfu-api-client';
import { Device } from '@skyway-sdk/mediasoup-client';
import { RtpCapabilities } from '@skyway-sdk/mediasoup-client/lib/RtpParameters';
import { TransportOptions } from '@skyway-sdk/mediasoup-client/lib/Transport';

import { errors } from '../../errors';
import { SfuBotMember } from '../../member';
import { SfuTransport } from './transport';

const log = new Logger(
  'packages/sfu-bot/src/connection/transport/transportRepository.ts'
);

export class TransportRepository {
  onTransportCreated = new Event<string>();

  private readonly _device: Device;
  /**@private */
  _transports: { [id: string]: SfuTransport } = {};

  get rtpCapabilities() {
    if (!this._device.loaded) {
      return undefined;
    }
    return this._device.rtpCapabilities;
  }

  constructor(
    private _context: SkyWayContext,
    private readonly _api: SfuRestApiClient
  ) {
    const { browserName, browserVersion } = getRuntimeInfo();
    log.debug('runtime info', { browserName, browserVersion });
    // wkwebview対応
    if (browserName === 'Safari' && browserVersion == undefined) {
      this._device = new Device({ handlerName: 'Safari12' });
    } else {
      this._device = new Device();
    }
  }

  async loadDevice(rtpCapabilities: RtpCapabilities) {
    if (!this._device.loaded) {
      await this._device
        .load({
          routerRtpCapabilities: rtpCapabilities as any,
        })
        .catch((err) => {
          throw createError({
            operationName: 'TransportRepository.loadDevice',
            context: this._context,
            info: { ...errors.internal, detail: 'loadDevice failed' },
            path: log.prefix,
            payload: { rtpCapabilities },
            error: err,
          });
        });
      log.debug('device loaded', {
        routerRtpCapabilities: rtpCapabilities,
        rtpCapabilities: this._device.rtpCapabilities,
      });
    }
  }

  /**worker内にmemberIdに紐つくTransportが無ければ新しいTransportが作られる */
  createTransport(
    personId: string,
    bot: SfuBotMember,
    transportOptions: TransportOptions,
    direction: 'send' | 'recv',
    iceManager: IceManager,
    analyticsSession?: AnalyticsSession
  ) {
    const createTransport =
      direction === 'send'
        ? (o: TransportOptions) => this._device.createSendTransport(o)
        : (o: TransportOptions) => this._device.createRecvTransport(o);

    const msTransport = createTransport({
      ...transportOptions,
      iceServers: iceManager.iceServers,
      iceTransportPolicy:
        this._context.config.rtcConfig.turnPolicy === 'turnOnly'
          ? 'relay'
          : undefined,
      additionalSettings: this._context.config.rtcConfig,
    });

    const transport = new SfuTransport(
      msTransport,
      bot,
      iceManager,
      this._api,
      this._context,
      analyticsSession
    );
    this._transports[personId + msTransport.id] = transport;

    this.onTransportCreated.emit(msTransport.id);

    return transport;
  }

  readonly getTransport = (personId: string, id: string) =>
    this._transports[personId + id];

  deleteTransports(personId: string) {
    Object.entries({ ...this._transports }).forEach(([id, transport]) => {
      if (id.includes(personId)) {
        transport.close();
        delete this._transports[id];
      }
    });
  }
}
