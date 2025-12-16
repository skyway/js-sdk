import type { RoomMember } from '../member';
import type { RoomPublication } from '../publication';
import type { RoomSubscription } from '../subscription';

export type RoomClosedEvent = Record<PropertyKey, unknown>;
export type RoomMetadataUpdatedEvent = {
  metadata: string;
};

export type MemberJoinedEvent = {
  member: RoomMember;
};
export type MemberLeftEvent = {
  member: RoomMember;
};
export type ListChangedEvent = Record<PropertyKey, unknown>;
export type MemberMetadataUpdatedEvent = {
  metadata: string;
  member: RoomMember;
};
export type MemberStateChangedEvent = {
  member: RoomMember;
};

export type StreamPublishedEvent = {
  publication: RoomPublication;
};
export type StreamUnpublishedEvent = {
  publication: RoomPublication;
};

export type PublicationMetadataUpdatedEvent = {
  publication: RoomPublication;
  metadata: string;
};
export type PublicationEnabledEvent = {
  publication: RoomPublication;
};
export type PublicationDisabledEvent = {
  publication: RoomPublication;
};
export type PublicationStateChangedEvent = {
  publication: RoomPublication;
};

export type StreamSubscribedEvent = {
  subscription: RoomSubscription;
};
export type StreamUnsubscribedEvent = {
  subscription: RoomSubscription;
};
