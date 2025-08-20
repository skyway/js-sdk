import { Event, EventDisposer, Logger } from '@skyway-sdk/common';
import {
  createError,
  createLogPayload,
  IceManager,
  isSafari,
  LocalAudioStream,
  LocalCustomVideoStream,
  LocalPersonImpl,
  LocalStream,
  LocalVideoStream,
  PublicationImpl,
  setEncodingParams,
  SkyWayChannelImpl,
  SkyWayContext,
  statsToArray,
  SubscriptionImpl,
  TransportConnectionState,
  uuidV4,
  waitForLocalStats,
} from '@skyway-sdk/core';
import { SfuRestApiClient } from '@skyway-sdk/sfu-api-client';
import isEqual from 'lodash/isEqual';
import { Producer, ProducerOptions } from '@skyway-sdk/mediasoup-client/lib/Producer';
import {
  RtpCodecCapability,
  RtpCodecParameters,
  RtpParameters,
} from '@skyway-sdk/mediasoup-client/lib/RtpParameters';

import { errors } from '../errors';
import { Forwarding, ForwardingConfigure } from '../forwarding';
import { SfuBotMember } from '../member';
import { createWarnPayload } from '../util';
import { SfuTransport } from './transport/transport';
import { TransportRepository } from './transport/transportRepository';

const log = new Logger('packages/sfu-bot/src/connection/sender.ts');

export class Sender {
  forwarding?: Forwarding;
  forwardingId?: string;
  private _producer?: Producer;
  /**@private */
  _broadcasterTransport?: SfuTransport;
  private _disposer = new EventDisposer();
  private _unsubscribeStreamEnableChange?: () => void;
  private _cleanupStreamCallbacks?: () => void;
  private _connectionState: TransportConnectionState = 'new';
  private readonly onConnectionStateChanged =
    new Event<TransportConnectionState>();
  closed = false;
  private sendSubscriptionStatsReportTimer: ReturnType<
    typeof setInterval
  > | null = null;
  private _waitingSendSubscriptionStatsReports: string[] = [];

  constructor(
    readonly publication: PublicationImpl<
      LocalAudioStream | LocalVideoStream | LocalCustomVideoStream
    >,
    readonly channel: SkyWayChannelImpl,
    private readonly _api: SfuRestApiClient,
    private _transportRepository: TransportRepository,
    private _localPerson: LocalPersonImpl,
    private _bot: SfuBotMember,
    private _iceManager: IceManager,
    private _context: SkyWayContext
  ) {
    const analyticsSession = this._localPerson._analytics;
    if (analyticsSession) {
      // AnalyticsServerに初回接続できなかった場合のタイマー再セット処理
      analyticsSession.onConnectionStateChanged.add((state) => {
        if (
          state === 'connected' &&
          this._waitingSendSubscriptionStatsReports.length > 0
        ) {
          for (const producerId of this._waitingSendSubscriptionStatsReports) {
            if (this._producer && this._producer.id === producerId) {
              this.startSendSubscriptionStatsReportTimer();
            }
          }
          this._waitingSendSubscriptionStatsReports = [];
        }
      });
    }
  }

  private _setConnectionState(state: TransportConnectionState) {
    if (this._connectionState === state) {
      return;
    }
    log.debug('_setConnectionState', {
      state,
      forwardingId: this.forwardingId,
    });
    this._connectionState = state;
    this.onConnectionStateChanged.emit(state);
  }

  toJSON() {
    return {
      forwarding: this.forwarding,
      broadcasterTransport: this._broadcasterTransport,
      _connectionState: this._connectionState,
    };
  }

