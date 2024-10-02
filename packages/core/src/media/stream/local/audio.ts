import { Logger, PromiseQueue } from '@skyway-sdk/common';

import { errors } from '../../../errors';
import { createError } from '../../../util';
import { AudioMediaTrackConstraints } from '../../factory';
import { LocalMediaStreamBase, LocalMediaStreamOptions } from './media';

const log = new Logger('packages/core/src/media/stream/local/audio.ts');

export class LocalAudioStream extends LocalMediaStreamBase {
  readonly contentType = 'audio';
  private _isEnabled = true;
  private _promiseQueue = new PromiseQueue();

  constructor(
    track: MediaStreamTrack,
    options: AudioMediaTrackConstraints & Partial<LocalMediaStreamOptions> = {}
  ) {
    super(track, 'audio', options);

    if (track.kind !== 'audio') {
      throw createError({
        operationName: 'LocalAudioStream.constructor',
        path: log.prefix,
        info: errors.invalidTrackKind,
        payload: { track },
      });
    }
  }

  /**@internal */
  async setEnabled(enabled: boolean) {
    await this._promiseQueue.push(async () => {
      // mute
      if (this._isEnabled === true && enabled === false) {
        this._isEnabled = enabled;

        this._disable('audio');

        log.debug('stopped');
      }
      // unmute
      else if (this._isEnabled === false && enabled === true) {
        this._isEnabled = enabled;

        if (this._options.stopTrackWhenDisabled) {
          const track =
            this._options.isDisplayMedia === true
              ? await this.enableDisplay()
              : await this.enableMic();

          this._updateTrack(track);
          this._onEnableChanged.emit(track);
        } else if (this._oldTrack) {
          this._updateTrack(this._oldTrack);
          this._onEnableChanged.emit(this._oldTrack);
        }

        log.debug('resumed');
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

  private async enableMic() {
    const [track] = (
      await navigator.mediaDevices.getUserMedia({
        audio: this.trackConstraints,
      })
    ).getAudioTracks();

    return track;
  }

  private async enableDisplay() {
    const [track] = (
      await navigator.mediaDevices.getDisplayMedia({
        audio: this.trackConstraints,
      })
    ).getAudioTracks();

    return track;
  }
}
