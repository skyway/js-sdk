import { LocalAudioStream } from './audio';
import { LocalStreamBase } from './base';
import { LocalDataStream } from './data';
import { LocalMediaStreamBase, LocalMediaStreamOptions } from './media';
import { LocalVideoStream } from './video';

export type LocalStream = LocalAudioStream | LocalVideoStream | LocalDataStream;

export {
  LocalAudioStream,
  LocalDataStream,
  LocalMediaStreamBase,
  LocalMediaStreamOptions,
  LocalStreamBase,
  LocalVideoStream,
};
