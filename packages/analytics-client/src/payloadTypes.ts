export type OpenServerEventPayload = {
  statsRequest: {
    intervalSec: number;
    types: {
      type: string;
      properties: {
        [property: string]: {
          normalization: boolean;
          outputKey: string;
          contentType: ('audio' | 'video' | 'data')[];
        };
      };
    }[];
  };
};

export function isRecord(arg: unknown): arg is Record<string, unknown> {
  if (typeof arg !== 'object') return false;
  if (arg === null) return false;
  if (Array.isArray(arg)) return false;
  return true;
}

export function isOpenServerEventPayload(payload: any): payload is OpenServerEventPayload {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.statsRequest || typeof payload.statsRequest !== 'object') return false;
  if (!payload.statsRequest.intervalSec || typeof payload.statsRequest.intervalSec !== 'number') return false;
  if (!payload.statsRequest.types || !Array.isArray(payload.statsRequest.types)) return false;
  for (const statsRequestType of payload.statsRequest.types) {
    if (!statsRequestType.type || typeof statsRequestType.type !== 'string') return false;
    if (!statsRequestType.properties || !isRecord(statsRequestType.properties)) return false;

    for (const key of Object.keys(statsRequestType.properties)) {
      if (
        !('normalization' in statsRequestType.properties[key]) ||
        typeof statsRequestType.properties[key].normalization !== 'boolean'
      )
        return false;
      if (!statsRequestType.properties[key].outputKey || typeof statsRequestType.properties[key].outputKey !== 'string')
        return false;
    }
  }

  return true;
}

const AcknowledgeReason = ['invalidPayload', 'unexpected'] as const;
export type AcknowledgeReason = (typeof AcknowledgeReason)[number];

export type AcknowledgePayload = {
  eventId: string;
  ok: boolean;
  reason?: AcknowledgeReason;
};

export function isAcknowledgePayload(payload: any): payload is AcknowledgePayload {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.eventId !== 'string') return false;
  if (typeof payload.ok !== 'boolean') return false;
  if (
    typeof payload.reason !== 'undefined' &&
    (typeof payload.reason !== 'string' || !AcknowledgeReason.includes(payload.reason))
  )
    return false;
  return true;
}

export type ConnectionFailedEventPayload = {
  code?: number;
  reason?: string;
};
