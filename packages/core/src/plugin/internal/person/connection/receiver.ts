import {
  deepCopy,
  Event,
  EventDisposer,
  Logger,
  PromiseQueue,
  SkyWayError,
} from '@skyway-sdk/common';
import * as sdpTransform from 'sdp-transform';
import { v4 } from 'uuid';

import { SkyWayContext } from '../../../../context';
import { errors } from '../../../../errors';
import { AnalyticsSession } from '../../../../external/analytics';
import { IceManager } from '../../../../external/ice';
import { SignalingSession } from '../../../../external/signaling';
import { Codec } from '../../../../media';
import { RemoteStream } from '../../../../media/stream';
import { createRemoteStream } from '../../../../media/stream/remote/factory';
import { LocalPersonImpl } from '../../../../member/localPerson';
import { RemoteMember } from '../../../../member/remoteMember';
import { SubscriptionImpl } from '../../../../subscription';
import {
  createError,
  createWarnPayload,
  fmtpConfigParser,
  statsToArray,
} from '../../../../util';
import { TransportConnectionState } from '../../../interface';
import { convertConnectionState } from '../util';
import { P2PMessage } from '.';
import { DataChannelNegotiationLabel } from './datachannel';
import { IceCandidateMessage, Peer } from './peer';
import {
  SenderProduceMessage,
  SenderRestartIceMessage,
  SenderUnproduceMessage,
} from './sender';

const log = new Logger(
  'packages/core/src/plugin/internal/person/connection/receiver.ts'
);

export class Receiver extends Peer {
  readonly id = v4();
  readonly onConnectionStateChanged = new Event<TransportConnectionState>();
  readonly onStreamAdded = new Event<{
    publicationId: string;
    stream: RemoteStream;
  }>();
  readonly onError = new Event<SkyWayError>();

