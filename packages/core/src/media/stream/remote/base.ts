import { Event } from '@skyway-sdk/common';

import { Transport, TransportConnectionState } from '../../../plugin/interface';
import { Codec } from '../..';
import { ContentType, Stream, WebRTCStats } from '..';

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
   * @experimental
   * @description [japanese] RemoteStreamの通信の統計情報を取得する
   */
  getStats: () => Promise<WebRTCStats> = async () => [] as WebRTCStats;
  /**
   * @experimental
   * @description [japanese] 試験的なAPIです。今後インターフェースや仕様が変更される可能性があります
   * @description [japanese] 対象のMemberとのRTCPeerConnectionを取得する。RTCPeerConnectionを直接操作すると SDK は正しく動作しなくなる可能性があります。
   */
  getRTCPeerConnection() {
    return this._getTransport()?.rtcPeerConnection;
  }

  /**
   * @description [japanese] メディア通信の状態を取得
   */
  getConnectionState() {
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
