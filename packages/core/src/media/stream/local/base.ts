import { Event } from '@skyway-sdk/common';
import { uuidV4 } from '@skyway-sdk/token';

import { Member } from '../../../member';
import { RemoteMember } from '../../../member/remoteMember';
import { Transport, TransportConnectionState } from '../../../plugin/interface';
import { Stream, WebRTCStats, ContentType } from '../base';

export abstract class LocalStreamBase implements Stream {
  readonly side = 'local';
  /**
   * @description [japanese] メディア通信の状態が変化した時に発火するイベント
   */
  readonly onConnectionStateChanged = new Event<{
    remoteMember: RemoteMember;
    state: TransportConnectionState;
  }>();
  readonly id: string = uuidV4();
  /**@internal */
  _label = '';
  published = false;

  /**@private */
  _getTransportCallbacks: {
    [remoteMemberId: string]: () => Transport;
  } = {};
  /**@private */
  _getStatsCallbacks: {
    [remoteMemberId: string]: () => Promise<WebRTCStats>;
  } = {};

  /**@internal */
  constructor(readonly contentType: ContentType) {}

  /**@internal */
  _setLabel(label: string) {
    this._label = label;
  }

  /**@internal */
  _unpublished() {
    this.published = false;
    this._getTransportCallbacks = {};
    this._getStatsCallbacks = {};
  }

  /**@internal */
  _getTransport(selector: Member | string): Transport | undefined {
    const id = typeof selector === 'string' ? selector : selector.id;
    return this._getTransportCallbacks[id]?.();
  }

  /**
   * @deprecated
   * @use Publication.getStats
   */
  getStats(selector: Member | string): Promise<WebRTCStats> {
    return this._getStats(selector);
  }

  /**@internal */
  _getStats(selector: Member | string): Promise<WebRTCStats> {
    const id = typeof selector === 'string' ? selector : selector.id;
    return this._getStatsCallbacks[id]?.() ?? [];
  }

  /**@internal */
  _getStatsAll() {
    return Promise.all(
      Object.entries(this._getStatsCallbacks).map(async ([key, cb]) => ({
        memberId: key,
        stats: await cb().catch(() => []),
      }))
    );
  }

  /**
   * @deprecated
   * @use Publication.getRTCPeerConnection
   */
  getRTCPeerConnection(
    selector: Member | string
  ): RTCPeerConnection | undefined {
    return this._getRTCPeerConnection(selector);
  }

  /**@internal */
  _getRTCPeerConnection(
    selector: Member | string
  ): RTCPeerConnection | undefined {
    return this._getTransport(selector)?.rtcPeerConnection;
  }

  /**
   * @deprecated
   * @use Publication.getConnectionState
   */
  getConnectionState(selector: Member | string): TransportConnectionState {
    return this._getConnectionState(selector);
  }

  /**@internal */
  _getConnectionState(selector: Member | string): TransportConnectionState {
    return this._getTransport(selector)?.connectionState ?? 'new';
  }

  /**@internal */
  _getConnectionStateAll() {
    return Object.entries(this._getTransportCallbacks).map(
      ([memberId, cb]) => ({ memberId, connectionState: cb().connectionState })
    );
  }

  /**@internal */
  toJSON() {
    return {
      label: this._label,
      contentType: this.contentType,
      id: this.id,
      side: this.side,
    };
  }
}
