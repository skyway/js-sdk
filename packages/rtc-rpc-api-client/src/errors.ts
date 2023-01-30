import type { ResponseError } from './rpc';

export const errors = {
  timeout: { name: 'timeout', detail: '', solution: '' },
  internalError: { name: 'internalError', detail: '', solution: '' },
  invalidParameter: { name: 'invalidParameter', detail: '', solution: '' },
  connectionDisconnected: {
    name: 'connectionDisconnected',
    detail: '',
    solution: '',
  },
  websocketConnectionFailure: {
    name: 'connectionFailure',
    detail: 'サーバへの接続に失敗しました',
    solution: 'ネットワーク接続状況を確認してください',
  },
  rpcResponseError: {
    name: 'rpcResponseError',
    detail: '',
    solution: '',
    error: {} as ResponseError,
  },
  onClosedWhileRequesting: {
    name: 'onClosedWhileRequesting',
    detail: 'request中にクライアントが終了されました',
    solution: 'リクエストの完了を確認してからクライアントを終了させてください',
  },
  failedToConnectRtcAPI: {
    name: 'failedToConnectRtcAPI',
    detail: 'rtc-api serverへの接続に失敗しました',
    solution: 'インターネット接続状況とTokenの内容が正しいかを確かめてください',
  },
  failedToUpdateMemberTTL: {
    name: 'failedToUpdateMemberTTL',
    detail: 'updateMemberTTLを再試行しましたが、失敗しました',
    solution: 'インターネット接続状況を確認してください',
  },
} as const;
