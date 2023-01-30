import { Subscription } from '@skyway-sdk/model';
import { Publication } from '@skyway-sdk/model';
import { Member } from '@skyway-sdk/model';

export type ChannelEvent =
  | ChannelCreatedEvent
  | ChannelDeletedEvent
  | ChannelMetadataUpdatedEvent
  | MemberAddedEvent
  | MemberRemovedEvent
  | MemberMetadataUpdatedEvent
  | StreamPublishedEvent
  | StreamUnpublishedEvent
  | PublicationMetadataUpdatedEvent
  | PublicationDisabledEvent
  | PublicationEnabledEvent
  | StreamSubscribedEvent
  | StreamUnsubscribedEvent;

export interface ChannelSummary {
  id: string;
  version: number;
  metadata: string;
}

export type PublicationSummary = Omit<Publication, 'channelId'>;

export type SubscriptionSummary = Omit<
  Subscription,
  'channelId' | 'publisherId' | 'contentType'
>;

interface EventBase {
  type: string;
  data: { [key: string]: any; channel: ChannelSummary };
  appId: string;
}

export interface ChannelCreatedEvent extends EventBase {
  type: 'ChannelCreated';
}
export interface ChannelDeletedEvent extends EventBase {
  type: 'ChannelDeleted';
}
export interface ChannelMetadataUpdatedEvent extends EventBase {
  type: 'ChannelMetadataUpdated';
  data: { channel: ChannelSummary };
}

export interface MemberAddedEvent extends EventBase {
  type: 'MemberAdded';
  data: { member: Member; channel: ChannelSummary };
}
export interface MemberRemovedEvent extends EventBase {
  type: 'MemberRemoved';
  data: { member: Member; channel: ChannelSummary };
}
export interface MemberMetadataUpdatedEvent extends EventBase {
  type: 'MemberMetadataUpdated';
  data: { member: Member; metadata: string; channel: ChannelSummary };
}

export interface StreamPublishedEvent extends EventBase {
  type: 'StreamPublished';
  data: { publication: PublicationSummary; channel: ChannelSummary };
}
export interface StreamUnpublishedEvent extends EventBase {
  type: 'StreamUnpublished';
  data: { publication: PublicationSummary; channel: ChannelSummary };
}
export interface PublicationMetadataUpdatedEvent extends EventBase {
  type: 'PublicationMetadataUpdated';
  data: {
    publication: PublicationSummary;
    channel: ChannelSummary;
  };
}
export interface PublicationEnabledEvent extends EventBase {
  type: 'PublicationEnabled';
  data: {
    publication: PublicationSummary;
    channel: ChannelSummary;
  };
}
export interface PublicationDisabledEvent extends EventBase {
  type: 'PublicationDisabled';
  data: {
    publication: PublicationSummary;
    channel: ChannelSummary;
  };
}

export interface StreamSubscribedEvent extends EventBase {
  type: 'StreamSubscribed';
  data: { subscription: SubscriptionSummary; channel: ChannelSummary };
}
export interface StreamUnsubscribedEvent extends EventBase {
  type: 'StreamUnsubscribed';
  data: { subscription: SubscriptionSummary; channel: ChannelSummary };
}
