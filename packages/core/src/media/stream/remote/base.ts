import { Event } from '@skyway-sdk/common';

import type { Codec } from '../../../media';
import { Transport, TransportConnectionState } from '../../../plugin/interface';
import { ContentType, Stream, WebRTCStats } from '../base';

export abstract class RemoteStreamBase implements Stream {
  readonly side = 'remote';
  /**@internal */
  readonly _onConnectionStateChanged = new Event<TransportConnectionState>();
  codec!: Codec;
  private _connectionState: TransportConnectionState = 'new';

  /**@internal */
  constructor(readonly id: string, readonly contentType: ContentType) {}

  /**@internal */
  _setConnectionState(state: TransportConnectionState) {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this._onConnectionStateChanged.emit(state);
  }

  /**@internal */
  _getTransport: () => Transport | undefined = () => undefined;

  /**@internal */
  _getStats: () => Promise<WebRTCStats> = async () => [] as WebRTCStats;

  /**@internal */
  _getRTCPeerConnection() {
    return this._getTransport()?.rtcPeerConnection;
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