  /**@throws {SkyWayError} */
  async startForwarding(configure: ForwardingConfigure) {
    if (this.publication.contentType === 'data') {
      throw createError({
        operationName: 'Sender.startForwarding',
        context: this._context,
        info: errors.dataStreamNotSupported,
        path: log.prefix,
        channel: this.channel,
      });
    }

    const stream = this.publication.stream;
    if (!stream) {
      throw createError({
        operationName: 'Sender.startForwarding',
        context: this._context,
        info: errors.streamNotExistInPublication,
        path: log.prefix,
        channel: this.channel,
      });
    }
    this.onConnectionStateChanged
      .add((state) => {
        log.debug(
          'transport connection state changed',
          this._broadcasterTransport?.id,
          state
        );
        stream._setConnectionState(this._bot, state);
      })
      .disposer(this._disposer);

    log.debug('[start] Sender startForwarding', {
      botId: this._bot.id,
      publicationId: this.publication.id,
      contentType: this.publication.contentType,
      maxSubscribers: configure.maxSubscribers,
    });

    const {
      forwardingId,
      broadcasterTransportId,
      // optional
      broadcasterTransportOptions,
      rtpCapabilities,
      identifierKey,
    } = await this._api.startForwarding({
      botId: this._bot.id,
      publicationId: this.publication.id,
      contentType: this.publication.contentType,
      maxSubscribers: configure.maxSubscribers,
      publisherId: this.publication.publisher.id,
    });
    this.forwardingId = forwardingId;

    if (broadcasterTransportOptions) {
      log.debug('sender create new transport', {
        broadcasterTransportOptions,
      });
      await this._transportRepository.loadDevice(rtpCapabilities!);

      this._broadcasterTransport = this._transportRepository.createTransport(
        this._localPerson.id,
        this._bot,
        broadcasterTransportOptions,
        'send',
        this._iceManager,
        this._localPerson._analytics
      );
    }

    this._broadcasterTransport = this._transportRepository.getTransport(
      this._localPerson.id,
      broadcasterTransportId
    );
    if (!this._broadcasterTransport) {
      throw createError({
        operationName: 'Sender.startForwarding',
        context: this._context,
        info: { ...errors.internal, detail: '_broadcasterTransport not found' },
        path: log.prefix,
        channel: this.channel,
        payload: { broadcasterTransportOptions },
      });
    }

    this._broadcasterTransport.onConnectionStateChanged
      .add((state) => {
        this._setConnectionState(state);
      })
      .disposer(this._disposer);
    this._setConnectionState(this._broadcasterTransport.connectionState);

    const producer = await this._produce(stream, this._broadcasterTransport);
    this._cleanupStreamCallbacks = this._setupTransportAccessForStream(
      stream,
      this._broadcasterTransport,
      producer
    );

    const analyticsSession = this._localPerson._analytics;
    if (analyticsSession && !analyticsSession.isClosed()) {
      if (analyticsSession.client.isConnectionEstablished()) {
        this.startSendSubscriptionStatsReportTimer();
      } else {
        // AnalyticsServerに初回接続できなかった場合はキューに入れる
        this._waitingSendSubscriptionStatsReports.push(producer.id);
      }
    }

    log.debug('[end] Sender startForwarding', {
      forwardingId,
    });

    let relayingPublication = this.channel._getPublication(forwardingId);
    if (!relayingPublication) {
      relayingPublication = (
        await this.channel.onStreamPublished
          .watch(
            (e) => e.publication.id === forwardingId,
            this._context.config.rtcApi.timeout
          )
          .catch(() => {
            throw createError({
              operationName: 'Sender.startForwarding',
              context: this._context,
              info: {
                ...errors.timeout,
                detail: 'SfuBotMember onStreamPublished',
              },
              path: log.prefix,
              channel: this.channel,
              payload: { forwardingId },
            });
          })
      ).publication as PublicationImpl<LocalStream>;
    }

    const forwarding = new Forwarding({
      configure,
      originPublication: this.publication,
      relayingPublication,
      api: this._api,
      context: this._context,
      identifierKey,
    });
    this.forwarding = forwarding;

    const botSubscribing = this.channel.subscriptions.find(
      (s) => s.publication.id === this.publication.id
    ) as SubscriptionImpl;
    const [codec] = producer.rtpParameters.codecs;
    botSubscribing.codec = codec;

    if (
      this._localPerson._analytics &&
      this._localPerson._analytics.client.connectionState !== 'closed'
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this._localPerson._analytics.client.sendBindingRtcPeerConnectionToSubscription(
        {
          subscriptionId: botSubscribing.id,
          role: 'sender',
          rtcPeerConnectionId: this._broadcasterTransport.id,
        }
      );
    }

    if (isSafari()) {
      waitForLocalStats({
        stream,
        remoteMember: this._bot.id,
        end: (stats) => {
          const outbound = stats.find(
            (s) =>
              s.id.includes('RTCOutboundRTP') || s.type.includes('outbound-rtp')
          );
          if (outbound?.keyFramesEncoded > 0) return true;
          return false;
        },
        interval: 10,
      })
        .then(async () => {
          const encodings = this.publication.encodings;

          if (encodings?.length > 0) {
            await setEncodingParams(producer.rtpSender!, encodings).catch(
              (e) => {
                log.error('_onEncodingsChanged failed', e, this);
              }
            );
          }
        })
        .catch((err) => {
          log.error('setEncodingParams waitForLocalStats failed', err, this);
        });
    }

    waitForLocalStats({
      stream,
      remoteMember: this._bot.id,
      end: (stats) => !!stats.find((s) => s.type.includes('local-candidate')),
    })
      .then(async () => {
        const payload = await createLogPayload({
          operationName: 'startForwarding/waitForLocalStats',
          channel: this.channel,
        });
        log.debug(payload, 'forwarding connection connected', {
          broadcasterTransportId,
        });
      })
      .catch(() => {});

    return forwarding;
  }

