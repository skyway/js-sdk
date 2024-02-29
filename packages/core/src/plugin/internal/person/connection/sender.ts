import {
  BackOff,
  Event,
  EventDisposer,
  Logger,
  PromiseQueue,
  SkyWayError,
} from '@skyway-sdk/common';
import isEqual from 'lodash/isEqual';
import * as sdpTransform from 'sdp-transform';
import { v4 } from 'uuid';

import { SkyWayContext } from '../../../../context';
import { errors } from '../../../../errors';
import { AnalyticsSession } from '../../../../external/analytics';
import { IceManager } from '../../../../external/ice';
import { SignalingSession } from '../../../../external/signaling';
import { Codec } from '../../../../media';
import {
  LocalAudioStream,
  LocalCustomVideoStream,
  LocalStream,
  LocalVideoStream,
} from '../../../../media/stream';
import { LocalPersonImpl } from '../../../../member/localPerson';
import { RemoteMember } from '../../../../member/remoteMember';
import { PublicationImpl } from '../../../../publication';
import {
  createError,
  createWarnPayload,
  getParameters,
  statsToArray,
} from '../../../../util';
import { TransportConnectionState } from '../../../interface';
import { isSafari } from '../util';
import { setEncodingParams } from '../util';
import { P2PMessage } from '.';
import { DataChannelNegotiationLabel } from './datachannel';
import { IceCandidateMessage, Peer } from './peer';
import { ReceiverAnswerMessage } from './receiver';

const log = new Logger(
  'packages/core/src/plugin/internal/person/connection/sender.ts'
);

export class Sender extends Peer {
  readonly id = v4();
  readonly onConnectionStateChanged = new Event<TransportConnectionState>();

  publications: { [publicationId: string]: PublicationImpl } = {};
  transceivers: { [publicationId: string]: RTCRtpTransceiver } = {};
  datachannels: { [publicationId: string]: RTCDataChannel } = {};
  private _pendingPublications: (PublicationImpl | string)[] = [];
  private _isNegotiating = false;
  private readonly promiseQueue = new PromiseQueue();
  private _disposer = new EventDisposer();
  private _ms = new MediaStream();
  private _backoffIceRestarted = new BackOff({
    times: 8,
    interval: 100,
    jitter: 100,
  });
  private _connectionState: TransportConnectionState = 'new';
  private _log = log.createBlock({
    localPersonId: this.localPerson.id,
    id: this.id,
  });
  private _unsubscribeStreamEnableChange: {
    [publicationId: string]: () => void;
  } = {};

  private _cleanupStreamCallbacks: {
    [streamId: string]: () => void;
  } = {};

