import { RemoteMediaStreamBase } from './media';

export class RemoteVideoStream extends RemoteMediaStreamBase {
  readonly contentType = 'video';

  /**@internal */
  constructor(id: string, readonly track: MediaStreamTrack) {
    super(id, 'video', track);
  }
}
