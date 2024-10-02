import { Logger, PromiseQueue } from '@skyway-sdk/common';

import { VideoMediaTrackConstraints } from '../../factory';
import {
  emptyVideoTrack,
  LocalMediaStreamBase,
  LocalMediaStreamOptions,
} from './media';

const log = new Logger('packages/core/src/media/stream/local/customVideo.ts');

export interface ProcessedStream {
  track: MediaStreamTrack;
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
}

export class LocalCustomVideoStream extends LocalMediaStreamBase {
  readonly contentType = 'video';
  private _isEnabled = true;
  private _promiseQueue = new PromiseQueue();
  private _stream: ProcessedStream | null;

  constructor(
    options: VideoMediaTrackConstraints & Partial<LocalMediaStreamOptions> = {}
  ) {
    super(emptyVideoTrack, 'video', options);
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

  /**
   * @deprecated
   * @use {@link Publication.state}
   */
  get isEnabled() {
    return this._isEnabled;
  }

  release(): void {
    this._stream?.dispose().catch(() => {
      log.error('release failed');
    });
  }
}