  private _connectionState: TransportConnectionState = 'new';
  private _publicationInfo: {
    [publicationId: string]: SenderProduceMessage['payload']['info'];
  } = {};
  streams: {
    [publicationId: string]: RemoteStream;
  } = {};
  private _subscriptions: { [subscriptionId: string]: SubscriptionImpl } = {};
  private readonly _promiseQueue = new PromiseQueue();
  private _disposer = new EventDisposer();
  private _log = log.createBlock({
    localPersonId: this.localPerson.id,
    id: this.id,
  });

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
      'receiver'
    );
    this._log.debug('spawned');

    this.signaling.onMessage
      .add(async ({ src, data }) => {
        if (!(src.id === endpoint.id && src.name === endpoint.name)) return;

        const message = data as
          | SenderProduceMessage
          | SenderUnproduceMessage
          | SenderRestartIceMessage
          | IceCandidateMessage;

        switch (message.kind) {
          case 'senderProduceMessage':
            {
              this._promiseQueue
                .push(() => this._handleSenderProduce(message.payload))
                .catch((err) =>
                  this._log.error('handle senderProduceMessage failed', err, {
                    localPersonId: this.localPerson.id,
                    endpointId: this.endpoint.id,
                  })
                );
            }
            break;
          case 'senderUnproduceMessage':
            {
              this._promiseQueue
                .push(() => this._handleSenderUnproduce(message.payload))
                .catch((err) =>
                  this._log.error('handle handleSenderUnproduce', err, {
                    localPersonId: this.localPerson.id,
                    endpointId: this.endpoint.id,
                  })
                );
            }
            break;
          case 'senderRestartIceMessage':
            {
              this._promiseQueue
                .push(() => this._handleSenderRestartIce(message.payload))
                .catch((err) =>
                  this._log.error('_handleSenderRestartIce', err, {
                    localPersonId: this.localPerson.id,
                    endpointId: this.endpoint.id,
                  })
                );
            }
            break;
          case 'iceCandidateMessage':
            {
              const { role, candidate } = message.payload;
              if (role === 'sender') {
                await this.handleCandidate(candidate);
              }
            }
            break;
        }
      })
      .disposer(this._disposer);

    this.pc.ontrack = async ({ track, transceiver }) => {
      if (!transceiver.mid) {
        throw createError({
          operationName: 'Receiver.pc.ontrack',
          info: {
            ...errors.missingProperty,
            detail: 'mid missing',
          },
          path: log.prefix,
          context: this._context,
          channel: this.localPerson.channel,
        });
      }

      const info = Object.values(this._publicationInfo).find(
        (i) => i.mid === transceiver.mid?.toString()
      );
      if (!info) {
        const error = createError({
          operationName: 'Receiver.pc.ontrack',
          info: { ...errors.notFound, detail: 'publicationInfo not found' },
          path: log.prefix,
          context: this._context,
          channel: localPerson.channel,
          payload: {
            endpointId: this.endpoint.id,
            publicationInfo: this._publicationInfo,
            mid: transceiver.mid,
          },
        });
        this.onError.emit(error);
        this._log.error(error);
        return;
      }

      const sdpObject = sdpTransform.parse(this.pc.remoteDescription!.sdp);
      const codec = this._getCodecFromSdp(sdpObject, transceiver, track.kind);

      const stream = createRemoteStream(info.streamId, track, codec);
      stream.codec = codec;
      this._setupTransportAccessForStream(stream);
      this.streams[info.publicationId] = stream;

      this._log.debug('MediaStreamTrack added', info, track, codec);

      this.onStreamAdded.emit({
        publicationId: info.publicationId,
        stream,
      });
    };

    this.pc.ondatachannel = async ({ channel }) => {
      const { publicationId, streamId } = DataChannelNegotiationLabel.fromLabel(
        channel.label
      );

      const codec = { mimeType: 'datachannel' };

      const stream = createRemoteStream(streamId, channel, codec);
      this._setupTransportAccessForStream(stream);
      this.streams[publicationId] = stream;

      this._log.debug('DataChannel added', publicationId, channel, codec);

      this.onStreamAdded.emit({
        publicationId,
        stream,
      });
    };

    this.onPeerConnectionStateChanged
      .add((state) => {
        switch (state) {
          case 'connecting':
          case 'connected':
            this._setConnectionState(state);
            break;
          case 'failed':
          case 'closed':
            this._setConnectionState('disconnected');
            break;
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

  private _setupTransportAccessForStream(stream: RemoteStream) {
    stream._getTransport = () => ({
      rtcPeerConnection: this.pc,
      connectionState: convertConnectionState(this.pc.connectionState),
    });
    stream._getStats = async () => {
      if (stream.contentType === 'data') {
        const stats = await this.pc.getStats();
        const arr = statsToArray(stats);
        return arr;
      }
      const stats = await this.pc.getStats(stream.track);
      const arr = statsToArray(stats);
      return arr;
    };
    this._disposer.push(() => {
      stream._getTransport = () => undefined;
    });
    this.onConnectionStateChanged
      .add((state) => {
        stream._setConnectionState(state);
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
  }

  private _getCodecFromSdp(
    sdpObject: sdpTransform.SessionDescription,
    transceiver: RTCRtpTransceiver,
    kind: string
  ): Codec {
    const media = sdpObject.media.find(
      // sdpTransformのmidは実際はnumber
      (m) => m.mid?.toString() === transceiver.mid?.toString()
    );
    if (!media) {
      throw createError({
        operationName: 'Receiver._getCodecFromSdp',
        info: {
          ...errors.notFound,
          detail: 'm-line not exist',
        },
        path: log.prefix,
        context: this._context,
        channel: this.localPerson.channel,
      });
    }
    const codecPT = media.payloads?.toString()!.split(' ')[0];

    const rtp = media.rtp.find((r) => r.payload.toString() === codecPT)!;
    const mimeType = `${kind}/${rtp.codec}`.toLowerCase();

    let parameters: { [key: string]: any } = {};
    const fmtp = media.fmtp.find((f) => f.payload.toString() === codecPT);
    if (fmtp?.config) {
      parameters = fmtpConfigParser(fmtp.config);
    }

    const codec = { mimeType, parameters };
    return codec;
  }

  get hasMedia() {
    const count = Object.values(this.streams).length;
    this._log.debug('hasMedia', { count });
    if (count > 0) {
      return true;
    }
    return false;
  }

  close() {
    this._log.debug('closed');

    this.unSetPeerConnectionListener();
    this.pc.close();
    this._setConnectionState('disconnected');

    this._disposer.dispose();
  }

  add(subscription: SubscriptionImpl) {
    this._subscriptions[subscription.id] = subscription;
  }

  remove(subscriptionId: string) {
    const subscription = this._subscriptions[subscriptionId];
    if (!subscription) return;
    delete this._subscriptions[subscription.id];

    const publicationId = subscription.publication.id;
    const stream = this.streams[publicationId];
    if (!stream) return;
    delete this.streams[publicationId];
  }

  /**@throws {SkyWayError} */
  private _validateRemoteOffer(sdp: string) {
    const sdpObject = sdpTransform.parse(sdp);
    this._log.debug('_validateRemoteOffer', { sdpObject });

    for (const sdpMediaLine of sdpObject.media) {
      if (sdpMediaLine.direction === 'inactive') {
        continue;
      }
      const exist = Object.values(this._publicationInfo).find(
        (info) => sdpMediaLine.mid?.toString() === info.mid
      );
      if (!exist) {
        const error = createError({
          operationName: 'Receiver._validateRemoteOffer',
          info: {
            ...errors.notFound,
            detail: 'mismatch between sdp and state',
          },
          path: log.prefix,
          context: this._context,
          channel: this.localPerson.channel,
          payload: {
            sdpMedia: sdpObject.media,
            sdpMediaLine,
            info: this._publicationInfo,
          },
        });
        this.onError.emit(error);
        throw error;
      }
    }
  }

  private get isWrongSignalingState() {
    return (
      (this.pc.signalingState === 'have-local-offer' &&
        this.pc.remoteDescription) ||
      this.pc.signalingState === 'have-remote-offer'
    );
  }

  /**@throws {SkyWayError} */
  private async _handleSenderProduce({
    sdp,
    publicationId,
    info,
  }: SenderProduceMessage['payload']) {
    if (this.pc.signalingState === 'closed') {
      return;
    }

    if (this.pc.signalingState !== 'stable') {
      if (this.isWrongSignalingState) {
        this._log.warn(
          '_handleSenderProduce wait for be stable',
          createWarnPayload({
            operationName: 'Receiver._handleSenderProduce',
            channel: this.localPerson.channel,
            detail: '_handleSenderProduce wait for be stable',
            payload: { signalingState: this.pc.signalingState },
          })
        );

        await this.waitForSignalingState('stable');
        await this._handleSenderProduce({
          sdp,
          publicationId,
          info,
        });
        return;
      }
      throw createError({
        operationName: 'Receiver._handleSenderProduce',
        context: this._context,
        channel: this.localPerson.channel,
        info: { ...errors.internal, detail: 'wrong signalingState' },
        payload: { signalingState: this.pc.signalingState },
        path: log.prefix,
      });
    }

    this._log.debug('_handleSenderProduce', {
      info,
      publicationId,
      publicationInfo: Object.values(this._publicationInfo),
    });
    this._publicationInfo[info.publicationId] = info;

    this._validateRemoteOffer(sdp.sdp!);

    await this.sendAnswer(sdp);
    await this.resolveCandidates();
  }

  /**@throws {SkyWayError} */
  private async _handleSenderUnproduce({
    sdp,
    publicationId,
  }: SenderUnproduceMessage['payload']) {
    if (this.pc.signalingState === 'closed') {
      this._log.warn(
        'signalingState closed',
        createWarnPayload({
          channel: this.localPerson.channel,
          detail: 'signalingState closed',
          operationName: 'Receiver._handleSenderUnproduce',
        })
      );
      return;
    }

    this._log.debug('<handleSenderUnproduce> start', { sdp, publicationId });

    if (this.pc.signalingState !== 'stable') {
      if (this.isWrongSignalingState) {
        this._log.warn(
          'signalingState is not stable',
          createWarnPayload({
            channel: this.localPerson.channel,
            detail: 'signalingState is not stable',
            operationName: 'Receiver._handleSenderUnproduce',
            payload: { signalingState: this.pc.signalingState },
          })
        );
        await this.waitForSignalingState('stable');
        await this._handleSenderUnproduce({
          sdp,
          publicationId,
        });
        return;
      }
      throw createError({
        operationName: 'Receiver._handleSenderProduce',
        context: this._context,
        channel: this.localPerson.channel,
        info: { ...errors.internal, detail: 'wrong signalingState' },
        payload: { signalingState: this.pc.signalingState },
        path: log.prefix,
      });
    }

    delete this._publicationInfo[publicationId];

    await this.sendAnswer(sdp);
    await this.resolveCandidates();

    this._log.debug('<handleSenderUnproduce> end', { publicationId });
  }

  /**@throws {SkyWayError} */
  private async _handleSenderRestartIce({
    sdp,
  }: SenderRestartIceMessage['payload']) {
    if (this.pc.signalingState === 'closed') {
      return;
    }

    if (this.pc.signalingState !== 'stable') {
      if (this.isWrongSignalingState) {
        this._log.warn(
          'signalingState is not stable',
          createWarnPayload({
            channel: this.localPerson.channel,
            detail: 'signalingState is not stable',
            operationName: 'Receiver._handleSenderRestartIce',
            payload: { signalingState: this.pc.signalingState },
          })
        );
        await this.waitForSignalingState('stable');
        await this._handleSenderRestartIce({ sdp });
        return;
      }
      throw createError({
        operationName: 'Receiver._handleSenderRestartIce',
        context: this._context,
        channel: this.localPerson.channel,
        info: { ...errors.internal, detail: 'wrong signalingState' },
        payload: { signalingState: this.pc.signalingState },
        path: log.prefix,
      });
    }

    this._setConnectionState('reconnecting');

    await this.sendAnswer(sdp);
    await this.resolveCandidates();

    if (this.pc.connectionState === 'connected') {
      this._setConnectionState('connected');
    }
  }

  private async sendAnswer(sdp: RTCSessionDescriptionInit) {
    this._log.debug(`[receiver] start: sendAnswer`);

    await this.pc.setRemoteDescription(sdp);
    const answer = await this.pc.createAnswer();

    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'answer',
        data: {
          answer: JSON.stringify(answer),
        },
        createdAt: Date.now(),
      });
    }

    const offerObject = sdpTransform.parse(this.pc.remoteDescription!.sdp);
    const answerObject = sdpTransform.parse(answer.sdp!);

    // fmtpの一部の設定(stereo)はremote側でも設定しないと効果を発揮しない
    offerObject.media.forEach((offerMedia, i) => {
      const answerMedia = answerObject.media[i];
      answerMedia.fmtp = deepCopy(answerMedia.fmtp).map((answerFmtp) => {
        const offerFmtp = offerMedia.fmtp.find(
          (f) => f.payload === answerFmtp.payload
        );
        if (offerFmtp) {
          return offerFmtp;
        }
        return answerFmtp;
      });
    });
    const munged = sdpTransform.write(answerObject);

    await this.pc.setLocalDescription({ type: 'answer', sdp: munged });

    const message: ReceiverAnswerMessage = {
      kind: 'receiverAnswerMessage',
      payload: { sdp: this.pc.localDescription! },
    };
    await this.signaling.send(this.endpoint, message).catch((e) =>
      this._log.error('failed to send answer', e, {
        localPersonId: this.localPerson.id,
        endpointId: this.endpoint.id,
      })
    );

    this._log.debug(`[receiver] end: sendAnswer`);
  }

  get subscriptions() {
    return this._subscriptions;
  }
}

export interface ReceiverAnswerMessage extends P2PMessage {
  kind: 'receiverAnswerMessage';
  payload: {
    sdp: RTCSessionDescriptionInit;
  };
}
