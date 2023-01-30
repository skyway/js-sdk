import { ErrorInfo, SkyWayError } from '@skyway-sdk/common';

export function createError({
  operationName,
  info,
  error,
  path,
  payload,
}: {
  operationName: string;
  info: ErrorInfo;
  error?: Error;
  path: string;
  payload?: any;
}) {
  return new SkyWayError({
    error,
    info: info,
    payload: { payload, operationName },
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
  botId,
}: {
  operationName: string;
  channelId?: string;
  appId?: string;
  memberId?: string;
  botId?: string;
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
    botId,
  };

  return warn;
}
