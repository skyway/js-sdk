export interface Channel {
  id: string;
  name: string;
  metadata?: string;
  members: Member[];
  publications: Publication[];
  subscriptions: Subscription[];
  version: number;
}

export interface Member {
  id: string;
  name?: string;
  type: MemberType;
  subtype: string;
  metadata?: string;
}

export type MemberType = 'person' | 'bot';

export interface Publication {
  id: string;
  channelId: Channel['id'];
  publisherId: Member['id'];
  origin?: Publication['id'];
  contentType: ContentType;
  metadata?: string;
  codecCapabilities: Codec[];
  encodings: Encoding[];
  isEnabled: boolean;
}

export type ContentType = 'audio' | 'video' | 'data';

export type Codec = { mimeType: string };
export interface Encoding {
  id: string;
  maxBitrate?: number;
  scaleResolutionDownBy?: number;
  maxFramerate?: number;
}

export interface Subscription {
  id: string;
  channelId: Channel['id'];
  publicationId: Publication['id'];
  publisherId: Member['id'];
  subscriberId: Member['id'];
  contentType: ContentType;
}
