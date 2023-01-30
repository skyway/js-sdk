import { ErrorInfo, SkyWayError } from '@skyway-sdk/common';

export function createError({
  operationName,
  info,
  error,
  path,
  payload,
  channelId,
  appId,
  memberId,
}: {
  operationName: string;
  info: ErrorInfo;
  error?: Error;
  path: string;
  payload?: any;
  channelId?: string;
  appId?: string;
  memberId?: string;
}) {
  return new SkyWayError({
    error,
    info: info,
    payload: { payload, operationName, channelId, appId, memberId },
    path,
  });
}

export function createWarnPayload({
  appId,
  detail,
  channelId,
  operationName,
  payload,
  memberId,
}: {
  operationName: string;
  channelId?: string;
  appId?: string;
  memberId?: string;
  detail: string;
  payload?: any;
}) {
  const warn: any = {
    operationName,
    payload,
    detail,
    appId,
    channelId,
    memberId,
  };

  return warn;
}
