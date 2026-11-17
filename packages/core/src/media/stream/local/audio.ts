import { Logger } from '@skyway-sdk/common';

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
    await this._setDeviceStreamEnabled(enabled, () =>
      this._options.isDisplayMedia === true
        ? this.enableDisplay()
        : this.enableMic(),
    );
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