  private _listenStreamEnableChange(
    stream: LocalAudioStream | LocalVideoStream | LocalCustomVideoStream
  ) {
    if (this._unsubscribeStreamEnableChange) {
      this._unsubscribeStreamEnableChange();
    }
    const { removeListener } = stream._onEnableChanged.add(async (track) => {
      await this._replaceTrack(track).catch((e) => {
        log.warn(
          createWarnPayload({
            detail: 'replaceTrack failed',
            operationName: 'Sender._listenStreamEnableChange',
            bot: this._bot,
            payload: e,
          })
        );
      });
    });
    this._unsubscribeStreamEnableChange = removeListener;
  }

  private async _produce(
    stream: LocalAudioStream | LocalVideoStream | LocalCustomVideoStream,
    transport: SfuTransport
  ) {
    this.publication._onReplaceStream
      .add(async ({ newStream }) => {
        if (!this._broadcasterTransport) {
          throw createError({
            operationName: 'Sender._produce',
            context: this._context,
            info: {
              ...errors.internal,
              detail: '_broadcasterTransport not found',
            },
            path: log.prefix,
            channel: this.channel,
          });
        }
        this._listenStreamEnableChange(newStream as LocalAudioStream);
        if (this._cleanupStreamCallbacks) {
          this._cleanupStreamCallbacks();
        }
        this._cleanupStreamCallbacks = this._setupTransportAccessForStream(
          newStream as LocalStream,
          this._broadcasterTransport,
          producer
        );
        await this._replaceTrack(newStream.track);
      })
      .disposer(this._disposer);
    this._listenStreamEnableChange(stream);

    const transactionId = uuidV4();
    const producerOptions: ProducerOptions = {
      track: stream.track,
      // mediasoup-clientはデフォルトでunproduce時にtrack.stopを実行する
      stopTracks: false,
      appData: { transactionId },
      // デフォルトで一度mutedなTrackをProduceするとreplaceTrackしたTrackがDisableされる
      disableTrackOnPause: false,
    };

    const encodings = this.publication.encodings;
    if (encodings) {
      producerOptions.encodings = encodings;
    }
    this.publication._onEncodingsChanged
      .add(async (encodings) => {
        await setEncodingParams(producer.rtpSender!, encodings).catch((e) => {
          log.error('_onEncodingsChanged failed', e, this);
        });
      })
      .disposer(this._disposer);

    const codecCapabilities = this.publication.codecCapabilities;
    const deviceCodecs =
      this._transportRepository.rtpCapabilities?.codecs ?? [];
    log.debug('select codec', { codecCapabilities, deviceCodecs });

    const [codec] = codecCapabilities.map((cap) => {
      if (cap.mimeType.toLowerCase().includes('video')) {
        const codec = deviceCodecs.find((c) => {
          if (c.mimeType.toLowerCase() !== cap.mimeType.toLowerCase()) {
            return false;
          }
          if (
            Object.keys(cap.parameters ?? {}).length > 0 &&
            !isEqual(cap.parameters, c.parameters)
          ) {
            return false;
          }
          return true;
        });
        return codec;
      }
      const codec = deviceCodecs.find(
        (c) => c.mimeType.toLowerCase() === cap.mimeType.toLowerCase()
      );
      return codec;
    });
    log.debug('selected codec', { codec });

    if (codec) {
      const [codecType, codecName] = codec.mimeType.split('/');
      producerOptions.codec = {
        ...codec,
        mimeType: `${codecType}/${codecName.toUpperCase()}`,
      };

      if (stream.contentType === 'video') {
        this._fixVideoCodecWithParametersOrder(codec);
      }
    } else if (codecCapabilities.length > 0) {
      log.warn(
        'preferred codec not supported',
        createWarnPayload({
          channel: this.channel,
          detail: 'preferred codec not supported',
          operationName: 'Sender._produce',
          bot: this._bot,
          payload: {
            codecCapabilities,
            deviceCodecs,
          },
        })
      );
    }

    if (stream.contentType === 'audio') {
      // apply opusDtx
      const opusDtx = codecCapabilities.find(
        (c) => c.mimeType.toLowerCase() === 'audio/opus'
      )?.parameters?.usedtx;
      if (opusDtx !== false) {
        producerOptions.codecOptions = {
          ...producerOptions.codecOptions,
          opusDtx: true,
        };
      }

      // apply opusStereo
      const opusStereo = codecCapabilities.find(
        (c) => c.mimeType.toLowerCase() === 'audio/opus'
      )?.parameters?.stereo;
      if (opusStereo) {
        producerOptions.codecOptions = {
          ...producerOptions.codecOptions,
          opusStereo: true,
        };
      }

      // apply opusFec
      const opusFec = codecCapabilities.find(
        (c) => c.mimeType.toLowerCase() === 'audio/opus'
      )?.parameters?.useinbandfec;
      if (opusFec) {
        producerOptions.codecOptions = {
          ...producerOptions.codecOptions,
          opusFec: true,
        };
      }
    }

    transport.onProduce
      .watch(
        (p) => p.producerOptions.appData?.transactionId === transactionId,
        this._context.config.rtcConfig.timeout
      )
      .then(async (producer) => {
        try {
          const { producerId } = await this._api.createProducer({
            botId: this._bot.id,
            transportId: transport.id,
            forwardingId: this.forwardingId!,
            producerOptions: producer.producerOptions,
          });

          producer.callback({ id: producerId });
        } catch (error) {
          producer.errback(error);
        }
      })
      .catch((e) => {
        log.error('onProduce failed', e, this);
      });
    log.debug('[start] msTransport.produce', this);
    const producer = await transport.msTransport
      .produce(producerOptions)
      .catch((err) => {
        throw createError({
          operationName: 'Sender._produce',
          context: this._context,
          info: { ...errors.internal, detail: 'msTransport.produce failed' },
          path: log.prefix,
          channel: this.channel,
          error: err,
        });
      });
    log.debug('[end] msTransport.produce', this);
    this._producer = producer;

    return producer;
  }

