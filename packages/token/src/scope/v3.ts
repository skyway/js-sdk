import { z } from 'zod';

const memberMethods = ['publish', 'subscribe', 'updateMetadata'] as const;
const memberScopeV3SchemaBase = z
  .object({
    /**
     * id (id または name のどちらかが必須 *)
     * - id で対象の member を指定
     * - '*' を指定することで、すべての member を指定
     */
    id: z.string().optional(),
    /**
     * name (id または name のどちらかが必須 *)
     * - name で対象の member を指定
     * - '*' を指定することで、すべての member を指定
     */
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });
const memberScopeV3Schema = z.intersection(
  memberScopeV3SchemaBase,
  z
    .object({
      /**
       * 以下を複数指定可能
       * - publish: media/dataのpublish
       * - subscribe: media/dataのsubscribe
       * - updateMetadata: metadata の編集
       */
      methods: z.array(
        // 型補完のため enum で定義しておく
        z.enum(memberMethods).refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては MemberMethod 以外の文字列も許容する
        })
      ),
    })
    .passthrough()
);
export type MemberScopeV3 = z.input<typeof memberScopeV3Schema>;

const roomMethods = ['create', 'close', 'updateMetadata'] as const;
const roomScopeV3SchemaBase = z
  .object({
    /**
     * - id または name のどちらかが必須。
     * - id で対象の room を指定。
     * - '*' を指定することで、すべての room を指定。
     * */
    id: z.string().optional(),
    /**
     * - id または name のどちらかが必須。
     * - name で対象の room を指定。
     * - '*' を指定することで、すべての room を指定。
     * */
    name: z.string().optional(),
  })
  .refine((arg) => arg.id !== undefined || arg.name !== undefined, {
    message: 'Either id or name is required.',
  });

const roomScopeV3Schema = z.intersection(
  roomScopeV3SchemaBase,
  z
    .object({
      /**
       * 以下を複数指定可能
       * - create: 作成
       * - close: 削除
       * - updateMetadata: metadata の編集
       */
      methods: z.array(
        // 型補完のため enum で定義しておく
        z.enum(roomMethods).refine((arg) => {
          return typeof arg === 'string'; // バリデーションとしては RoomMethod 以外の文字列も許容する
        })
      ),
      /** memberリソースに関するオブジェクトを指定 */
      member: memberScopeV3Schema.optional(),
      sfu: z
        .object({
          /**SFUサーバーの利用有無。enabledがfalseの場合はSFUサーバーを利用したメディア通信を行わない。指定しない場合は enabled: true として扱われる。 */
          enabled: z.boolean().optional(),
          /**maxSubscribersの上限値の設定。指定しない場合はSFUサーバー側において設定可能な上限値になる。*/
          maxSubscribersLimit: z.number().optional(),
        })
        .optional(),
    })
    .passthrough()
);
export type RoomScopeV3 = z.input<typeof roomScopeV3Schema>;

/**@internal */
export const scopeV3Schema = z
  .object({
    /**アプリケーションIDを指定 */
    appId: z.string(),
    /**AnalyticsDashboardへのデータ送信をするかどうかの設定。指定しない場合は enabled: true として扱われる。 */
    analytics: z
      .object({
        enabled: z.boolean().optional(),
      })
      .optional(),
    /**AI Noise Cancellerの認可を有効化するかどうかの設定。設定しない場合は enabled: true として扱われる。 */
    noiseCancelling: z
      .object({
        enabled: z.boolean().optional(),
      })
      .optional(),
    /**TURNサーバー利用の設定。enabledがfalseの場合はTURNサーバーを経由してメディア通信を行わない。指定しない場合は enabled: true として扱われる。 */
    turn: z
      .object({
        enabled: z.boolean().optional(),
      })
      .optional(),
    /**roomリソースに関するオブジェクトを配列で指定*/
    rooms: z.array(roomScopeV3Schema),
  })
  .passthrough();

export type ScopeV3 = z.input<typeof scopeV3Schema>;
