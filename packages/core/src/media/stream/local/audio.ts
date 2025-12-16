import { Logger, PromiseQueue } from '@skyway-sdk/common';

import { errors } from '../../../errors';
import { createError } from '../../../util';
import type { AudioMediaTrackConstraints } from '../../factory';
import { AudioLevel } from '../audioLevel';
import {
  LocalMediaStreamBase,
  type LocalMediaStreamInterface,
  type LocalMediaStreamOptions,
} from './media';

const log = new Logger('packages/core/src/media/stream/local/audio.ts');

export interface LocalAudioStreamInterface extends LocalMediaStreamInterface {
  readonly contentType: 'audio';
}

export class LocalAudioStream
  extends LocalMediaStreamBase
  implements LocalAudioStreamInterface
{
  readonly contentType = 'audio';
  private _isEnabled = true;
  private _promiseQueue = new PromiseQueue();
  private _audioLevel: AudioLevel | undefined;

  constructor(
    track: MediaStreamTrack,
    options: AudioMediaTrackConstraints & Partial<LocalMediaStreamOptions> = {},
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

  /**@description [japanese] 直近100msにおける最大音量を取得する（値の範囲：0-1） */
  getAudioLevel() {
    // 不要なリソース生成を行わないように初回実行時にAudioLevelインスタンスを生成する
    if (this._audioLevel === undefined) {
      this._audioLevel = new AudioLevel(this.track);
    }
    return this._isEnabled ? this._audioLevel.calculate() : 0;
  }
}
