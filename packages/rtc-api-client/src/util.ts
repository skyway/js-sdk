import { ErrorInfo, SkyWayError } from '@skyway-sdk/common';

export function createWarnPayload({
  appId,
  detail,
  channelId,
  operationName,
  payload,
}: {
  operationName: string;
  channelId?: string;
  appId?: string;
  detail: string;
  payload?: any;
}) {
  const warn: any = {
    operationName,
    payload,
    detail,
    appId,
    channelId,
  };

  return warn;
}

export function createError({
  operationName,
  info,
  error,
  path,
  channelId,
  appId,
  payload,
}: {
  operationName: string;
  info: ErrorInfo;
  error?: Error;
  path: string;
  payload?: any;
  channelId?: string;
  appId?: string;
}) {
  return new SkyWayError({
    error,
    info: info,
    payload: { payload, operationName, channelId, appId },
    path,
  });
}
