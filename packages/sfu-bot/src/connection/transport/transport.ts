import { BackOff, Event, SkyWayError } from '@skyway-sdk/common';
import {
  AnalyticsSession,
  createError,
  createLogPayload,
  IceManager,
  Logger,
  SkyWayContext,
  TransportConnectionState,
} from '@skyway-sdk/core';
import { SfuRestApiClient } from '@skyway-sdk/sfu-api-client';
import { DataProducerOptions } from '@skyway-sdk/mediasoup-client/lib/DataProducer';
import { MediaKind, RtpParameters } from '@skyway-sdk/mediasoup-client/lib/RtpParameters';
import {
  ConnectionState,
  DtlsParameters,
  Transport,
} from '@skyway-sdk/mediasoup-client/lib/Transport';

import { errors } from '../../errors';
import { SfuBotMember } from '../../member';
import { SfuBotPluginOptions } from '../../option';
import { SfuBotPlugin } from '../../plugin';
import { createWarnPayload } from '../../util';

const log = new Logger(
  'packages/sfu-bot/src/connection/transport/transport.ts'
);

export class SfuTransport {
  private _backoffIceRestart = new BackOff({
    times: 8,
    interval: 100,
    jitter: 100,
  });
  private _connectionState: TransportConnectionState = 'new';
  private _options: SfuBotPluginOptions;

  readonly onProduce = new Event<{
    producerOptions: {
      kind: MediaKind;
      rtpParameters: RtpParameters;
      appData: any;
    };
    callback: (props: { id: string }) => void;
    errback: (err: any) => void;
  }>();
  readonly onProduceData = new Event<{
    producerOptions: DataProducerOptions;
    callback: (props: { id: string }) => void;
    errback: (err: any) => void;
  }>();
  readonly onMediasoupConnectionStateChanged = new Event<ConnectionState>();
  readonly onConnectionStateChanged = new Event<TransportConnectionState>();

  get pc(): RTCPeerConnection {
    return (this.msTransport as any)?._handler?._pc ?? {};
  }

  get id() {
    return this.msTransport.id;
  }

  get connectionState() {
    return this._connectionState;
  }

  constructor(
    public msTransport: Transport,
    private _bot: SfuBotMember,
    private _iceManager: IceManager,
    private _sfuApi: SfuRestApiClient,
    private _context: SkyWayContext,
    private _analyticsSession?: AnalyticsSession
  ) {
    const sfuPlugin = _context.plugins.find(
      (p) => p.subtype === SfuBotPlugin.subtype
    ) as SfuBotPlugin;
    this._options = sfuPlugin.options;

    log.debug('peerConfig', this.pc?.getConfiguration?.() ?? {});

    msTransport.on('connect', (params, callback, errback) =>
      this._onConnect(msTransport.id)(
        params as {
          dtlsParameters: DtlsParameters;
        },
        callback as any,
        errback!
      )
    );
    msTransport.on('connectionstatechange', (e) => {
      this.onMediasoupConnectionStateChanged.emit(e);

      if (this._analyticsSession && !this._analyticsSession.isClosed()) {
        // 再送時に他の処理をブロックしないためにawaitしない
        void this._analyticsSession.client.sendRtcPeerConnectionEventReport({
          rtcPeerConnectionId: this.id,
          type: 'connectionStateChange',
          data: {
            connectionState: e,
          },
          createdAt: Date.now(),
        });
      }
    });

    msTransport.on('produce', (producerOptions, callback, errback) => {
      this.onProduce.emit({
        producerOptions,
        callback: callback!,
        errback: errback!,
      });
    });
    msTransport.on('producedata', (producerOptions, callback, errback) => {
      this.onProduceData.emit({
        producerOptions,
        callback: callback!,
        errback: errback!,
      });
    });

    this.onMediasoupConnectionStateChanged.add(
      async (state: ConnectionState) => {
        createLogPayload({
          operationName: 'onMediasoupConnectionStateChanged',
          channel: this._bot.channel,
        })
          .then((debug) => {
            log.debug(debug, { state, transportId: this.id, bot: _bot });
          })
          .catch(() => {});

        switch (state) {
          case 'disconnected':
          case 'failed':
            {
              if (this._connectionState === 'reconnecting') {
                return;
              }
              const e = await this._waitForMsConnectionState(
                'connected',
                _context.config.rtcConfig.iceDisconnectBufferTimeout
              ).catch((e) => e as SkyWayError);
              if (
                e &&
                (this._connectionState as TransportConnectionState) !==
                  'reconnecting' &&
                _bot.options.disableRestartIce !== true
              ) {
                await this.restartIce();
              }
            }
            break;
          case 'connecting':
          case 'connected':
            this._setConnectionState(state);
            break;
          case 'closed':
            this._setConnectionState('disconnected');
            break;
        }
        log.debug('onMediasoupConnectionStateChanged', this);
      }
    );
  }

  toJSON() {
    return {
      id: this.id,
      direction: this.msTransport.direction,
      connectionState: this._connectionState,
    };
  }

  close() {
    log.debug('close', this.id);
    // suppress firefox [RTCPeerConnection is gone] Exception
    if ((this.pc as any)?.peerIdentity) {
      (this.pc as any).peerIdentity.catch(() => {});
    }
    this.msTransport.close();
    this._setConnectionState('disconnected');
  }

