import { Logger, PromiseQueue } from '@skyway-sdk/common';

import { errors } from '../../../errors';
import { createError } from '../../../util';
import {
  DisplayMediaTrackConstraints,
  VideoMediaTrackConstraints,
} from '../../factory';
import { LocalMediaStreamBase, LocalMediaStreamOptions } from './media';

const log = new Logger('packages/core/src/media/stream/local/video.ts');

export class LocalVideoStream extends LocalMediaStreamBase {
  readonly contentType = 'video';
  private _isEnabled = true;
  private _promiseQueue = new PromiseQueue();

  constructor(
    track: MediaStreamTrack,
    options: VideoMediaTrackConstraints &
      DisplayMediaTrackConstraints &
      Partial<LocalMediaStreamOptions> = {}
  ) {
    super(track, 'video', options);
    if (track.kind !== 'video') {
      throw createError({
        operationName: 'LocalVideoStream.constructor',
        path: log.prefix,
        info: errors.invalidTrackKind,
        payload: { track },
      });
    }
    log.debug('LocalVideoStream spawned', this.toJSON());
  }

  /**@internal */
  async setEnabled(enabled: boolean) {
    await this._promiseQueue.push(async () => {
      // mute
      if (this._isEnabled === true && enabled === false) {
        this._isEnabled = enabled;

        this._disable('video');

        log.debug('stopped', this.toJSON());
      }
      // unmute
      else if (this._isEnabled === false && enabled === true) {
        this._isEnabled = enabled;

        if (this._options.stopTrackWhenDisabled) {
          const track =
            this._options.isDisplayMedia === true
              ? await this.enableDisplay()
              : await this.enableCamera();

          this._updateTrack(track);
          this._onEnableChanged.emit(track);
        } else if (this._oldTrack) {
          this._updateTrack(this._oldTrack);
          this._onEnableChanged.emit(this._oldTrack);
        }

        log.debug('resumed', this.toJSON());
      }
    });
  }

  /**
   * @deprecated
   * @use {@link Publication.state}
   */
  get isEnabled() {
    return this._isEnabled;
  }

  private async enableCamera() {
    const [track] = (
      await navigator.mediaDevices.getUserMedia({
        video: this.trackConstraints,
      })
    ).getVideoTracks();

    return track;
  }

  private async enableDisplay() {
    const [track] = (
      await navigator.mediaDevices.getDisplayMedia({
        video: this.trackConstraints,
      })
    ).getVideoTracks();

    return track;
  }
}