  constructor(
    context: SkyWayContext,
    iceManager: IceManager,
    signaling: SignalingSession,
    analytics: AnalyticsSession | undefined,
    localPerson: LocalPersonImpl,
    endpoint: RemoteMember
  ) {
    super(
      context,
      iceManager,
      signaling,
      analytics,
      localPerson,
      endpoint,
      'sender'
    );
    this._log.debug('spawned');

    this.signaling.onMessage
      .add(async ({ src, data }) => {
        if (!(src.id === endpoint.id && src.name === endpoint.name)) return;

        const message = data as ReceiverAnswerMessage | IceCandidateMessage;

        switch (message.kind) {
          case 'receiverAnswerMessage':
            {
              this.promiseQueue
                .push(() => this._handleReceiverAnswer(message.payload))
                .catch((err) =>
                  this._log.error('handle receiverAnswerMessage', {
                    localPersonId: this.localPerson.id,
                    endpointId: this.endpoint.id,
                    err,
                  })
                );
            }
            break;
          case 'iceCandidateMessage':
            {
              const { role, candidate } = message.payload;
              if (role === 'receiver') {
                await this.handleCandidate(candidate);
              }
            }
            break;
        }
      })
      .disposer(this._disposer);

    this.onPeerConnectionStateChanged
      .add(async (state) => {
        try {
          log.debug('onPeerConnectionStateChanged', { state });
          switch (state) {
            case 'disconnected':
            case 'failed':
              {
                const e = await this.waitForConnectionState(
                  'connected',
                  context.config.rtcConfig.iceDisconnectBufferTimeout
                ).catch((e) => e as SkyWayError);
                if (e && this._connectionState !== 'reconnecting') {
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
        } catch (error) {
          log.error('onPeerConnectionStateChanged', error, this.id);
        }
      })
      .disposer(this._disposer);
  }

  private _setConnectionState(state: TransportConnectionState) {
    if (this._connectionState === state) {
      return;
    }
    this._log.debug(
      'onConnectionStateChanged',
      this.id,
      this._connectionState,
      state
    );
    this._connectionState = state;
    this.onConnectionStateChanged.emit(state);
  }

  /**@throws */
  readonly restartIce = async () => {
    if (this._backoffIceRestarted.exceeded) {
      this._log.error(
        createError({
          operationName: 'Sender.restartIce',
          context: this._context,
          channel: this.localPerson.channel,
          info: { ...errors.internal, detail: 'restartIce limit exceeded' },
          path: log.prefix,
        })
      );
      this._setConnectionState('disconnected');
      return;
    }
    this._log.warn(
      '[start] restartIce',
      createWarnPayload({
        operationName: 'Sender.restartIce',
        detail: 'start restartIce',
        channel: this.localPerson.channel,
        payload: { count: this._backoffIceRestarted.count },
      })
    );

    const checkNeedEnd = () => {
      if (this.endpoint.state === 'left') {
        this._log.warn(
          'endpointMemberLeft',
          createWarnPayload({
            operationName: 'restartIce',
            detail: 'endpointMemberLeft',
            channel: this.localPerson.channel,
            payload: { endpointId: this.endpoint.id },
          })
        );
        this._setConnectionState('disconnected');
        return true;
      }

      if ((this.pc.connectionState as RTCPeerConnectionState) === 'connected') {
        this._log.warn(
          '[end] restartIce',
          createWarnPayload({
            operationName: 'restartIce',
            detail: 'reconnected',
            channel: this.localPerson.channel,
            payload: { count: this._backoffIceRestarted.count },
          })
        );
        this._backoffIceRestarted.reset();
        this._setConnectionState('connected');

        if (
          this.localPerson._analytics &&
          !this.localPerson._analytics.isClosed()
        ) {
          // 再送時に他の処理をブロックしないためにawaitしない
          void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport(
            {
              rtcPeerConnectionId: this.id,
              type: 'restartIce',
              data: undefined,
              createdAt: Date.now(),
            }
          );
        }
        return true;
      }
    };

    this._setConnectionState('reconnecting');
    await this._backoffIceRestarted.wait();

    if (checkNeedEnd()) return;

    let e = await this._iceManager.updateIceParams().catch((e) => e as Error);
    if (e) {
      this._log.warn(
        '[failed] restartIce',
        createWarnPayload({
          operationName: 'restartIce',
          detail: 'update IceParams failed',
          channel: this.localPerson.channel,
          payload: { count: this._backoffIceRestarted.count },
        }),
        e
      );
      await this.restartIce();
      return;
    }
    if (this.pc.setConfiguration) {
      this.pc.setConfiguration({
        ...this.pc.getConfiguration(),
        iceServers: this._iceManager.iceServers,
      });
      this._log.debug('<restartIce> setConfiguration', {
        iceServers: this._iceManager.iceServers,
      });
    }

    if (checkNeedEnd()) return;

    if (this.signaling.connectionState !== 'connected') {
      this._log.warn(
        '<restartIce> reconnect signaling service',
        createWarnPayload({
          operationName: 'restartIce',
          detail: 'reconnect signaling service',
          channel: this.localPerson.channel,
          payload: { count: this._backoffIceRestarted.count },
        })
      );
      e = await this.signaling.onConnectionStateChanged
        .watch((s) => s === 'connected', 10_000)
        .catch((e) => e as SkyWayError)
        .then(() => {});

      if (e instanceof SkyWayError) {
        await this.restartIce();
        return;
      }

      if (checkNeedEnd()) return;
    }

    const offer = await this.pc.createOffer({ iceRestart: true });

    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'offer',
        data: {
          offer: JSON.stringify(offer),
        },
        createdAt: Date.now(),
      });
    }

    await this.pc.setLocalDescription(offer);

    const message: SenderRestartIceMessage = {
      kind: 'senderRestartIceMessage',
      payload: { sdp: this.pc.localDescription! },
    };
    e = await this.signaling
      .send(this.endpoint, message, 10_000)
      .catch((e) => e);
    if (e) {
      this._log.warn(
        '<restartIce> [failed]',
        createWarnPayload({
          operationName: 'restartIce',
          detail: 'timeout send signaling message',
          channel: this.localPerson.channel,
          payload: { count: this._backoffIceRestarted.count },
        }),
        e
      );
      await this.restartIce();
      return;
    }

    e = await this.waitForConnectionState(
      'connected',
      this._context.config.rtcConfig.iceDisconnectBufferTimeout
    ).catch((e) => e);
    if (!e) {
      if (checkNeedEnd()) return;
    }

    await this.restartIce();
  };