  /** @description 引数のParametersを持ったCodecを優先度配列の先頭に持ってくる
   *  @description H264対応のため
   */
  private _fixVideoCodecWithParametersOrder(codec: RtpCodecCapability) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    const handler = this._broadcasterTransport!.msTransport._handler;

    const findCodecWithParameters = (c: RtpCodecParameters) => {
      if (c.mimeType === codec.mimeType) {
        if (codec.parameters && Object.keys(codec.parameters).length > 0) {
          if (isEqual(c.parameters, codec.parameters)) {
            return true;
          }
          return false;
        }
        return true;
      }
      return false;
    };

    const copyCodecExceptPayloadType = (
      target: RtpCodecParameters,
      src: RtpCodecParameters
    ) => {
      for (const key of Object.keys(target)) {
        if (key === 'payloadType') {
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        target[key] = src[key];
      }
    };

    if (handler._sendingRtpParametersByKind) {
      const parameters: RtpParameters =
        handler._sendingRtpParametersByKind['video'];
      const target = parameters.codecs.find(findCodecWithParameters);

      if (parameters && target) {
        const origin = JSON.parse(JSON.stringify(parameters));
        const [head] = parameters.codecs;
        const copyOfHead = JSON.parse(JSON.stringify(head));

        // 目的のRtpCodecParametersと先頭のRtpCodecParametersを入れ替える
        copyCodecExceptPayloadType(head, target);
        copyCodecExceptPayloadType(target, copyOfHead);

        log.debug('sort _sendingRtpParametersByKind', {
          origin,
          new: parameters.codecs,
        });
      }
    }
    if (handler._sendingRemoteRtpParametersByKind) {
      const parameters: RtpParameters =
        handler._sendingRemoteRtpParametersByKind['video'];
      const target = parameters.codecs.find(findCodecWithParameters);

      if (parameters && target) {
        const origin = JSON.parse(JSON.stringify(parameters));
        const [head] = parameters.codecs;
        const copyOfHead = JSON.parse(JSON.stringify(head));

        // 目的のRtpCodecParametersと先頭のRtpCodecParametersを入れ替える
        copyCodecExceptPayloadType(head, target);
        copyCodecExceptPayloadType(target, copyOfHead);

        log.debug('sort _sendingRemoteRtpParametersByKind', {
          origin,
          new: parameters.codecs,
        });
      }
    }
  }

