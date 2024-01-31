import { Event, Logger } from '@skyway-sdk/common';
import { uuidV4 } from '@skyway-sdk/token';

import { SkyWayContext } from '../../../../context';
import { errors } from '../../../../errors';
import { AnalyticsSession } from '../../../../external/analytics';
import { IceManager } from '../../../../external/ice';
import { SignalingSession } from '../../../../external/signaling';
import { LocalPersonImpl } from '../../../../member/localPerson';
import { RemoteMember } from '../../../../member/remoteMember';
import { createError, createWarnPayload } from '../../../../util';
import { statsToJson } from '../util';
import { P2PMessage } from '.';

const log = new Logger(
  'packages/core/src/plugin/internal/person/connection/peer.ts'
);

export abstract class Peer {
  private _pendingCandidates: RTCIceCandidate[] = [];
  readonly pc: RTCPeerConnection = new RTCPeerConnection({
    ...this._context.config.rtcConfig,
    iceTransportPolicy:
      this._context.config.rtcConfig.turnPolicy === 'turnOnly'
        ? 'relay'
        : undefined,
    iceServers: this._iceManager.iceServers,
  });
  readonly onSignalingStateChanged = new Event<RTCSignalingState>();
  readonly onPeerConnectionStateChanged = new Event<RTCPeerConnectionState>();
  readonly onDisconnect = new Event<void>();
  connected = false;
  disconnected = false;
  rtcPeerConnectionId = uuidV4();

  constructor(
    protected readonly _context: SkyWayContext,
    protected readonly _iceManager: IceManager,
    protected readonly signaling: SignalingSession,
    protected readonly analytics: AnalyticsSession | undefined,
    protected readonly localPerson: LocalPersonImpl,
    protected readonly endpoint: RemoteMember,
    readonly role: PeerRole
  ) {
    log.debug('peerConfig', this.pc.getConfiguration());

    this.setPeerConnectionListener();

    // suppress firefox [RTCPeerConnection is gone] Exception
    const peerIdentity = (this.pc as any)?.peerIdentity;
    if (peerIdentity) {
      peerIdentity.catch((err: any) => {
        log.debug('firefox peerIdentity', err);
      });
    }
  }

  private setPeerConnectionListener(): void {
    this.pc.onicecandidate = this._onICECandidate;
    this.pc.onicecandidateerror = this._onICECandidateError;
    this.pc.onicegatheringstatechange = this._onIceGatheringStateChange;
    this.pc.onconnectionstatechange = this._onConnectionStateChange;
    this.pc.oniceconnectionstatechange = this._onIceConnectionStateChange;
    this.pc.onsignalingstatechange = () => {
      void this._onSignalingStateChange();
      this.onSignalingStateChanged.emit(this.pc.signalingState);
    };
  }

  protected unSetPeerConnectionListener() {
    this.pc.onicecandidate = null;
    this.pc.onicecandidateerror = null;
    this.pc.onicegatheringstatechange = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;
  }

