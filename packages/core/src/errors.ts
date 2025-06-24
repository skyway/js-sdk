export const errors = {
  internal: {
    name: 'internal',
    detail: '',
    solution: '',
  },
  timeout: { name: 'timeout', detail: '', solution: '' },
  missingProperty: { name: 'missingProperty', detail: '', solution: '' },
  notFound: { name: 'notFound', detail: '', solution: '' },
  invalidParameter: { name: 'invalidParameter', detail: '', solution: '' },
  invalidArgumentValue: {
    name: 'invalidArgumentValue',
    detail: '引数の値が不正です',
    solution: '正しい値を引数に渡してください',
  },
  invalidContentType: {
    name: 'invalidContentType',
    detail: 'contentTypeが正しくありません',
    solution: 'ContentTypeを確認してください',
  },
  localPersonNotJoinedChannel: {
    name: 'localPersonNotJoinedChannel',
    detail:
      '操作しようとしたPersonがChannelに居ないので、操作できません The person who tried to operate is not in the channel, so the operation is not possible',
    solution:
      'Channelに居ないPersonを操作している可能性があるので確認してください Please check as you may be operating a person which is not in the channel',
  },
  alreadyLocalPersonExist: {
    name: 'alreadyLocalPersonExist',
    detail:
      'ChannelにすでにLocalPersonが存在します。一つのChannelインスタンスにはLocalPersonが一つしかJoinできません',
    solution:
      '複数のLocalPersonを用意したい場合は個別にChannelインスタンスを用意してください。',
  },
  alreadySameNameMemberExist: {
    name: 'alreadySameNameMemberExist',
    detail: 'Channelにすでに同じNameのMemberが存在します',
    solution: '別のNameを使用してください',
  },
  alreadyPublishedStream: {
    name: 'alreadyPublishedStream',
    detail:
      'すでにPublishしたStreamを再度Publishすることはできません You cannot re-publish a stream that has already been published',
    solution:
      'そのStreamをPublishしたPublicationをUnpublishするか、別の新しいStreamを作ってPublishしてください Unpublish the publication that published that stream, or create another new stream and publish it',
  },
  alreadySubscribedPublication: {
    name: 'alreadySubscribedPublication',
    detail: 'すでにSubscribeしたPublicationをSubscribeすることはできません',
    solution: 'ありません',
  },
  invalidTrackKind: {
    name: 'invalidTrackKind',
    detail: 'Streamの種類とMediaStreamTrackの種類が一致しません',
    solution: 'Streamの種類と同じMediaStreamTrackを利用してください',
  },

  cantMoveSameIdChannel: {
    name: 'cantMoveSameIdChannel',
    detail: 'moveChannelで同じidのChannelに移動することは出来ません',
    solution: '移動先のChannelが正しいか確かめてください',
  },
  alreadyChannelClosed: {
    name: 'alreadyChannelClosed',
    detail: 'ChannelがすでにCloseされています',
    solution: 'ありません',
  },
  disabledDataStream: {
    name: 'disabledDataStream',
    detail: '関連するPublicationがDisableなDataStreamには書き込みできません',
    solution: '関連するPublicationをEnableしてから書き込んでください',
  },
  publicationNotExist: {
    name: 'publicationNotExist',
    detail: 'channelに該当するPublicationが存在しません',
    solution: 'publicationIdが正しいか確かめてください',
  },
  subscriptionNotExist: {
    name: 'subscriptionNotExist',
    detail: 'channelに該当するSubscriptionが存在しません',
    solution: 'subscriptionIdが正しいか確かめてください',
  },
  unknownMemberType: {
    name: 'unknownMemberType',
    detail: '対象のMemberのSubtypeのプラグインが登録されていません',
    solution:
      '対象のMemberのSubtypeのプラグイン(SfuBotなど)をSkyWayContextに登録してください',
  },
  streamNotExistInSubscription: {
    name: 'streamNotExistInSubscription',
    detail:
      'SubscriptionにStreamがありません。RemoteMemberのSubscriptionのStreamにはアクセスできません',
    solution: '参照しているSubscriptionが目的のものか確かめてください。',
  },
  streamNotExistInPublication: {
    name: 'streamNotExistInPublication',
    detail:
      'PublicationにStreamがありません。RemoteMemberのPublicationのStreamにはアクセスできません',
    solution: '参照しているPublicationが目的のものか確かめてください。',
  },
  dataStreamNotSupportEncoding: {
    name: 'dataStreamNotSupportEncoding',
    detail: 'dataStreamはEncode設定の変更に対応していません',
    solution: 'ありません',
  },
  correspondingEncodeNotExistForId: {
    name: 'correspondingEncodeNotExistForId',
    detail: '指定されたIDに対応するEncode設定が存在しません',
    solution: '正しいEncodingIDを指定してください',
  },
  updateIceParamsFailed: {
    name: 'updateIceParamsFailed',
    detail: 'iceParamsの更新に失敗しました',
    solution: 'ありません',
  },
  invalidElement: {
    name: 'invalidElement',
    detail: '渡されたHTML Elementが正しくありません',
    solution: '要求された正しいElementを渡してください',
  },
  connectRtcApiFailed: {
    name: 'connectRtcApiFailed',
    detail: 'RtcAPIへの接続に失敗しました',
    solution: 'インターネットへ接続できているか、もしくはTokenのパラメータが正しいかを確かめてください',
  },
  rtcApiFatalError: {
    name: 'rtcApiFatalError',
    detail: 'RtcAPIの回復不能なエラーです。サーバー側の問題の可能性があります',
    solution: 'インターネットへの接続が出来ているかを確かめてください',
  },
  invalidExpireTokenValue: {
    name: 'invalidExpireTokenValue',
    detail: 'tokenのExpire時刻が不正です',
    solution: '正しい時刻を指定してください',
  },
  invalidRemindExpireTokenValue: {
    name: 'invalidRemindExpireTokenValue',
    detail: 'tokenのExpireをリマインドする時間の値が不正です',
    solution: '正しい時間を指定してください',
  },
  invalidTokenAppId: {
    name: 'invalidTokenAppId',
    detail: 'tokenのappIdが正しくありません',
    solution: '正しいappIdを含むTokenを使用してください',
  },
  mediaDevicesNotFound: {
    name: 'mediaDevicesNotFound',
    detail: 'navigator.mediaDevicesがみつかりません',
    solution:
      'アプリケーションをhttps,localhost,127.0.0.1のいずれかの環境で動作させてください',
  },
  canNotUseReplaceStream: {
    name: 'canNotUseReplaceStream',
    detail: 'remoteのPublicationからreplaceStreamできません',
    solution: '対象のPublicationがLocalのものか確認してください',
  },
  canNotEnableRemotePublication: {
    name: 'canNotEnableRemotePublication',
    detail: 'remoteのPublicationをenableすることはできません',
    solution: '対象のPublicationがLocalのものか確認してください',
  },
} as const;
