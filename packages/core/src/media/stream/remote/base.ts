import { Event } from '@skyway-sdk/common';

import type { Codec } from '../../../media';
import { Transport, TransportConnectionState } from '../../../plugin/interface';
import { ContentType, Stream, WebRTCStats } from '../base';

export abstract class RemoteStreamBase implements Stream {
  readonly side = 'remote';
  /**
   * @deprecated
   * @use Subscription.onConnectionStateChanged
   * @description [japanese] メディア通信の状態が変化した時に発火するイベント
   */
  readonly onConnectionStateChanged = new Event<TransportConnectionState>();
  /**@internal */
  readonly _onConnectionStateChanged = new Event<TransportConnectionState>();
  codec!: Codec;
  private _connectionState: TransportConnectionState = 'new';

  /**@internal */
  constructor(readonly id: string, readonly contentType: ContentType) {
    this._onConnectionStateChanged.pipe(this.onConnectionStateChanged);
  }

  /**@internal */
  _setConnectionState(state: TransportConnectionState) {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this._onConnectionStateChanged.emit(state);
  }

  /**@internal */
  _getTransport: () => Transport | undefined = () => undefined;
  /**
   * @deprecated
   * @use Subscription.getStats
   */
  readonly getStats = () => {
    return this._getStats();
  };
  /**@internal */
  _getStats: () => Promise<WebRTCStats> = async () => [] as WebRTCStats;
  /**
   * @deprecated
   * @use Subscription.getRTCPeerConnection
   */
  getRTCPeerConnection() {
    return this._getRTCPeerConnection();
  }
  /**@internal */
  _getRTCPeerConnection() {
    return this._getTransport()?.rtcPeerConnection;
  }
  /**
   * @deprecated
   * @use Subscription.getConnectionState
   */
  getConnectionState() {
    return this._getConnectionState();
  }
  /**@internal */
  _getConnectionState() {
    return this._connectionState;
  }

  /**@internal */
  toJSON() {
    return {
      contentType: this.contentType,
      id: this.id,
      codec: this.codec,
      side: this.side,
    };
  }
}
