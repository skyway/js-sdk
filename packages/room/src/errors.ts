import { errors as coreErrors } from '@skyway-sdk/core';
import { errors as sfuErrors } from '@skyway-sdk/sfu-bot';

export const roomErrors = {
  invalidParameter: { name: 'invalidParameter', detail: '', solution: '' },
  timeout: { name: 'timeout', detail: '', solution: '' },
  internal: { name: 'internal', detail: '', solution: '' },
  notImplemented: {
    name: 'notImplemented',
    detail: '対応していないRoomTypeです',
    solution: '正しいRoomTypeを指定してください',
  },
  roomNotOpened: {
    name: 'roomNotOpened',
    detail: 'RoomがOpenされていません',
    solution: 'Roomの状態を確かめてください',
  },
  subscribeOtherMemberType: {
    name: 'subscribeOtherMemberType',
    detail:
      'RemoteMemberにSubscribe/Unsubscribeさせる場合、対象のMemberのTypeはPersonである必要があります',
    solution: '対象のRemoteMemberが正しいか確認してください',
  },
  sfuRoomNotSupportDataStream: {
    name: 'sfuRoomNotSupportDataStream',
    detail: 'SFURoomでDataStreamを使うことは出来ません',
    solution: 'ありません',
  },
  publicationNotHasOrigin: {
    name: 'publicationNotHasOrigin',
    detail: 'SfuRoomで操作するPublicationはOriginをもつ必要があります',
    solution: 'SfuRoomとP2PRoomを同一のIDで混在させていないか確かめてください',
  },
  notFound: {
    name: 'notFound',
    detail: '参照しようとしていたものが見つかりません',
    solution: '参照しようとしたものが存在するか確かめてください',
  },
} as const;

export const errors = { ...coreErrors, ...sfuErrors, ...roomErrors } as const;
