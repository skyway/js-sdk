import { Logger } from '@skyway-sdk/common';

import { errors } from '../../errors';
import { createError } from '../../util';

const log = new Logger('packages/core/src/media/stream/share.ts');

/**@internal */
export function attachElement(
  element: HTMLAudioElement | HTMLVideoElement,
  track: MediaStreamTrack
) {
  if ((element ?? {})?.srcObject === undefined) {
    throw createError({
      operationName: 'attachElement',
      info: errors.invalidElement,
      payload: { element },
      path: log.prefix,
    });
  }

  if (element.srcObject) {
    const stream = element.srcObject as MediaStream;

    const ended = stream.getTracks().find((t) => t.readyState === 'ended');
    if (ended) {
      stream.removeTrack(ended);
    }

    const duplicate = stream.getTracks().find((t) => t.kind === track.kind);
    if (duplicate) {
      stream.removeTrack(duplicate);
    }

    stream.addTrack(track);
  } else {
    element.srcObject = new MediaStream([track]);
  }
}

/**@internal */
export function detachElement(
  element: HTMLAudioElement | HTMLVideoElement,
  track: MediaStreamTrack
) {
  if ((element ?? {})?.srcObject === undefined) {
    throw createError({
      operationName: 'attachElement',
      info: errors.invalidElement,
      payload: { element },
      path: log.prefix,
    });
  }

  const stream = element.srcObject as MediaStream;
  if (stream.getTracks().length > 0) {
    stream.removeTrack(track);
  }

  if (stream.getTracks().length === 0) {
    element.srcObject = null;
  }
}
