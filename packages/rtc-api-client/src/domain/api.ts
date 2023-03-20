import { Event, SkyWayError } from '@skyway-sdk/common';
import model, {
  Channel,
  Member,
  MemberType,
  Publication,
} from '@skyway-sdk/model';

export interface RtcApi {
  readonly onClose: Event<void>;
  readonly onFatalError: Event<SkyWayError>;
  /**@throws {@link SkyWayError} */
  createChannel(
    appId: string,
    channelInit: ChannelInit
  ): Promise<model.Channel>;
  getChannel(appId: string, channelQuery: ChannelQuery): Promise<model.Channel>;
  findOrCreateChannel(
    appId: string,
    channelQuery: ChannelInit
  ): Promise<model.Channel>;
  deleteChannel(appId: string, id: Channel['id']): Promise<void>;
  updateChannelMetadata(
    appId: string,
    id: Channel['id'],
    metadata: string
  ): Promise<void>;
  join(
    appId: string,
    channelId: Channel['id'],
    memberInit: MemberInit
  ): Promise<model.Member>;
  leave(
    appId: string,
    channelId: Channel['id'],
    memberId: Member['id']
  ): Promise<void>;
  updateMemberTtl(
    appId: string,
    channelId: Channel['id'],
    memberId: Member['id'],
    ttlSec: number
  ): Promise<void>;
  updateMemberMetadata(
    appId: string,
    channelId: Channel['id'],
    memberId: Member['id'],
    metadata: string
  ): Promise<void>;
  /**@throws {@link SkyWayError} */
  publish(appId: string, init: PublicationInit): Promise<model.Publication>;
  unpublish(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id']
  ): Promise<void>;
  updatePublicationMetadata(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id'],
    metadata: string
  ): Promise<void>;
  disablePublication(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id']
  ): Promise<void>;
  enablePublication(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id']
  ): Promise<void>;
  /**@throws {@link SkyWayError} */
  subscribe(appId: string, init: SubscriptionInit): Promise<model.Subscription>;
  unsubscribe(
    appId: string,
    channelId: string,
    subscriptionId: string
  ): Promise<void>;
  getServerUnixtime(appId: string): Promise<number>;
  updateAuthToken(token: string): Promise<void>;
  close(): void;
}

export type ChannelInit = {
  name?: Channel['name'];
  metadata?: string;
};

export type ChannelQuery = {
  name?: Channel['name'];
  id?: Channel['id'];
};

export type MemberInit = {
  name?: Member['name'];
  type: MemberType;
  subtype: string;
  metadata?: string;
  ttlSec?: number;
};

export type PublicationInit = {
  channel: Channel['id'];
  publisher: Member['id'];
  origin?: Publication['id'];
  metadata?: string;
  contentType: model.ContentType;
  codecCapabilities?: model.Codec[];
  encodings?: model.Encoding[];
};

export type SubscriptionInit = {
  channel: { id: Channel['id'] };
  subscriber: { id: Member['id'] };
  publication: {
    id: Publication['id'];
    publisherId: Publication['publisherId'];
    contentType: Publication['contentType'];
  };
};
