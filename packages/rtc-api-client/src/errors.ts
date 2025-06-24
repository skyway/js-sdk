import { errors as rpcError } from '@skyway-sdk/rtc-rpc-api-client';

export const errors = {
  ...rpcError,
  invalidParameter: { name: 'invalidParameter', detail: '', solution: '' },
  notFound: { name: 'notFound', detail: '', solution: '' },
  timeout: { name: 'timeout', detail: '', solution: '' },
  internalError: {
    name: 'internalError',
    detail: '',
    solution: '',
  },
  invalidRequestParameter: {
    name: 'invalidRequestParameter',
    detail: 'リクエストのパラメーターが正しくありません',
    solution: 'API仕様を確認し正しい値を入力してください',
  },
  insufficientPermissions: {
    name: 'insufficientPermissions',
    detail: 'tokenの権限が不足しています Token permissions are insufficient',
    solution:
      'Tokenに必要な権限を加えてください Add the necessary permissions to the Token',
  },
  publicationNestedTooMuch: {
    name: 'publicationNestedTooMuch',
    detail:
      'originが設定されているPublicationをPublicationのoriginに指定することは出来ません It is not possible to specify the origin of a publication for which Origin has been set',
    solution:
      '仕様上の制約なので解決法はありません There is no solution because it is a specification limitation',
  },
  channelNotFound: {
    name: 'channelNotFound',
    detail:
      '参照しようとしたchannelは存在しません The channel you tried to reference does not exist.',
    solution:
      'channelIdやchannelNameが正しいか確かめてください Make sure that the Channel id and channel name are correct.',
  },
  memberNotFound: {
    name: 'memberNotFound',
    detail:
      '参照しようとしたMemberは存在しません The member you tried to reference does not exist.',
    solution:
      'memberIdやmemberNameが正しいか確かめてください Make sure that the member id and member name is correct.',
  },
  publicationNotFound: {
    name: 'publicationNotFound',
    detail:
      '参照しようとしたPublicationは存在しません The Publication you tried to reference does not exist.',
    solution:
      'publicationIdが正しいか確かめてください Make sure that the publication id is correct.',
  },
  subscriptionNotFound: {
    name: 'subscriptionNotFound',
    detail:
      '参照しようとしたSubscriptionは存在しません The Subscription you tried to reference does not exist.',
    solution:
      'subscriptionIdが正しいか確かめてください Make sure that the subscription id is correct.',
  },
  operationConflicted: {
    name: 'operationConflicted',
    detail:
      '与えられた名前のチャネルは、今までの競合する要求によって、すでに作成されています The channel with the given name has already been created by a conflicting request up to now',
    solution: '別の名前を使ってchannelを作成してください',
  },
  channelNameDuplicated: {
    name: 'channelNameDuplicated',
    detail:
      'その名前のChannelはすでに存在します A channel with that name already exists',
    solution: '別の名前を使ってchannelを作成してください',
  },
  memberNameDuplicated: {
    name: 'memberNameDuplicated',
    detail:
      'その名前のMemberはすでに存在します A member with that name already exists',
    solution: '別の名前を使ってmemberを作成してください',
  },
  subscriptionAlreadyExists: {
    name: 'subscriptionAlreadyExists',
    detail: 'PublicationはすでにSubscribeされています',
    solution: 'publicationIdが正しいか確かめてください',
  },
  rateLimitExceeded: {
    name: 'rateLimitExceeded',
    detail: 'リソースを規定仕様以上に消費しています',
    solution: 'リソースの消費量を減らしてください',
  },
  projectUsageLimitExceeded: {
    name: 'projectUsageLimitExceeded',
    detail: 'フリープランプロジェクトのリソース利用上限に達しています',
    solution: 'エンタープライズプランにアップグレードしてください',
  },
  invalidAuthToken: {
    name: 'invalidAuthToken',
    detail: 'AuthTokenが無効です',
    solution: '適切なAuthTokenを使用してください',
  },
  authTokenExpired: {
    name: 'authTokenExpired',
    detail: 'AuthTokenが期限切れです',
    solution: '適切なExpを設定したAuthTokenを使用してください',
  },
  serverBusy: {
    name: 'serverBusy',
    detail: 'サービス側の問題です',
    solution: 'しばらく時間を置いて再試行してください',
  },
} as const;

export type ErrorName = keyof typeof errors;

export const ErrorNames = Object.keys(errors) as ErrorName[];
