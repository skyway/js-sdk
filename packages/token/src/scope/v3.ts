import { z } from 'zod';
import { passthroughObject } from './passthrough';

// 公開する型は zod の型推論に依存しないよう明示的に定義している。
// 詳細は ./sfu.ts を参照。

const memberMethods = ['publish', 'subscribe', 'updateMetadata'] as const;
const memberScopeV3SchemaBase = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });
const memberScopeV3Schema = z.intersection(
  memberScopeV3SchemaBase,
  passthroughObject({
    methods: z.array(
      // 型補完のため enum で定義しておく
      z
        .enum(memberMethods)
        .refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては MemberMethod 以外の文字列も許容する
        }),
    ),
  }),
);
export type MemberScopeV3 = {
  /**
   * id (id または name のどちらかが必須 *)
   * - id で対象の member を指定
   * - '*' を指定することで、すべての member を指定
   */
  id?: string | undefined;
  /**
   * name (id または name のどちらかが必須 *)
   * - name で対象の member を指定
   * - '*' を指定することで、すべての member を指定
   */
  name?: string | undefined;
} & {
  /**
   * 以下を複数指定可能
   * - publish: media/dataのpublish
   * - subscribe: media/dataのsubscribe
   * - updateMetadata: metadata の編集
   */
  methods: ('updateMetadata' | 'publish' | 'subscribe')[];
} & { [k: string]: unknown };

const roomMethods = ['create', 'close', 'updateMetadata'] as const;
const roomScopeV3SchemaBase = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });

/**@internal */
export type RoomScopeV3Base = {
  /**
   * - id または name のどちらかが必須。
   * - id で対象の room を指定。
   * - '*' を指定することで、すべての room を指定。
   * */
  id?: string | undefined;
  /**
   * - id または name のどちらかが必須。
   * - name で対象の room を指定。
   * - '*' を指定することで、すべての room を指定。
   * */
  name?: string | undefined;
};

const roomScopeV3Schema = z.intersection(
  roomScopeV3SchemaBase,
  passthroughObject({
    methods: z.array(
      // 型補完のため enum で定義しておく
      z
        .enum(roomMethods)
        .refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては RoomMethod 以外の文字列も許容する
        }),
    ),
    member: memberScopeV3Schema.optional(),
    sfu: z
      .object({
        enabled: z.boolean().optional(),
        maxSubscribersLimit: z.number().optional(),
      })
      .optional(),
    stt: z
      .object({
        enabled: z.boolean().optional(),
      })
      .optional(),
  }),
);
export type RoomScopeV3 = {
  /**
   * - id または name のどちらかが必須。
   * - id で対象の room を指定。
   * - '*' を指定することで、すべての room を指定。
   * */
  id?: string | undefined;
  /**
   * - id または name のどちらかが必須。
   * - name で対象の room を指定。
   * - '*' を指定することで、すべての room を指定。
   * */
  name?: string | undefined;
} & {
  /**
   * 以下を複数指定可能
   * - create: 作成
   * - close: 削除
   * - updateMetadata: metadata の編集
   */
  methods: ('create' | 'updateMetadata' | 'close')[];
  /** memberリソースに関するオブジェクトを指定 */
  member?: MemberScopeV3 | undefined;
  sfu?:
    | {
        /**SFUサーバーの利用有無。enabledがfalseの場合はSFUサーバーを利用したメディア通信を行わない。指定しない場合は enabled: true として扱われる。 */
        enabled?: boolean | undefined;
        /**maxSubscribersの上限値の設定。指定しない場合はSFUサーバー側において設定可能な上限値になる。*/
        maxSubscribersLimit?: number | undefined;
      }
    | undefined;
  stt?:
    | {
        /**文字起こし機能の利用有無。enabledがfalseの場合は文字起こし機能を利用できない。指定しない場合は enabled: true として扱われる。 */
        enabled?: boolean | undefined;
      }
    | undefined;
} & { [k: string]: unknown };

/**@internal */
export const scopeV3Schema = passthroughObject({
  appId: z.string(),
  analytics: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  noiseCancelling: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  turn: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  rooms: z.array(roomScopeV3Schema),
});

/**version 3 のトークンにおける権限を表すスコープ */
export type ScopeV3 = {
  /**アプリケーションIDを指定 */
  appId: string;
  /**AnalyticsDashboardへのデータ送信をするかどうかの設定。指定しない場合は enabled: true として扱われる。 */
  analytics?:
    | {
        enabled?: boolean | undefined;
      }
    | undefined;
  /**AI Noise Cancellerの認可を有効化するかどうかの設定。設定しない場合は enabled: true として扱われる。 */
  noiseCancelling?:
    | {
        enabled?: boolean | undefined;
      }
    | undefined;
  /**TURNサーバー利用の設定。enabledがfalseの場合はTURNサーバーを経由してメディア通信を行わない。指定しない場合は enabled: true として扱われる。 */
  turn?:
    | {
        enabled?: boolean | undefined;
      }
    | undefined;
  /**roomリソースに関するオブジェクトを配列で指定*/
  rooms: RoomScopeV3[];
} & { [k: string]: unknown };
