import { Event, Logger } from '@skyway-sdk/common';
import {
  type AnalyticsSession,
  createError,
  getRuntimeInfo,
  type IceManager,
  type SkyWayContext,
} from '@skyway-sdk/core';
import type { SFURestApiClient } from '@skyway-sdk/sfu-api-client';
import { Device, type types } from 'mediasoup-client';

import { errors } from '../../errors';
import type { SFUBotMember } from '../../member';
import { SFUTransport } from './transport';

type RtpCapabilities = types.RtpCapabilities;
type TransportOptions = types.TransportOptions;

const log = new Logger(
  'packages/sfu-bot/src/connection/transport/transportRepository.ts',
);

export class TransportRepository {
  onTransportCreated = new Event<string>();

  private readonly _device: Device;
  /**@private */
  _transports: { [id: string]: SFUTransport } = {};

  /** 受信用の RTP capabilities。Consumer の作成時に SFU へ渡す */
  get recvRtpCapabilities() {
    if (!this._device.loaded) {
      return undefined;
    }
    return this._device.recvRtpCapabilities;
  }

  /**
   * 受信用の RTP capabilities。既存の参照との互換性のために残している
   * @deprecated 受信用であることが分かる {@link recvRtpCapabilities} を使う
   */
  get rtpCapabilities() {
    return this.recvRtpCapabilities;
  }

  /** 送信用の RTP capabilities。Producer のコーデック選択に使う */
  get sendRtpCapabilities() {
    if (!this._device.loaded) {
      return undefined;
    }
    return this._device.sendRtpCapabilities;
  }

  constructor(
    private _context: SkyWayContext,
    private readonly _api: SFURestApiClient,
  ) {
    const { browserName, browserVersion } = getRuntimeInfo();
    log.debug('runtime info', { browserName, browserVersion });
    // wkwebview対応
    if (browserName === 'Safari' && browserVersion === undefined) {
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
        recvRtpCapabilities: this._device.recvRtpCapabilities,
        sendRtpCapabilities: this._device.sendRtpCapabilities,
      });
    }
  }

  /**worker内にmemberIdに紐つくTransportが無ければ新しいTransportが作られる */
  createTransport(
    personId: string,
    bot: SFUBotMember,
    transportOptions: TransportOptions,
    direction: 'send' | 'recv',
    iceManager: IceManager,
    analyticsSession?: AnalyticsSession,
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
    });

    const transport = new SFUTransport(
      msTransport,
      bot,
      iceManager,
      this._api,
      this._context,
      analyticsSession,
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
