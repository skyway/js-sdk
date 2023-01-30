import { RoomMember } from '../member';
import { RoomPublication } from '../publication';
import { RoomSubscription } from '../subscription';

export type RoomClosedEvent = {};
export type RoomMetadataUpdatedEvent = {
  metadata: string;
};

export type MemberJoinedEvent = {
  member: RoomMember;
};
export type MemberLeftEvent = {
  member: RoomMember;
};
export type ListChangedEvent = {};
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
