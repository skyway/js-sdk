import type model from '@skyway-sdk/model';

export type ChannelOpenedEvent = Record<PropertyKey, unknown>;
export type ChannelClosedEvent = Record<PropertyKey, unknown>;
export interface ChannelMetadataUpdatedEvent {
  channel: { metadata: string };
}

export type ChangedEvent = Record<PropertyKey, unknown>;
export interface MemberJoinedEvent {
  member: model.Member;
}
export interface MemberLeftEvent {
  member: model.Member;
}
export interface MemberMetadataUpdatedEvent {
  member: model.Member;
}

export interface StreamPublishedEvent {
  publication: model.Publication;
}
export interface StreamUnpublishedEvent {
  publication: model.Publication;
}
export interface PublicationMetadataUpdatedEvent {
  publication: model.Publication;
}
export interface PublicationDisabledEvent {
  publication: model.Publication;
}
export interface PublicationEnabledEvent {
  publication: model.Publication;
}

export interface StreamSubscribedEvent {
  subscription: model.Subscription;
}
export interface StreamUnsubscribedEvent {
  subscription: model.Subscription;
}