  get hasMedia() {
    const count = Object.keys(this.publications).length;
    this._log.debug('hasMedia', { count });
    if (count > 0) {
      return true;
    }
    return false;
  }

  private _getMid(
    publication: PublicationImpl,
    sdpObject: sdpTransform.SessionDescription
  ) {
    if (publication.contentType === 'data') {
      const media = sdpObject.media.find((m) => m.type === 'application');
      if (media?.mid == undefined) {
        throw createError({
          operationName: 'Sender._getMid',
          info: {
            ...errors.missingProperty,
            detail: 'datachannel mid undefined',
          },
          path: log.prefix,
          context: this._context,
          channel: this.localPerson.channel,
        });
      }
      return media.mid.toString();
    } else {
      const transceiver = this.transceivers[publication.id];
      const mid = transceiver.mid;
      if (mid == undefined) {
        throw createError({
          operationName: 'Sender._getMid',
          info: {
            ...errors.missingProperty,
            detail: 'media mid undefined',
          },
          path: log.prefix,
          context: this._context,
          channel: this.localPerson.channel,
        });
      }
      return mid.toString();
    }
  }

  private _listenStreamEnableChange(
    stream: LocalAudioStream | LocalVideoStream | LocalCustomVideoStream,
    publicationId: string
  ) {
    if (this._unsubscribeStreamEnableChange[publicationId]) {
      this._unsubscribeStreamEnableChange[publicationId]();
    }
    const { removeListener } = stream._onEnableChanged.add(async (track) => {
      await this._replaceTrack(publicationId, track).catch((e) => {
        log.warn(
          createWarnPayload({
            member: this.localPerson,
            detail: '_replaceTrack failed',
            operationName: 'Sender._listenStreamEnableChange',
            payload: e,
          })
        );
      });
    });
    this._unsubscribeStreamEnableChange[publicationId] = removeListener;
  }

