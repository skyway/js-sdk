import { v4 as uuidv4 } from 'uuid';

const MAX_PAYLOAD_LENGTH = 20480;

export type ClientEventType =
  | 'sendRequestSignalingMessage'
  | 'sendResponseSignalingMessage'
  | 'updateSkyWayAuthToken'
  | 'checkConnectivity';

export class ClientEvent {
  readonly eventId: string;

  data: string;

  constructor(readonly event: ClientEventType, readonly payload: Record<string, unknown> = {}) {
    this.eventId = uuidv4();
    this.data = JSON.stringify({ event: this.event, eventId: this.eventId, payload: this.payload });
    if (this.data.length > MAX_PAYLOAD_LENGTH) {
      throw new Error('payload size exceeds the upper limit');
    }
  }
}
