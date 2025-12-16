import { AudioLevel } from '../audioLevel';
import { RemoteMediaStreamBase } from './media';

export class RemoteAudioStream extends RemoteMediaStreamBase {
  readonly contentType = 'audio';
  private _audioLevel: AudioLevel | undefined;

  /**@internal */
  constructor(
    id: string,
    readonly track: MediaStreamTrack,
  ) {
    super(id, 'audio', track);
  }

  /**@description [japanese] 直近100msにおける最大音量を取得する（値の範囲：0-1） */
  getAudioLevel() {
    // 不要なリソース生成を行わないように初回実行時にAudioLevelインスタンスを生成する
    if (this._audioLevel === undefined) {
      this._audioLevel = new AudioLevel(this.track);
    }
    return this.track.enabled ? this._audioLevel.calculate() : 0;
  }
}