  /**@throws {@link SkyWayError} */
  async add(publication: PublicationImpl) {
    if (this._isNegotiating || this.pc.signalingState !== 'stable') {
      this._pendingPublications.push(publication);
      this._log.debug('<add> isNegotiating', {
        publication,
        isNegotiating: this._isNegotiating,
        signalingState: this.pc.signalingState,
        pendingPublications: this._pendingPublications.length,
      });
      return;
    }
    this._isNegotiating = true;

    this._log.debug('<add> add publication', { publication });

    this.publications[publication.id] = publication;
    const stream = publication.stream;
    if (!stream) {
      throw createError({
        operationName: 'Sender.add',
        info: {
          ...errors.missingProperty,
          detail: '<add> stream not found',
        },
        path: log.prefix,
        context: this._context,
        channel: this.localPerson.channel,
      });
    }

    this._cleanupStreamCallbacks[stream.id] =
      this._setupTransportAccessForStream(stream);

    if (stream.contentType === 'data') {
      const dc = this.pc.createDataChannel(
        new DataChannelNegotiationLabel(publication.id, stream.id).toLabel(),
        stream.options
      );
      stream._onWriteData
        .add((data) => {
          if (dc.readyState === 'open') {
            dc.send(data as any);
          }
        })
        .disposer(this._disposer);

      this.datachannels[publication.id] = dc;
    } else {
      publication._onReplaceStream
        .add(async ({ newStream, oldStream }) => {
          newStream._replacingTrack = true;
          this._listenStreamEnableChange(
            newStream as LocalAudioStream,
            publication.id
          );
          if (this._cleanupStreamCallbacks[oldStream.id]) {
            this._cleanupStreamCallbacks[oldStream.id]();
          }
          this._cleanupStreamCallbacks[newStream.id] =
            this._setupTransportAccessForStream(newStream as LocalStream);
          await this._replaceTrack(publication.id, newStream.track);
          newStream._replacingTrack = false;
          newStream._onReplacingTrackDone.emit();
        })
        .disposer(this._disposer);
      this._listenStreamEnableChange(stream, publication.id);

      const transceiver = this.pc.addTransceiver(stream.track, {
        direction: 'sendonly',
        streams: [this._ms],
      });

      publication._onEncodingsChanged
        .add(async (encodings) => {
          await setEncodingParams(transceiver.sender, encodings).catch((e) => {
            this._log.error('_onEncodingsChanged failed', e);
          });
        })
        .disposer(this._disposer);
      this.transceivers[publication.id] = transceiver;
    }

    const offer = await this.pc.createOffer().catch((err) => {
      throw createError({
        operationName: 'Sender.add',
        info: {
          ...errors.internal,
          detail: "can't create offer",
        },
        path: log.prefix,
        context: this._context,
        channel: this.localPerson.channel,
        error: err,
      });
    });

    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'offer',
        data: {
          offer: JSON.stringify(offer),
        },
        createdAt: Date.now(),
      });
    }

    await this.pc.setLocalDescription(offer);
    const sdpObject = sdpTransform.parse(this.pc.localDescription!.sdp);
    this._log.debug('<add> create offer base', sdpObject);

    const mid = this._getMid(publication, sdpObject);

    if (publication.contentType !== 'data') {
      applyCodecCapabilities(
        publication.codecCapabilities ?? [],
        mid,
        sdpObject
      );
      const offerSdp = sdpTransform.write(sdpObject);
      await this.pc.setLocalDescription({ type: 'offer', sdp: offerSdp });
      this._log.debug('<add> create offer', this.pc.localDescription);

      if (publication.encodings?.length > 0) {
        if (isSafari()) {
          this._safariSetupEncoding(
            publication as PublicationImpl<LocalVideoStream>
          );
        } else {
          const transceiver = this.transceivers[publication.id];
          await setEncodingParams(transceiver.sender, [
            publication.encodings[0],
          ]);
        }
      }
    }

    const message: SenderProduceMessage = {
      kind: 'senderProduceMessage',
      payload: {
        sdp: this.pc.localDescription!,
        publicationId: publication.id,
        info: {
          publicationId: publication.id,
          streamId: stream.id,
          mid,
        },
      },
    };

    this._log.debug('[start] send message', message);
    await this.signaling.send(this.endpoint, message).catch((error) => {
      this._log.error('[failed] send message :', error, {
        localPersonId: this.localPerson.id,
        endpointId: this.endpoint.id,
      });
      throw error;
    });
    this._log.debug('[end] send message', message);
  }

  private _setupTransportAccessForStream(stream: LocalStream) {
    stream._getTransportCallbacks[this.endpoint.id] = () => ({
      rtcPeerConnection: this.pc,
      connectionState: this._connectionState,
    });
    stream._getStatsCallbacks[this.endpoint.id] = async () => {
      if (stream.contentType === 'data') {
        const stats = await this.pc.getStats();
        const arr = statsToArray(stats);
        return arr;
      }

      if (stream._replacingTrack) {
        await stream._onReplacingTrackDone.asPromise(200);
      }

      const stats = await this.pc.getStats(stream.track);
      const arr = statsToArray(stats);
      return arr;
    };

    // replaceStream時に古いstreamに紐づくcallbackを削除するため、戻り値としてcallback削除用の関数を返し、replaceStream時に呼び出す
    const cleanupCallbacks = () => {
      delete stream._getTransportCallbacks[this.endpoint.id];
      delete stream._getStatsCallbacks[this.endpoint.id];
    };

    this._disposer.push(() => {
      cleanupCallbacks();
    });
    this.onConnectionStateChanged
      .add((state) => {
        stream._setConnectionState(this.endpoint, state);
        if (
          this.localPerson._analytics &&
          !this.localPerson._analytics.isClosed()
        ) {
          void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport(
            {
              rtcPeerConnectionId: this.rtcPeerConnectionId,
              type: 'skywayConnectionStateChange',
              data: {
                skywayConnectionState: state,
              },
              createdAt: Date.now(),
            }
          );
        }
      })
      .disposer(this._disposer);

    return cleanupCallbacks;
  }

  /**@throws {SkyWayError} */
  async remove(publicationId: string) {
    const publication = this.publications[publicationId];
    if (!publication) {
      this._log.warn(
        '<remove> publication not found',
        createWarnPayload({
          operationName: 'Sender.remove',
          detail: 'publication already removed',
          channel: this.localPerson.channel,
          payload: { publicationId },
        })
      );
      return;
    }

    // 対向のConnectionがcloseされた際にanswerが帰ってこなくなり、
    // _isNegotiatingが永久にfalseにならなくなる。
    // この時点でpublicationを削除しないと、このConnectionのcloseIfNeedが
    // 正常に動作しなくなる
    delete this.publications[publicationId];

    if (this._isNegotiating || this.pc.signalingState !== 'stable') {
      this._pendingPublications.push(publicationId);
      this._log.debug('<remove> isNegotiating', {
        publicationId,
        _isNegotiating: this._isNegotiating,
        signalingState: this.pc.signalingState,
      });
      return;
    }
    this._isNegotiating = true;

    this._log.debug('<remove> [start]', { publicationId });

    const stream = publication.stream;
    if (!stream) {
      throw createError({
        operationName: 'Sender.remove',
        info: {
          ...errors.missingProperty,
          detail: '<remove> publication not have stream',
        },
        path: log.prefix,
        context: this._context,
        channel: this.localPerson.channel,
        payload: { publication },
      });
    }

    if (stream.contentType === 'data') {
      const dc = this.datachannels[publicationId];
      dc.close();
      delete this.datachannels[publicationId];
    } else {
      const transceiver = this.transceivers[publicationId];
      transceiver.stop();

      delete this.transceivers[publicationId];
    }

    const offer = await this.pc.createOffer().catch((err) => {
      throw createError({
        operationName: 'Sender.remove',
        info: {
          ...errors.internal,
          detail: "<remove> can't create offer",
        },
        path: log.prefix,
        context: this._context,
        channel: this.localPerson.channel,
        error: err,
      });
    });

    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'offer',
        data: {
          offer: JSON.stringify(offer),
        },
        createdAt: Date.now(),
      });
    }

    await this.pc.setLocalDescription(offer);

    const message: SenderUnproduceMessage = {
      kind: 'senderUnproduceMessage',
      payload: { sdp: this.pc.localDescription!, publicationId },
    };
    this._log.debug('<remove> send message', { message });
    await this.signaling.send(this.endpoint, message).catch((error) => {
      this._log.error('<remove> in remote error :', error, {
        localPersonId: this.localPerson.id,
        endpointId: this.endpoint.id,
      });
      throw error;
    });

    this._log.debug('<remove> [end]', { publicationId });
  }

  private async _replaceTrack(
    publicationId: string,
    track: MediaStreamTrack | null
  ) {
    const transceiver = this.transceivers[publicationId];
    if (!transceiver) {
      this._log.warn(
        "can't replace track, transceiver not found",
        createWarnPayload({
          operationName: 'Sender._replaceTrack',
          detail: 'transceiver already removed',
          channel: this.localPerson.channel,
          payload: { publicationId },
        })
      );
      return;
    }

    await transceiver.sender.replaceTrack(track).catch((e) => {
      throw createError({
        operationName: 'Sender._replaceTrack',
        context: this._context,
        info: errors.internal,
        error: e,
        path: log.prefix,
        channel: this.localPerson.channel,
      });
    });
  }

  private async _handleReceiverAnswer({
    sdp,
  }: ReceiverAnswerMessage['payload']) {
    if (this.pc.signalingState === 'closed') {
      return;
    }

    this._log.debug('<handleReceiverAnswer> [start]');

    await this.pc
      .setRemoteDescription(new RTCSessionDescription(sdp))
      .catch((err) => {
        const error = createError({
          operationName: 'Sender._handleReceiverAnswer',
          context: this._context,
          info: {
            ...errors.internal,
            detail: 'failed to setRemoteDescription',
          },
          path: log.prefix,
          payload: { sdp },
          channel: this.localPerson.channel,
          error: err,
        });
        this._log.error(error);
        throw error;
      });

    this._log.debug('<handleReceiverAnswer> sRD');
    await this.resolveCandidates();
    this._log.debug('<handleReceiverAnswer> resolveCandidates');
    await this.waitForSignalingState('stable');
    this._log.debug('<handleReceiverAnswer> waitForSignalingState');

    this._isNegotiating = false;
    await this._resolvePendingSender();
    this._log.debug(
      '<handleReceiverAnswer> _resolvePendingSender',
      this._pendingPublications.length
    );

    this._log.debug('<handleReceiverAnswer> [end]');
  }

  private _safariSetupEncoding(publication: PublicationImpl<LocalVideoStream>) {
    // 映像の送信が始まる前にEncodeの設定をするとEncodeの設定の更新ができなくなる
    const transceiver = this.transceivers[publication.id];

    const stream = publication.stream as LocalVideoStream;
    this.waitForStats({
      track: stream.track,
      cb: (stats) => {
        const outbound = stats.find(
          (s) =>
            s.id.includes('RTCOutboundRTP') || s.type.includes('outbound-rtp')
        );
        if (outbound?.keyFramesEncoded > 0) return true;
        return false;
      },
      interval: 10,
      timeout: this._context.config.rtcConfig.timeout,
    })
      .then(() => {
        log.debug('safari wait for stats resolved, setEncodingParams');
        setEncodingParams(transceiver.sender, [publication.encodings[0]]).catch(
          (e) => {
            this._log.error('setEncodingParams failed', e);
          }
        );
      })
      .catch((e) => {
        this._log.error('waitForStats', e);
      });
  }

  /**@throws {@link SkyWayError} */
  private async _resolvePendingSender() {
    const publication = this._pendingPublications.shift();
    if (!publication) return;

    this._log.debug('resolve pending sender', { publication });

    if (typeof publication === 'string') {
      await this.remove(publication);
    } else {
      await this.add(publication);
    }
  }

  close() {
    this._log.debug('closed');

    this.unSetPeerConnectionListener();
    Object.values(this._unsubscribeStreamEnableChange).forEach((f) => f());
    this.pc.close();
    this._setConnectionState('disconnected');

    this._disposer.dispose();
  }
}

