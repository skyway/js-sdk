import { Event } from '@skyway-sdk/common';

import { Member } from '../../member';
import { LocalPersonImpl } from '../../member/localPerson';
import { PublicationImpl } from '../../publication';
import { SubscriptionImpl } from '../../subscription';

/**@internal */
export interface SkyWayConnection {
  readonly type: string;
  readonly localPerson: LocalPersonImpl;
  readonly remoteMember: Pick<Member, 'id' | 'name'>;
  readonly onDisconnect: Event<void>;
  readonly onClose: Event<void>;
  closed: boolean;
  close(props?: { reason?: string }): void;
  /**@throws {SkyWayError} */
  startPublishing?(
    publication: PublicationImpl,
    subscriptionId: string
  ): Promise<void>;
  stopPublishing?(publication: PublicationImpl): Promise<void>;
  startSubscribing?(subscription: SubscriptionImpl): Promise<void>;
  stopSubscribing?(subscription: SubscriptionImpl): Promise<void>;
  changePreferredEncoding?(subscription: SubscriptionImpl): Promise<void>;
}

/**@internal */
export interface Transport {
  connectionState: TransportConnectionState;
  rtcPeerConnection: RTCPeerConnection;
}

export type TransportConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';
