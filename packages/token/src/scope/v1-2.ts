import { z } from 'zod';

import { sfuScopeSchema } from './sfu';

const publicationActions = [
  'write',
  'create',
  'delete',
  'updateMetadata',
  'enable',
  'disable',
] as const;
const publicationScopeSchema = z
  .object({
    /**
     * 以下を複数指定可能
     * - write: すべて可能
     * - create: publish（publish時に publication が作成される）
     * - delete: unpublish（unpublish時に publication が削除される）
     * - updateMetadata: metadata の編集
     * - enable: enable
     * - disable: disable
     */
    actions: z.array(
      // 型補完のため enum で定義しておく
      z.enum(publicationActions).refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては publicationAction 以外の文字列も許容する
      })
    ),
  })
  .passthrough();
export type PublicationScope = z.input<typeof publicationScopeSchema>;

const subscriptionActions = ['write', 'create', 'delete'] as const;
const subscriptionScopeSchema = z
  .object({
    /**
     * 以下を複数指定可能
     * - write: すべて可能
     * - create: subscribe（subscribe時に subscription が作成される）
     * - delete: unsubscribe（unsubscribe時に subscription が削除される）
     */
    actions: z.array(
      // 型補完のため enum で定義しておく
      z.enum(subscriptionActions).refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては subscriptionAction 以外の文字列も許容する
      })
    ),
  })
  .passthrough();
export type SubscriptionScope = z.input<typeof subscriptionScopeSchema>;

export const memberActions = [
  'write',
  'create',
  'delete',
  'updateMetadata',
  'signal',
] as const;

const memberScopeSchemaBase = z
  .object({
    /**
     * id (id または name のどちらかが必須 *)
     * - id で対象の member を指定
     * - '*' を指定することで、すべての member を指定
     */
    id: z.string().optional(),
    /**
     * name (id または name のどちらかが必須 *)
     * - name で対象の channel を指定
     * - '*' を指定することで、すべての member を指定
     */
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });

const memberScopeSchema = z.intersection(
  memberScopeSchemaBase,
  z
    .object({
      /**
       * 以下を複数指定可能
       * - write: すべて可能
       * - create: 入室（入室時に member が作成される）
       * - delete: 退室（入室時に member が削除される）
       * - signal: シグナリング情報のやり取り (p2p通信を利用する際に必須)
       * - updateMetadata: metadata の編集
       */
      actions: z.array(
        // 型補完のため enum で定義しておく
        z.enum(memberActions).refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては memberAction 以外の文字列も許容する
        })
      ),
      /**publication リソースに関するオブジェクトを指定*/
      publication: publicationScopeSchema.optional(),
      /**subscription リソースに関するオブジェクトを指定*/
      subscription: subscriptionScopeSchema.optional(),
    })
    .passthrough()
);
export type MemberScope = z.input<typeof memberScopeSchema>;

const channelActions = [
  'write',
  'read',
  'create',
  'delete',
  'updateMetadata',
] as const;

const channelScopeSchemaBase = z
  .object({
    /**
     * id (id または name のどちらかが必須 *)
     * - id で対象の member を指定
     * - '*' を指定することで、すべての member を指定
     */
    id: z.string().optional(),
    /**
     * name (id または name のどちらかが必須 *)
     * - name で対象の channel を指定
     * - '*' を指定することで、すべての member を指定
     */
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });
const channelScopeSchema = z.intersection(
  channelScopeSchemaBase,
  z
    .object({
      /**
       * 以下を複数指定可能
       * - write: すべて可能
       * - read: 参照
       * - create: 作成
       * - delete: 削除
       * - updateMetadata: metadata の編集
       */
      actions: z.array(
        // 型補完のため enum で定義しておく
        z.enum(channelActions).refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては channelAction 以外の文字列も許容する
        })
      ),
      /**member リソースに関するオブジェクトを配列で指定 */
      members: z.array(memberScopeSchema),
      /**sfuBot リソースに関するオブジェクトを配列で指定 */
      sfuBots: z.array(sfuScopeSchema).optional(),
    })
    .passthrough() // [key: string]: unknown; として他のkeyを許容していた部分
);

export type ChannelScope = z.input<typeof channelScopeSchema>;

const appActions = ['listChannels', 'read', 'write'] as const;
/**@internal */
export const appScopeSchema = z
  .object({
    /**アプリケーションIDを指定 */
    id: z.string(),
    /**AnalyticsDashboardへのデータ送信をするかどうかの設定 */
    analytics: z.boolean().optional(),
    /**アプリケーション自体に関する権限。現在は'read'固定 */
    actions: z
      .array(
        // 型補完のため enum で定義しておく
        z.enum(appActions).refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては AppAction 以外の文字列も許容する
        })
      )
      .optional(),
    /**channelリソースに関するオブジェクトを配列で指定*/
    channels: z.array(channelScopeSchema).optional(),
    /**falseの場合はTurnサーバを経由してメディア通信を行いません。 */
    turn: z.boolean().optional(),
  })
  .passthrough();

export type AppScope = z.input<typeof appScopeSchema>;
