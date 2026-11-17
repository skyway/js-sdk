import { z } from 'zod';

import { type AppScope, appScopeSchema } from './scope/v1-2';
import { type ScopeV3, scopeV3Schema } from './scope/v3';

// 公開する型は zod の型推論に依存しないよう明示的に定義している。
// 詳細は ./scope/sfu.ts を参照。

const authTokenBaseSchema = z.object({
  // zod 3 の uuid() と同じく、8-4-4-4-12 の16進数の形式のみを検証する。
  // zod 4 の uuid() は RFC のバージョン・バリアントまで検証するため、従来受け入れていた jti が拒否されてしまう。
  jti: z.guid(),
  iat: z.number().nonnegative(),
  exp: z.number().nonnegative(),
});

const authTokenV1_2Schema = z.intersection(
  authTokenBaseSchema,
  z.object({
    scope: z.object({
      app: appScopeSchema,
    }),
    version: z
      .union([z.literal(1), z.literal(2), z.literal(undefined)])
      .optional(),
  }),
);
export type AuthTokenV1_2 = {
  /** トークンのユニークなid(uuid) */
  jti: string;
  /** トークンが発行された日時(UNIX timestamp) */
  iat: number;
  /** このトークンが無効になる時間を表すタイムスタンプ(UNIX timestamp) */
  exp: number;
} & {
  /**
   * tokenの権限を表すクレーム[version:1,2,undefined]
   * */
  scope: {
    app: AppScope;
  };
  /**
   * tokenのバージョン[version:1,2,undefined]
   * - 未指定やundefinedの場合は1として扱われます。
   * - 3の場合とでscopeの構造に違いがあります。
   * */
  version?: 1 | 2 | undefined;
};

const authTokenV3Schema = z.intersection(
  authTokenBaseSchema,
  z.object({
    scope: scopeV3Schema,
    version: z.literal(3),
  }),
);
export type AuthTokenV3 = {
  /** トークンのユニークなid(uuid) */
  jti: string;
  /** トークンが発行された日時(UNIX timestamp) */
  iat: number;
  /** このトークンが無効になる時間を表すタイムスタンプ(UNIX timestamp) */
  exp: number;
} & {
  /**
   * tokenの権限を表すクレーム[version:3]
   * */
  scope: ScopeV3;
  /**
   * tokenのバージョン[version:3]
   * - 2以下の場合とでscopeの構造に違いがあります。
   * */
  version: 3;
};

/**@internal */
export const AuthTokenSchema = z.union([
  authTokenV1_2Schema,
  authTokenV3Schema,
]);
/**SkyWay Auth Token。version 1, 2 系と version 3 系のいずれかの構造をとる */
export type AuthToken = AuthTokenV1_2 | AuthTokenV3;
