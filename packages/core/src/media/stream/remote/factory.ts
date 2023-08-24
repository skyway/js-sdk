import { Logger } from '@skyway-sdk/common';

import { errors } from '../../../errors';
import type { Codec } from '../../../media';
import { createError } from '../../../util';
import { RemoteStream } from '.';
import { RemoteAudioStream } from './audio';
import { RemoteDataStream } from './data';
import { RemoteVideoStream } from './video';

const log = new Logger('packages/core/src/media/stream/remote/factory.ts');

/**@internal */
export const createRemoteStream = (
  id: string,
  media: MediaStreamTrack | RTCDataChannel,
  codec: Codec
): RemoteStream => {
  if (media instanceof RTCDataChannel) {
    const stream = new RemoteDataStream(id, media);
    stream.codec = codec;
    return stream;
  } else {
    if (media.kind === 'audio') {
      const stream = new RemoteAudioStream(id, media);
      stream.codec = codec;
      return stream;
    } else if (media.kind === 'video') {
      const stream = new RemoteVideoStream(id, media);
      stream.codec = codec;
      return stream;
    }
  }

  throw createError({
    operationName: 'createRemoteStream',
    path: log.prefix,
    info: { ...errors.invalidArgumentValue, detail: 'invalid stream type' },
  });
};
