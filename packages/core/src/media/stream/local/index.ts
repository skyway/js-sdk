import { LocalAudioStream } from './audio';
import { LocalStreamBase } from './base';
import { LocalCustomVideoStream } from './customVideo';
import { LocalDataStream } from './data';
import { LocalMediaStreamBase, LocalMediaStreamOptions } from './media';
import { LocalVideoStream } from './video';

export type LocalStream =
  | LocalAudioStream
  | LocalVideoStream
  | LocalDataStream
  | LocalCustomVideoStream;

export {
  LocalAudioStream,
  LocalCustomVideoStream,
  LocalDataStream,
  LocalMediaStreamBase,
  type LocalMediaStreamOptions,
  LocalStreamBase,
  LocalVideoStream,
};
