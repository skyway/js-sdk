import { Member } from '../member';
import { Publication } from '../publication';
import { Subscription } from '../subscription';

export type ChannelClosedEvent = {};
export type ChannelMetadataUpdatedEvent = {
  metadata: string;
};
export type ListChangedEvent = {};
export type MemberJoinedEvent = {
  member: Member;
};
export type MemberLeftEvent = {
  member: Member;
};
export type MemberMetadataUpdatedEvent = {
  metadata: string;
  member: Member;
};
export type MemberStateChangedEvent = {
  member: Member;
};

export type StreamPublishedEvent = {
  publication: Publication;
};
export type StreamUnpublishedEvent = {
  publication: Publication;
};
export type PublicationMetadataUpdatedEvent = {
  publication: Publication;
  metadata: string;
};
export type PublicationEnabledEvent = {
  publication: Publication;
};
export type PublicationDisabledEvent = {
  publication: Publication;
};
export type PublicationStateChangedEvent = {
  publication: Publication;
};

export type StreamSubscribedEvent = {
  subscription: Subscription;
};
export type StreamUnsubscribedEvent = {
  subscription: Subscription;
};