  private _setConnectionState(state: TransportConnectionState) {
    if (this._connectionState === state) {
      return;
    }
    log.debug('onConnectionStateChanged', this._connectionState, state, this);
    this._connectionState = state;
    this.onConnectionStateChanged.emit(state);
    if (this._analyticsSession && !this._analyticsSession.isClosed()) {
      void this._analyticsSession.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.id,
        type: 'skywayConnectionStateChange',
        data: {
          skywayConnectionState: state,
        },
        createdAt: Date.now(),
      });
    }
  }

  readonly restartIce = async () => {
    if (this._backoffIceRestart.exceeded) {
      log.error(
        '_iceRestartedCount exceeded',
        createError({
          operationName: 'SfuTransport.restartIce',
          context: this._context,
          info: errors.netWorkError,
          path: log.prefix,
        })
      );
      this._setConnectionState('disconnected');
      return;
    }
    log.warn(
      '[start] restartIce',
      createWarnPayload({
        bot: this._bot,
        detail: 'start restartIce',
        operationName: 'SfuTransport.restartIce',
        payload: { count: this._backoffIceRestart.count, transport: this },
      })
    );

    const checkNeedEnd = () => {
      if (this._bot.state === 'left') {
        log.debug('bot already left', this);
        this._setConnectionState('disconnected');

        log.warn(
          '[end] restartIce',
          createWarnPayload({
            bot: this._bot,
            detail: 'end restartIce',
            operationName: 'SfuTransport.restartIce',
            payload: { count: this._backoffIceRestart.count, transport: this },
          })
        );
        return true;
      }

      if (this.msTransport.connectionState === 'connected') {
        this._backoffIceRestart.reset();
        this._setConnectionState('connected');

        log.warn(
          '[end] restartIce',
          createWarnPayload({
            bot: this._bot,
            detail: 'end restartIce',
            operationName: 'SfuTransport.restartIce',
            payload: { count: this._backoffIceRestart.count, transport: this },
          })
        );

        if (this._analyticsSession && !this._analyticsSession.isClosed()) {
          // 再送時に他の処理をブロックしないためにawaitしない
          void this._analyticsSession.client.sendRtcPeerConnectionEventReport({
            rtcPeerConnectionId: this.id,
            type: 'restartIce',
            data: undefined,
            createdAt: Date.now(),
          });
        }
        return true;
      }
    };

    this._setConnectionState('reconnecting');

    await this._backoffIceRestart.wait();

    if (checkNeedEnd()) {
      return;
    }

    let e = await this._iceManager.updateIceParams().catch((e) => e as Error);
    if (e) {
      log.warn(
        'updateIceParams failed',
        createWarnPayload({
          operationName: 'SfuTransport.restartIce',
          detail: 'updateIceParams failed',
          bot: this._bot,
          payload: { transport: this },
        }),
        e
      );
      await this.restartIce();
      return;
    }
    await this.msTransport.updateIceServers({
      iceServers: this._iceManager.iceServers,
    });

    if (checkNeedEnd()) {
      return;
    }

    const iceParameters = await this._mediasoupRestartIce();

    e = await this._waitForMsConnectionState(
      'connected',
      this._context.config.rtcConfig.iceDisconnectBufferTimeout
    ).catch((e) => e);
    if (!e && checkNeedEnd()) {
      return iceParameters;
    }

    await this.restartIce();
  };

  /**@private */
  async _mediasoupRestartIce() {
    const iceParameters = await this._sfuApi
      .iceRestart({
        transportId: this.id,
      })
      .catch((e) => e as Error);
    if (iceParameters instanceof Error) {
      log.warn(
        'iceRestart failed',
        createWarnPayload({
          operationName: 'SfuTransport._mediasoupRestartIce',
          detail: 'iceRestart failed',
          bot: this._bot,
          payload: { transport: this },
        }),
        iceParameters
      );
      await this.restartIce();
      return;
    }
    await this.msTransport.restartIce({ iceParameters });
    return iceParameters;
  }

  private _waitForMsConnectionState = async (
    state: ConnectionState,
    /**ms */
    timeout = 10_000
  ) => {
    if (state === this.msTransport.connectionState) return;
    await this.onMediasoupConnectionStateChanged
      .watch(() => state === this.msTransport.connectionState, timeout)
      .catch((err) => {
        throw createError({
          operationName: 'SfuTransport._waitForMsConnectionState',
          context: this._context,
          info: { ...errors.timeout, detail: 'waitForConnectionState timeout' },
          error: err,
          path: log.prefix,
        });
      });
  };

  private _onConnect =
    (transportId: string) =>
    async (
      {
        dtlsParameters,
      }: {
        dtlsParameters: DtlsParameters;
      },
      callback: () => void,
      errback: (err: any) => void
    ) => {
      try {
        log.debug('[start] transport connect', { transportId });
        await this._sfuApi.connect({ transportId, dtlsParameters });
        log.debug('[end] transport connect', { transportId });
        callback();
      } catch (error) {
        log.error('[failed] transport connect', {
          error,
          transportId,
        });
        errback(error);
      }
    };
}
