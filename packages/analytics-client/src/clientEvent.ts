import { Encoding } from '@skyway-sdk/model';
import { v4 as uuidv4 } from 'uuid';

export type ClientEventType =
  | 'MediaDeviceReport'
  | 'BindingRtcPeerConnectionToSubscription'
  | 'SubscriptionStatsReport'
  | 'RtcPeerConnectionEventReport'
  | 'PublicationUpdateEncodingsReport'
  | 'SubscriptionUpdatePreferredEncodingReport'
  | 'SdkLog'
  | 'JoinReport';

export type MediaDeviceReportClientEvent = {
  id: string;
  type: 'MediaDeviceReport';
  payload: {
    publicationId: string;
    mediaDeviceName: string;
    mediaDeviceVersion: number;
    mediaDeviceTrigger: 'publish' | 'replaceStream' | 'changeCamera';
    updatedAt: number; // UnixTimestamp (milliseconds)
  };
};

export type BindingRtcPeerConnectionToSubscriptionClientEvent = {
  id: string;
  type: 'BindingRtcPeerConnectionToSubscription';
  payload: {
    subscriptionId: string;
    role: 'sender' | 'receiver';
    rtcPeerConnectionId: string;
  };
};

export type SubscriptionStats = {
  [type: string]: {
    [property: string]: string;
  };
};

export type SubscriptionStatsReportClientEvent = {
  id: string;
  type: 'SubscriptionStatsReport';
  payload: {
    subscriptionId: string;
    role: 'sender' | 'receiver';
    stats: SubscriptionStats;
    createdAt: number; // UnixTimestamp (milliseconds)
  };
};

export type RtcPeerConnectionEventReportClientEvent = {
  id: string;
  type: 'RtcPeerConnectionEventReport';
  payload: {
    rtcPeerConnectionId: string;
    type:
      | 'offer'
      | 'answer'
      | 'iceCandidate'
      | 'iceCandidateError'
      | 'iceConnectionStateChange'
      | 'iceGatheringStateChange'
      | 'connectionStateChange'
      | 'signalingStateChange'
      | 'restartIce'
      | 'skywayConnectionStateChange';
    data:
      | {
          offer?: string; // type = offer の場合
          answer?: string; // type = answer の場合
          candidate?: string; // type = iceCandidate の場合
          event?: string; // type = iceCandidateError の場合
          iceConnectionState?: string; // type = iceConnectionStateChange の場合
          iceGatheringState?: string; // type = iceGatheringStateChange の場合
          connectionState?: string; // type = connectionStateChange の場合
          signalingState?: string; // type = signalingStateChange の場合
          skywayConnectionState?: string; // type = skywayConnectionStateChange の場合
        }
      | undefined; // type = restartIce の場合
    createdAt: number; // UnixTimestamp (milliseconds)
  };
};

export type PublicationUpdateEncodingsReportClientEvent = {
  id: string;
  type: 'PublicationUpdateEncodingsReport';
  payload: {
    publicationId: string;
    encodings: Encoding[];
    encodingsVersion: number;
    updatedAt: number; // UnixTimestamp (milliseconds);
  };
};

export type SubscriptionUpdatePreferredEncodingReportClientEvent = {
  id: string;
  type: 'SubscriptionUpdatePreferredEncodingReport';
  payload: {
    subscriptionId: string;
    preferredEncodingIndex: number;
    preferredEncodingVersion: number;
    updatedAt: number; // UnixTimestamp (milliseconds);
  };
};

export type JoinReportClientEvent = {
  id: string;
  type: 'JoinReport';
  payload: {
    memberId: string;
  };
};

export class ClientEvent {
  readonly id: string;

  readonly type: string;

  readonly payload: Record<string, unknown>;

  constructor(type: ClientEventType, payload: Record<string, unknown>) {
    this.id = uuidv4();
    this.type = type;
    this.payload = payload;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      payload: this.payload,
    };
  }
}
