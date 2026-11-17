import { Logger } from '@skyway-sdk/common';

import { errors } from '../../../errors';
import { createError } from '../../../util';
import type {
  DisplayMediaTrackConstraints,
  VideoMediaTrackConstraints,
} from '../../factory';
import { LocalMediaStreamBase, type LocalMediaStreamOptions } from './media';

const log = new Logger('packages/core/src/media/stream/local/video.ts');

export class LocalVideoStream extends LocalMediaStreamBase {
  readonly contentType = 'video';

  constructor(
    track: MediaStreamTrack,
    options: VideoMediaTrackConstraints &
      DisplayMediaTrackConstraints &
      Partial<LocalMediaStreamOptions> = {},
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
    await this._setDeviceStreamEnabled(enabled, () =>
      this._options.isDisplayMedia === true
        ? this.enableDisplay()
        : this.enableCamera(),
    );
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
