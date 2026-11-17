import { z } from 'zod';
import { passthroughObject } from './passthrough';
import { type SFUScope, sfuScopeSchema } from './sfu';

// 公開する型は zod の型推論に依存しないよう明示的に定義している。
// 詳細は ./sfu.ts を参照。

const publicationActions = [
  'write',
  'create',
  'delete',
  'updateMetadata',
  'enable',
  'disable',
] as const;
const publicationScopeSchema = passthroughObject({
  actions: z.array(
    // 型補完のため enum で定義しておく
    z
      .enum(publicationActions)
      .refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては publicationAction 以外の文字列も許容する
      }),
  ),
});
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
  actions: (
    | 'create'
    | 'write'
    | 'delete'
    | 'updateMetadata'
    | 'enable'
    | 'disable'
  )[];
} & { [k: string]: unknown };

const subscriptionActions = ['write', 'create', 'delete'] as const;
const subscriptionScopeSchema = passthroughObject({
  actions: z.array(
    // 型補完のため enum で定義しておく
    z
      .enum(subscriptionActions)
      .refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては subscriptionAction 以外の文字列も許容する
      }),
  ),
});
export type SubscriptionScope = {
  /**
   * 以下を複数指定可能
   * - write: すべて可能
   * - create: subscribe（subscribe時に subscription が作成される）
   * - delete: unsubscribe（unsubscribe時に subscription が削除される）
   */
  actions: ('create' | 'write' | 'delete')[];
} & { [k: string]: unknown };

export const memberActions = [
  'write',
  'create',
  'delete',
  'updateMetadata',
  'signal',
] as const;

const memberScopeSchemaBase = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });

const memberScopeSchema = z.intersection(
  memberScopeSchemaBase,
  passthroughObject({
    actions: z.array(
      // 型補完のため enum で定義しておく
      z
        .enum(memberActions)
        .refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては memberAction 以外の文字列も許容する
        }),
    ),
    publication: publicationScopeSchema.optional(),
    subscription: subscriptionScopeSchema.optional(),
  }),
);
export type MemberScope = {
  /**
   * id (id または name のどちらかが必須 *)
   * - id で対象の member を指定
   * - '*' を指定することで、すべての member を指定
   */
  id?: string | undefined;
  /**
   * name (id または name のどちらかが必須 *)
   * - name で対象の channel を指定
   * - '*' を指定することで、すべての member を指定
   */
  name?: string | undefined;
} & {
  /**
   * 以下を複数指定可能
   * - write: すべて可能
   * - create: 入室（入室時に member が作成される）
   * - delete: 退室（入室時に member が削除される）
   * - signal: シグナリング情報のやり取り (p2p通信を利用する際に必須)
   * - updateMetadata: metadata の編集
   */
  actions: ('create' | 'write' | 'delete' | 'updateMetadata' | 'signal')[];
  /**publication リソースに関するオブジェクトを指定*/
  publication?: PublicationScope | undefined;
  /**subscription リソースに関するオブジェクトを指定*/
  subscription?: SubscriptionScope | undefined;
} & { [k: string]: unknown };

const channelActions = [
  'write',
  'read',
  'create',
  'delete',
  'updateMetadata',
] as const;

const channelScopeSchemaBase = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });
const channelScopeSchema = z.intersection(
  channelScopeSchemaBase,
  passthroughObject({
    actions: z.array(
      // 型補完のため enum で定義しておく
      z
        .enum(channelActions)
        .refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては channelAction 以外の文字列も許容する
        }),
    ),
    members: z.array(memberScopeSchema),
    sfuBots: z.array(sfuScopeSchema).optional(),
  }), // [key: string]: unknown; として他のkeyを許容していた部分
);

export type ChannelScope = {
  /**
   * id (id または name のどちらかが必須 *)
   * - id で対象の member を指定
   * - '*' を指定することで、すべての member を指定
   */
  id?: string | undefined;
  /**
   * name (id または name のどちらかが必須 *)
   * - name で対象の channel を指定
   * - '*' を指定することで、すべての member を指定
   */
  name?: string | undefined;
} & {
  /**
   * 以下を複数指定可能
   * - write: すべて可能
   * - read: 参照
   * - create: 作成
   * - delete: 削除
   * - updateMetadata: metadata の編集
   */
  actions: ('create' | 'write' | 'delete' | 'updateMetadata' | 'read')[];
  /**member リソースに関するオブジェクトを配列で指定 */
  members: MemberScope[];
  /**sfuBot リソースに関するオブジェクトを配列で指定 */
  sfuBots?: SFUScope[] | undefined;
} & { [k: string]: unknown };

const appActions = ['read'] as const;
/**@internal */
export const appScopeSchema = passthroughObject({
  id: z.string(),
  analytics: z.boolean().optional(),
  actions: z
    .array(
      // 型補完のため enum で定義しておく
      z
        .enum(appActions)
        .refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては AppAction 以外の文字列も許容する
        }),
    )
    .optional(),
  channels: z.array(channelScopeSchema).optional(),
  turn: z.boolean().optional(),
});

/**version 1, 2 のトークンにおける、アプリケーションに対する権限を表すスコープ */
export type AppScope = {
  /**アプリケーションIDを指定 */
  id: string;
  /**AnalyticsDashboardへのデータ送信をするかどうかの設定 */
  analytics?: boolean | undefined;
  /**アプリケーション自体に関する権限。現在は'read'固定 */
  actions?: 'read'[] | undefined;
  /**channelリソースに関するオブジェクトを配列で指定*/
  channels?: ChannelScope[] | undefined;
  /**falseの場合はTurnサーバを経由してメディア通信を行いません。 */
  turn?: boolean | undefined;
} & { [k: string]: unknown };