  private _setupTransportAccessForStream(
    stream: LocalStream,
    transport: SfuTransport,
    producer: Producer
  ) {
    stream._getTransportCallbacks[this._bot.id] = () => ({
      rtcPeerConnection: transport.pc,
      connectionState: transport.connectionState,
      info: this,
    });
    stream._getStatsCallbacks[this._bot.id] = async () => {
      if (producer.closed) {
        delete stream._getStatsCallbacks[this._bot.id];
        return [];
      }
      const stats = await producer.getStats();
      let arr = statsToArray(stats);
      arr = arr.map((stats) => {
        stats['sfuTransportId'] = transport.id;
        return stats;
      });
      return arr;
    };

    // replaceStream時に古いstreamに紐づくcallbackを削除するため、戻り値としてcallback削除用の関数を返し、replaceStream時に呼び出す
    const cleanupCallbacks = () => {
      delete stream._getTransportCallbacks[this._bot.id];
      delete stream._getStatsCallbacks[this._bot.id];
    };

    this._disposer.push(() => {
      cleanupCallbacks();
    });

    return cleanupCallbacks;
  }

  unproduce() {
    if (!this._producer) {
      return;
    }

    this._producer.close();
    this._producer = undefined;

    if (this.sendSubscriptionStatsReportTimer) {
      clearInterval(this.sendSubscriptionStatsReportTimer);
    }
  }

  private async _replaceTrack(track: MediaStreamTrack | null) {
    await this._producer?.replaceTrack?.({ track }).catch((e) => {
      throw createError({
        operationName: 'Sender._replaceTrack',
        context: this._context,
        info: errors.internal,
        error: e,
        path: log.prefix,
        channel: this.channel,
      });
    });
  }

  close() {
    this.closed = true;
    if (this._unsubscribeStreamEnableChange) {
      this._unsubscribeStreamEnableChange();
    }
    this._setConnectionState('disconnected');

    this._disposer.dispose();
  }

  get pc() {
    return this._broadcasterTransport?.pc;
  }

  private startSendSubscriptionStatsReportTimer() {
    const analyticsSession = this._localPerson._analytics;
    const subscription = this._bot.subscriptions.find(
      (s) => s.publication.id === this.publication.id
    );
    if (subscription && analyticsSession) {
      const intervalSec = analyticsSession.client.getIntervalSec();
      this.sendSubscriptionStatsReportTimer = setInterval(async () => {
        // AnalyticsSessionがcloseされていたらタイマーを止める
        if (!analyticsSession || analyticsSession.isClosed()) {
          if (this.sendSubscriptionStatsReportTimer) {
            clearInterval(this.sendSubscriptionStatsReportTimer);
          }
          return;
        }
        if (this._producer) {
          const stats = await this._producer.getStats();
          if (stats) {
            // 再送時に他の処理をブロックしないためにawaitしない
            void analyticsSession.client.sendSubscriptionStatsReport(stats, {
              subscriptionId: subscription.id,
              role: 'sender',
              contentType: this.publication.contentType,
              createdAt: Date.now(),
            });
          }
        }
      }, intervalSec * 1000);
    }
  }
}
