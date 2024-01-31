import { SfuScope } from './sfu';

export type AppScope = {
  /**アプリケーションIDを指定 */
  id: string;
  /**AnalyticsDashboardへのデータ送信をするかどうかの設定 */
  analytics?: boolean;
  /**アプリケーション自体に関する権限。現在は'read'固定 */
  actions?: readonly AppAction[];
  /**channelリソースに関するオブジェクトを配列で指定*/
  channels?: ChannelScope[];
  /**falseの場合はTurnサーバを経由してメディア通信を行いません。 */
  turn?: boolean;
};

/**@internal */
export const AppActions = ['listChannels', 'read', 'write'] as const;
export type AppAction = (typeof AppActions)[number];

export type ChannelScope = {
  /**
   * - id または name のどちらかが必須。
   * - id で対象の channel を指定。
   * - '*' を指定することで、すべての channel を指定。
   * */
  id?: string;
  /**
   * - id または name のどちらかが必須。
   * - name で対象の channel を指定。
   * - '*' を指定することで、すべての channel を指定。
   * */
  name?: string;
  /**
   * 以下を複数指定可能
   * - write: すべて可能
   * - read: 参照
   * - create: 作成
   * - delete: 削除
   * - updateMetadata: metadata の編集
   */
  actions: readonly ChannelAction[];
  /**member リソースに関するオブジェクトを配列で指定 */
  members: MemberScope[];
  /**sfuBot リソースに関するオブジェクトを配列で指定 */
  sfuBots?: SfuScope[];
  [key: string]: unknown;
};
/**@internal */
export const ChannelActions = [
  'write',
  'read',
  'create',
  'delete',
  'updateMetadata',
] as const;
export type ChannelAction = (typeof ChannelActions)[number];

export type MemberScope = {
  /**
   * id (id または name のどちらかが必須 *)
   * - id で対象の member を指定
   * - '*' を指定することで、すべての member を指定
   */
  id?: string;
  /**
   * name (id または name のどちらかが必須 *)
   * - name で対象の channel を指定
   * - '*' を指定することで、すべての member を指定
   */
  name?: string;
  /**
   * 以下を複数指定可能
   * - write: すべて可能
   * - create: 入室（入室時に member が作成される）
   * - delete: 退室（入室時に member が削除される）
   * - signal: シグナリング情報のやり取り (p2p通信を利用する際に必須)
   * - updateMetadata: metadata の編集
   */
  actions: readonly MemberAction[];
  /**publication リソースに関するオブジェクトを指定*/
  publication?: PublicationScope;
  /**subscription リソースに関するオブジェクトを指定*/
  subscription?: SubscriptionScope;
};
/**@internal */
export const MemberActions = [
  'write',
  'create',
  'delete',
  'updateMetadata',
  'signal',
] as const;
export type MemberAction = (typeof MemberActions)[number];

export type PublicationScope = {
  /**
   * 以下を複数指定可能
   * - write: すべて可能
   * - create: publish（publish時に publication が作成される）
   * - delete: unpublish（unpublish時に publication が削除される）
   * - updateMetadata: metadata の編集
   * - enable: enable
   * - disable: disable
   */
  actions: readonly PublicationAction[];
};
/**@internal */
export const PublicationActions = [
  'write',
  'create',
  'delete',
  'updateMetadata',
  'enable',
  'disable',
] as const;
export type PublicationAction = (typeof PublicationActions)[number];

export type SubscriptionScope = {
  /**
   * 以下を複数指定可能
   * - write: すべて可能
   * - create: subscribe（subscribe時に subscription が作成される）
   * - delete: unsubscribe（unsubscribe時に subscription が削除される）
   */
  actions: readonly SubscriptionAction[];
};
/**@internal */
export const SubscriptionActions = ['write', 'create', 'delete'] as const;
export type SubscriptionAction = (typeof SubscriptionActions)[number];