export function applyCodecCapabilities(
  codecCapabilities: Codec[],
  mid: string,
  sdpObject: sdpTransform.SessionDescription
) {
  const media = sdpObject.media.find((m) => m.mid?.toString() === mid);
  if (!media) {
    throw createError({
      operationName: 'applyCodecCapabilities',
      info: {
        ...errors.notFound,
        detail: 'media not found',
      },
      path: log.prefix,
    });
  }

  // parametersをfmtp形式に変換
  codecCapabilities.forEach((cap) => {
    if (cap.parameters) {
      for (const [key, value] of Object.entries(cap.parameters ?? {})) {
        if (value === false || !cap.parameters[key]) {
          return;
        }
        if (key === 'usedtx' && value) {
          cap.parameters[key] = 1;
        }
      }
    }
  });

  /**codec名とparametersの一致するものを探す */
  const findCodecFromCodecCapability = (
    cap: Codec,
    rtp: sdpTransform.MediaAttributes['rtp'],
    fmtp: sdpTransform.MediaAttributes['fmtp']
  ): sdpTransform.MediaAttributes['rtp'][number] | undefined => {
    const rtpList = rtp.map((r) => ({
      ...r,
      parameters: getParameters(fmtp, r.payload),
    }));
    const codecName = mimeTypeToCodec(cap.mimeType);
    if (!codecName) {
      return undefined;
    }

    const matched =
      rtpList.find((r) => {
        if (r.codec.toLowerCase() !== codecName.toLowerCase()) {
          return false;
        }

        if (Object.keys(cap.parameters ?? {}).length === 0) {
          return true;
        }

        // audioはブラウザが勝手にfmtp configを足してくるので厳密にマッチさせる必要がない
        if (mimeTypeToContentType(cap.mimeType) === 'audio') {
          return true;
        }

        return isEqual(r.parameters, cap.parameters ?? {});
      }) ?? undefined;

    return matched;
  };

  const preferredCodecs = codecCapabilities
    .map((cap) => findCodecFromCodecCapability(cap, media.rtp, media.fmtp))
    .filter((v): v is NonNullable<typeof v> => v != undefined);

  const sorted = [
    ...preferredCodecs,
    ...media.rtp.filter(
      (rtp) => !preferredCodecs.find((p) => p.payload === rtp.payload)
    ),
  ];

  // apply codec fmtp
  for (const fmtp of media.fmtp) {
    const payloadType = fmtp.payload;
    const targetCodecWithPayload = sorted.find(
      (c) => c.payload === payloadType
    );

    if (targetCodecWithPayload) {
      const targetCodecCapability = codecCapabilities.find((c) =>
        findCodecFromCodecCapability(c, [targetCodecWithPayload], media.fmtp)
      );
      if (targetCodecCapability) {
        if (
          targetCodecCapability.parameters &&
          Object.keys(targetCodecCapability.parameters).length > 0
        ) {
          // codecCapabilitiesのfmtpを適用する
          fmtp.config = '';
          Object.entries(targetCodecCapability.parameters).forEach(
            ([key, value]) => {
              if (value === false || fmtp.config.includes(key)) {
                return;
              }
              if (fmtp.config.length > 0) {
                fmtp.config += `;${key}=${value}`;
              } else {
                fmtp.config = `${key}=${value}`;
              }
            }
          );
        }
      }
    }

    // opusDtxはデフォルトで有効に設定する
    const opus = sorted.find((rtp) => rtp.codec.toLowerCase() === 'opus');
    const opusDtx = codecCapabilities.find(
      (f) => mimeTypeToCodec(f.mimeType).toLowerCase() === 'opus'
    )?.parameters?.usedtx;
    if (
      opus &&
      opusDtx !== false &&
      fmtp.payload === opus.payload &&
      !fmtp.config.includes('usedtx')
    ) {
      if (fmtp.config.length > 0) {
        fmtp.config += ';usedtx=1';
      } else {
        fmtp.config = 'usedtx=1';
      }
    }
  }

  media.payloads = sorted.map((rtp) => rtp.payload.toString()).join(' ');
}

export interface SenderProduceMessage extends P2PMessage {
  kind: 'senderProduceMessage';
  payload: {
    sdp: RTCSessionDescriptionInit;
    publicationId: string;
    info: {
      publicationId: string;
      streamId: string;
      mid: string;
    };
  };
}

export interface SenderUnproduceMessage extends P2PMessage {
  kind: 'senderUnproduceMessage';
  payload: {
    sdp: RTCSessionDescriptionInit;
    publicationId: string;
  };
}

export interface SenderRestartIceMessage extends P2PMessage {
  kind: 'senderRestartIceMessage';
  payload: {
    sdp: RTCSessionDescriptionInit;
  };
}

const mimeTypeToCodec = (mimeType: string) => mimeType.split('/')[1];
const mimeTypeToContentType = (mimeType: string) => mimeType.split('/')[0];
