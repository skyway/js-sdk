export const errors = {
  invalidParameter: { name: 'invalidParameter', detail: '', solution: '' },
  timeout: { name: 'timeout', detail: '', solution: '' },
  internal: { name: 'timeout', detail: '', solution: '' },
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
} as const;
