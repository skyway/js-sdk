import { Logger, PromiseQueue } from '@skyway-sdk/common';

import type { VideoMediaTrackConstraints } from '../../factory';
import {
  createEmptyTrack,
  LocalMediaStreamBase,
  type LocalMediaStreamOptions,
} from './media';

const log = new Logger('packages/core/src/media/stream/local/customVideo.ts');

export interface ProcessedStream {
  track: MediaStreamTrack;
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
}

export class LocalCustomVideoStream extends LocalMediaStreamBase {
  readonly contentType = 'video';
  private _promiseQueue = new PromiseQueue();
  private _stream: ProcessedStream | null;

  constructor(
    options: VideoMediaTrackConstraints & Partial<LocalMediaStreamOptions> = {},
  ) {
    super(createEmptyTrack('video'), 'video', options);
    this._stream = null;
  }

  /**@internal */
  async setStream(processedStream: ProcessedStream) {
    if (this._stream) {
      throw new Error('ProcessedStream is already exists');
    }
    this._stream = processedStream;
    this._updateTrack(processedStream.track);
  }

  /**@internal */
  async setEnabled(enabled: boolean) {
    await this._promiseQueue.push(async () => {
      await this._stream?.setEnabled(enabled);
    });
  }

  /**@internal */
  async updateTrack(track: MediaStreamTrack) {
    this._updateTrack(track);
    this._onEnableChanged.emit(track);
  }

  // LocalMediaStreamBase.release のTSDoc（元のtrackをstopする説明）を継承しないよう上書きしている
  /**
   * @description [japanese] Streamを解放します。
   */
  release(): void {
    this._stream?.dispose().catch(() => {
      log.error('release failed');
    });
  }
}
