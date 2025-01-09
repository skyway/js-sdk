import { errors as apiErrors } from '@skyway-sdk/sfu-api-client';

export const errors = {
  ...apiErrors,
  invalidParameter: { name: 'invalidParameter', detail: '', solution: '' },
  timeout: { name: 'timeout', detail: '', solution: '' },
  internal: { name: 'internal', detail: '', solution: '' },
  sfuBotNotInChannel: {
    name: 'sfuBotNotInChannel',
    detail: 'SfuBotがChannelに存在しません',
    solution: '操作しようとしているSfuBotが正しいか確かめてください',
  },
  remotePublisherId: {
    name: 'remotePublisherId',
    detail: 'publisherがremoteのPublicationをForwardingすることはできません',
    solution: 'PublicationがLocalでPublishされたものか確かめてください',
  },
  dataStreamNotSupported: {
    name: 'dataStreamNotSupported',
    detail: 'dataStreamはSFUに対応していません',
    solution: 'ありません',
  },
  streamNotExistInPublication: {
    name: 'streamNotExistInPublication',
    detail:
      'PublicationにStreamがありません。RemoteMemberのPublicationのStreamにはアクセスできません',
    solution: '参照しているPublicationが目的のものか確かめてください。',
  },
  invalidPreferredEncoding: {
    name: 'invalidPreferredEncoding',
    detail:
      'preferredEncodingの値が不正です。エンコード設定切り替え機能が使えません',
    solution: '正しい文字列を入力してください',
  },
  invalidEncodings: {
    name: 'invalidEncodings',
    detail:
      'エンコード設定が設定されていません。エンコード設定切り替え機能が使えません',
    solution:
      'エンコード設定切り替え機能を利用する場合はエンコード設定をしたPublicationをForwardingしてください',
  },
  receiverNotFound: {
    name: 'receiverNotFound',
    detail: 'SFUはRemoteMemberのSubscriptionを操作できません',
    solution:
      'SFUでsubscriptionの操作をする際にはLocalPersonがSubscribeしているSubscriptionインスタンスを利用してください',
  },
  consumerNotFound: {
    name: 'consumerNotFound',
    detail: 'SFUはLocalPersonがUnsubscribeしたSubscriptionを操出来ません',
    solution: '操作対象のSubscriptionが正しいか確かめてください',
  },
  forwardingNotFound: {
    name: 'forwardingNotFound',
    detail: '存在しないForwardingを操作しようとしています',
    solution: '対象のForwardingが正しいか確かめてください',
  },
  netWorkError: {
    name: 'netWorkError',
    detail: '通信環境に問題があります',
    solution: 'ネットワーク接続状況を確認してください',
  },
  confirmSubscriptionFailed: {
    name: 'confirmSubscriptionFailed',
    detail: 'Forwardingのconsume許可を出すのに失敗しました',
    solution: 'ありません',
  },
} as const;
