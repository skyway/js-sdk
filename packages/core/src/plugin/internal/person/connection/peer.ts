import { Event, Logger } from '@skyway-sdk/common';

import {
  createError,
  createWarnPayload,
  LocalPersonImpl,
  P2PMessage,
  RemoteMember,
  statsToJson,
} from '../../../..';
import { SkyWayContext } from '../../../../context';
import { errors } from '../../../../errors';
import { IceManager } from '../../../../external/ice';
import { SignalingSession } from '../../../../external/signaling';

const log = new Logger('src/core/dataPlane/peerConnection/peer.ts');

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

  constructor(
    protected readonly _context: SkyWayContext,
    protected readonly _iceManager: IceManager,
    protected readonly signaling: SignalingSession,
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
    this.pc.onconnectionstatechange = this._onConnectionStateChange;
    this.pc.onsignalingstatechange = () =>
      this.onSignalingStateChanged.emit(this.pc.signalingState);
  }

  protected unSetPeerConnectionListener() {
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
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

  private _onConnectionStateChange = async () => {
    const state = this.pc.connectionState;
    log.debug('_onConnectionStateChange', this.localPerson.id, state);

    switch (state) {
      case 'connected':
        this.connected = true;
        this._pendingCandidates = [];
        break;
    }
    this.onPeerConnectionStateChanged.emit(this.pc.connectionState);
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
  protected waitForStats = async (
    track: MediaStreamTrack,
    cb: (stats: any[]) => boolean,
    /**ms */
    interval = 100,
    /**ms */
    timeout = 10_000
  ) => {
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
