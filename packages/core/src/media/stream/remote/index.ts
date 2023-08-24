import { RemoteAudioStream } from './audio';
import { RemoteStreamBase } from './base';
import { RemoteDataStream } from './data';
import { RemoteMediaStreamBase } from './media';
import { RemoteVideoStream } from './video';

export type RemoteStream =
  | RemoteDataStream
  | RemoteAudioStream
  | RemoteVideoStream;

export {
  RemoteAudioStream,
  RemoteDataStream,
  RemoteMediaStreamBase,
  RemoteStreamBase,
  RemoteVideoStream,
};
