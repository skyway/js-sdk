import { ErrorInfo, SkyWayError } from '@skyway-sdk/common';
import { SkyWayContext } from '@skyway-sdk/core';

import { RoomImpl } from './room/base';

export function createError({
  operationName,
  context,
  info,
  error,
  path,
  payload,
  room,
}: {
  operationName: string;
  path: string;
  info: ErrorInfo;
  context?: SkyWayContext;
  room?: RoomImpl;
  error?: Error;
  payload?: any;
}) {
  const errPayload: any = {
    operationName,
    payload,
  };

  if (room) {
    errPayload['appId'] = room._channel.appId;
    errPayload['roomId'] = room.id;
    if (room.localRoomMember) {
      errPayload['memberId'] = room.localRoomMember.id;
    }
  }
  if (context) {
    errPayload['info'] = context.info;
    errPayload['plugins'] = context.plugins.map((p) => p.subtype);
  }

  return new SkyWayError({ error, info, payload: errPayload, path });
}
