/**
 * @internal
 * @description ClientEvent を JSON 化した文字列全体の UTF-8 のバイト数の上限
 */
export const MAX_PAYLOAD_LENGTH = 20480;

export type ClientEventType =
  | 'sendRequestSignalingMessage'
  | 'sendResponseSignalingMessage'
  | 'updateSkyWayAuthToken'
  | 'checkConnectivity';

const textEncoder = new TextEncoder();

export const getByteLength = (text: string) => textEncoder.encode(text).length;

export const encodeClientEvent = (
  event: ClientEventType,
  eventId: string,
  payload: Record<string, unknown>,
) => JSON.stringify({ event, eventId, payload });

export class ClientEvent {
  readonly eventId: string;

  data: string;

  constructor(
    readonly event: ClientEventType,
    readonly payload: Record<string, unknown> = {},
  ) {
    this.eventId = globalThis.crypto.randomUUID();
    this.data = encodeClientEvent(this.event, this.eventId, this.payload);
    if (getByteLength(this.data) > MAX_PAYLOAD_LENGTH) {
      throw new Error('payload size exceeds the upper limit');
    }
  }
}
