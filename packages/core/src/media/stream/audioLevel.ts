/**@internal */
export class AudioLevel {
  // ChromeのAudioLevelに近い挙動とするために取得範囲と更新周期を100msとする
  private readonly LEVEL_RANGE_MS = 100;
  // ChromeのAudioLevelに近い挙動とするために100ms毎に1/4減衰させる
  private readonly DECAY_FACTOR = 0.25; // 1/4
  private readonly DECAY_INTERVAL_MS = 100;
  // 使用する環境によってサンプリングレートは8000〜48000Hzまで様々であるため、中間値24000Hzを想定したデフォルト値を設定する
  private readonly DEFAULT_BUFFER_SIZE = 24000 * (this.LEVEL_RANGE_MS / 1000);

  private currentMaxLevel = 0;
  private readonly analyser: AnalyserNode;
  private readonly audioContext: AudioContext;
  private decayTimer: NodeJS.Timeout | null;

  constructor(audioStreamTrack: MediaStreamTrack) {
    this.audioContext = new AudioContext();

    this.analyser = this.setupAnalyser(audioStreamTrack);
    this.decayTimer = this.setDecayTimer();
  }

  async [Symbol.dispose](): Promise<void> {
    await this.dispose();
  }

  calculate() {
    // マイクの切り替えを考慮して毎回AudioContextからsampleRateを取得する
    const sampleRate = this.audioContext.sampleRate;

    // LEVEL_RANGE_MS分の音声サンプルを取得する
    const duration = this.LEVEL_RANGE_MS / 1000;
    const bufferLength = sampleRate
      ? sampleRate * duration
      : this.DEFAULT_BUFFER_SIZE;
    const timeDomainData = new Float32Array(bufferLength);
    this.analyser.getFloatTimeDomainData(timeDomainData);
    let level = Math.max(...timeDomainData);

    // 大きな音が発生した場合その影響を残すために保持する
    const _currentMaxLevel = this.currentMaxLevel;
    if (level > _currentMaxLevel) {
      this.currentMaxLevel = level;
    } else {
      level = _currentMaxLevel;
    }

    return this.clamp(level, 0, 1);
  }

  private setupAnalyser(audioStreamTrack: MediaStreamTrack) {
    const mediaStream = new MediaStream([audioStreamTrack]);
    const source = this.audioContext.createMediaStreamSource(mediaStream);
    const analyser = this.audioContext.createAnalyser();

    source.connect(analyser);

    return analyser;
  }

  private setDecayTimer() {
    // 100ms毎に現在の最大レベルを減衰させて一時的なピークの影響を抑える
    return setInterval(() => {
      this.currentMaxLevel = this.currentMaxLevel * this.DECAY_FACTOR;
    }, this.DECAY_INTERVAL_MS);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private async dispose() {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    await this.audioContext.close();
  }
}
