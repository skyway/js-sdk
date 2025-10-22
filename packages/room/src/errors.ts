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
  sfuPublicationNotSupportDataStream: {
    name: 'sfuPublicationNotSupportDataStream',
    detail:
      'RoomでPublicationのtypeを"sfu"に設定したり、SFURoomを使用したりする場合、DataStreamを使うことは出来ません',
    solution:
      'Roomを使用して、DataStreamのpublishのoptions.typeに"p2p"を指定してください',
  },
  publicationNotHasOrigin: {
    name: 'publicationNotHasOrigin',
    detail: 'SFURoomで操作するPublicationはOriginをもつ必要があります',
    solution: 'SFURoomとP2PRoomを同一のIDで混在させていないか確かめてください',
  },
  notFound: {
    name: 'notFound',
    detail: '参照しようとしていたものが見つかりません',
    solution: '参照しようとしたものが存在するか確かめてください',
  },
  invalidPublicationTypeForP2PRoom: {
    name: 'invalidPublicationTypeForP2PRoom',
    detail: 'P2PRoomでSFUのPublicationをpublishすることは出来ません',
    solution: 'publishのoptions.typeに"p2p"を指定してください',
  },
  invalidPublicationTypeForSFURoom: {
    name: 'invalidPublicationTypeForSFURoom',
    detail: 'SFURoomでP2PのPublicationをpublishすることは出来ません',
    solution: 'publishのoptions.typeに"sfu"を指定してください',
  },
} as const;

export const errors = { ...coreErrors, ...sfuErrors, ...roomErrors } as const;
