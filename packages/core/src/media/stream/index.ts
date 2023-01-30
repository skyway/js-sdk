export * from './local';
export * from './remote';

export interface Stream {
  id: string;
  side: StreamSide;
  contentType: ContentType;
}

export type StreamSide = 'remote' | 'local';
export type ContentType = 'audio' | 'data' | 'video';

export type WebRTCStats = { id: string; type: string; [key: string]: any }[];
