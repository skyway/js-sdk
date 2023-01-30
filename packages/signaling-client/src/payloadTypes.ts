export type Member = {
  id: string;
  name?: string;
};

export type MessagePayload = {
  src: Member;
  requestEventId?: string;
  data: Record<string, unknown>;
};

const AcknowledgeReason = [
  'rateLimitExceeded',
  'targetNotFound',
  'payloadLengthExceeded',
  'invalidPayload',
  'unknown',
  'parameterError',
  'permissionError',
] as const;
export type AcknowledgeReason = (typeof AcknowledgeReason)[number];

export type AcknowledgePayload = {
  eventId: string;
  ok: boolean;
  reason?: AcknowledgeReason;
};

export function isMessagePayload(payload: any): payload is MessagePayload {
  if (!payload || typeof payload !== 'object') return false;
  if (!isMember(payload.src)) return false;
  if (!payload.data || typeof payload.data !== 'object') return false;
  return true;
}

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

export function isMember(arg: any): arg is Member {
  if (arg === undefined || Array.isArray(arg)) return false;
  if (typeof arg !== 'object') return false;
  if (typeof arg.id !== 'string') return false;
  if (typeof arg.name !== 'undefined' && typeof arg.name !== 'string') return false;
  return true;
}
