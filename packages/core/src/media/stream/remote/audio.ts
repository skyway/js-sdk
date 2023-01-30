import { RemoteMediaStreamBase } from './media';

export class RemoteAudioStream extends RemoteMediaStreamBase {
  readonly contentType = 'audio';

  /**@internal */
  constructor(id: string, readonly track: MediaStreamTrack) {
    super(id, 'audio', track);
  }
}
