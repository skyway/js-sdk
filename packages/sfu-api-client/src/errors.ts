export const errors = {
  invalidParameter: { name: 'invalidParameter', detail: '', solution: '' },
  invalidRequestParameter: {
    name: 'invalidRequestParameter',
    detail: 'リクエストの値が不正です',
    solution: '正しい値を入力してください',
  },
  notFound: {
    name: 'notFound',
    detail: '対象のリソースが見つかりません',
    solution: '対象のリソースが存在するか確かめてください',
  },
  maxSubscriberExceededError: {
    name: 'maxSubscribersExceededError',
    detail:
      'forwardingのmaxSubscribersの制限を超えています。maxSubscribersの値を超えてSubscribeすることはできません',
    solution: 'maxSubscribersの範囲内でご利用ください',
  },
  quotaExceededError: {
    name: 'quotaExceededError',
    detail: 'リソースの制限量を超えてリソースを利用することはできません',
    solution: 'リソース制限量の範囲内でご利用ください',
  },
  timeout: { name: 'timeout', detail: '', solution: '' },
  insufficientPermissions: {
    name: 'insufficientPermissions',
    detail: 'tokenの権限が不足しています',
    solution: 'tokenに必要な権限を付与してください',
  },
  backendError: { name: 'backendError:', detail: '', solution: '' },
  notAllowedConsumeError: {
    name: 'notAllowedConsumeError',
    detail: 'ForwardingからのConsume許可がありません',
    solution: 'Forwardingしているmemberによる許可操作が必要です',
  },
} as const;