  private _onICECandidate = async (ev: RTCPeerConnectionIceEvent) => {
    if (
      ev.candidate == null ||
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore firefox
      ev.candidate === '' ||
      this.pc.connectionState === 'closed'
    ) {
      return;
    }

    const message: IceCandidateMessage = {
      kind: 'iceCandidateMessage',
      payload: {
        candidate: ev.candidate,
        role: this.role,
      },
    };

    log.debug('[start] send candidate', {
      message,
      localPerson: this.localPerson,
    });

    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'iceCandidate',
        data: {
          candidate: JSON.stringify(ev.candidate),
        },
        createdAt: Date.now(),
      });
    }

    try {
      await this.signaling.send(this.endpoint, message);
      log.debug(`[end] send candidate`, {
        message,
        localPerson: this.localPerson,
      });
    } catch (error) {
      log.warn(
        `[failed] send candidate`,
        createWarnPayload({
          operationName: 'Peer._onICECandidate',
          channel: this.localPerson.channel,
          detail: '[failed] send candidate',
          payload: { message },
        }),
        error
      );
    }
  };

  private _onICECandidateError = async (ev: globalThis.Event) => {
    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'iceCandidateError',
        data: {
          event: JSON.stringify(ev),
        },
        createdAt: Date.now(),
      });
    }
  };

  private _onIceGatheringStateChange = async (ev: globalThis.Event) => {
    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      const state = this.pc.iceGatheringState;
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'iceGatheringStateChange',
        data: {
          event: state,
        },
        createdAt: Date.now(),
      });
    }
  };

  private _onConnectionStateChange = async () => {
    const state = this.pc.connectionState;
    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'connectionStateChange',
        data: {
          connectionState: state,
        },
        createdAt: Date.now(),
      });
    }

    switch (state) {
      case 'connected':
        this.connected = true;
        this._pendingCandidates = [];
        break;
    }
    this.onPeerConnectionStateChanged.emit(this.pc.connectionState);
  };

  private _onIceConnectionStateChange = async () => {
    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      const state = this.pc.iceConnectionState;
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'iceConnectionStateChange',
        data: {
          iceConnectionState: state,
        },
        createdAt: Date.now(),
      });
    }
  };

  private _onSignalingStateChange = async () => {
    if (
      this.localPerson._analytics &&
      !this.localPerson._analytics.isClosed()
    ) {
      const state = this.pc.signalingState;
      // 再送時に他の処理をブロックしないためにawaitしない
      void this.localPerson._analytics.client.sendRtcPeerConnectionEventReport({
        rtcPeerConnectionId: this.rtcPeerConnectionId,
        type: 'signalingStateChange',
        data: {
          signalingState: state,
        },
        createdAt: Date.now(),
      });
    }
  };

  async handleCandidate(candidate: RTCIceCandidate) {
    this._pendingCandidates.push(candidate);
    if (this.pc.remoteDescription) {
      await this.resolveCandidates();
    }
  }

  async resolveCandidates() {
    const candidates = [...this._pendingCandidates];
    this._pendingCandidates = [];

    log.debug('addIceCandidates', candidates);

    await Promise.all(
      candidates.map((candidate) => {
        if (this.pc.signalingState === 'closed') return;

        this.pc.addIceCandidate(candidate).catch((err) => {
          log.warn(
            '[failed] add ice candidate',
            createWarnPayload({
              operationName: 'Peer.resolveCandidates',
              channel: this.localPerson.channel,
              detail: '[failed] send candidate',
              payload: { endpointId: this.endpoint.id },
            }),
            err
          );
        });
      })
    );
  }

  /**@throws {@link SkyWayError} */
  protected waitForSignalingState = async (
    state: RTCSignalingState,
    /**ms */
    timeout = 10_000
  ) => {
    if (this.pc.signalingState === state) return;
    await this.onSignalingStateChanged
      .watch(() => this.pc.signalingState === state, timeout)
      .catch((err) => {
        throw createError({
          operationName: 'Peer.waitForSignalingState',
          info: {
            ...errors.timeout,
            detail: 'waitForSignalingState timeout',
          },
          path: log.prefix,
          context: this._context,
          channel: this.localPerson.channel,
          error: err,
        });
      });
  };

  /**@throws {@link SkyWayError} */
  protected waitForConnectionState = async (
    state: RTCPeerConnectionState,
    /**ms */
    timeout = 10_000
  ) => {
    if (state === this.pc.connectionState) return;
    await this.onPeerConnectionStateChanged
      .watch(() => state === this.pc.connectionState, timeout)
      .catch((err) => {
        throw createError({
          operationName: 'Peer.waitForConnectionState',
          info: {
            ...errors.timeout,
            detail: 'waitForConnectionState timeout',
          },
          path: log.prefix,
          context: this._context,
          channel: this.localPerson.channel,
          error: err,
        });
      });
  };

  /**@throws {@link SkyWayError} */
  protected waitForStats = async ({
    track,
    cb,
    interval,
    timeout,
    logging,
  }: {
    track: MediaStreamTrack;
    cb: (stats: { id: string; type: string; [key: string]: any }[]) => boolean;
    /**ms */
    interval?: number;
    /**ms */
    timeout?: number;
    logging?: boolean;
  }) => {
    interval ??= 100;
    timeout ??= 10_000;

    for (let elapsed = 0; ; elapsed += interval) {
      if (elapsed >= timeout) {
        throw createError({
          operationName: 'Peer.waitForStats',
          info: {
            ...errors.timeout,
            detail: 'waitForStats timeout',
          },
          path: log.prefix,
          context: this._context,
          channel: this.localPerson.channel,
        });
      }

      const report = await this.pc.getStats(track);
      const stats = statsToJson(report);
      if (logging) {
        log.debug('Peer.waitForStats', stats);
      }
      if (cb(stats)) {
        break;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  };
}

export type PeerRole = 'sender' | 'receiver';

export interface IceCandidateMessage extends P2PMessage {
  kind: 'iceCandidateMessage';
  payload: { candidate: RTCIceCandidate; role: 'receiver' | 'sender' };
}
