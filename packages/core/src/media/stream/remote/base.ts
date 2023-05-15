import { Event } from '@skyway-sdk/common';

import { Transport, TransportConnectionState } from '../../../plugin/interface';
import type { Codec } from '../../../media';
import { Stream, ContentType, WebRTCStats } from '../base';

export abstract class RemoteStreamBase implements Stream {
  readonly side = 'remote';
  /**
   * @description [japanese] メディア通信の状態が変化した時に発火するイベント
   */
  readonly onConnectionStateChanged = new Event<TransportConnectionState>();
  codec!: Codec;

  /**@internal */
  constructor(readonly id: string, readonly contentType: ContentType) {}

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
    return this._getTransport()?.connectionState ?? 'new';
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
