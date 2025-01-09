import { z } from 'zod';

import { appScopeSchema } from './scope/v1-2';
import { scopeV3Schema } from './scope/v3';

const authTokenBaseSchema = z.object({
  /** トークンのユニークなid(uuid) */
  jti: z.string().uuid(),
  /** トークンが発行された日時(UNIX timestamp) */
  iat: z.number().nonnegative(),
  /** このトークンが無効になる時間を表すタイムスタンプ(UNIX timestamp) */
  exp: z.number().nonnegative(),
});

const authTokenV1_2Schema = z.intersection(
  authTokenBaseSchema,
  z.object({
    /**
     * tokenの権限を表すクレーム[version:1,2,undefined]
     * */
    scope: z.object({
      app: appScopeSchema,
    }),
    /**
     * tokenのバージョン[version:1,2,undefined]
     * - 未指定やundefinedの場合は1として扱われます。
     * - 3の場合とでscopeの構造に違いがあります。
     * */
    version: z
      .union([z.literal(1), z.literal(2), z.literal(undefined)])
      .optional(),
  })
);
export type AuthTokenV1_2 = z.input<typeof authTokenV1_2Schema>;

const authTokenV3Schema = z.intersection(
  authTokenBaseSchema,
  z.object({
    /**
     * tokenの権限を表すクレーム[version:3]
     * */
    scope: scopeV3Schema,
    /**
     * tokenのバージョン[version:3]
     * - 2以下の場合とでscopeの構造に違いがあります。
     * */
    version: z.literal(3),
  })
);
export type AuthTokenV3 = z.input<typeof authTokenV3Schema>;

/**@internal */
export const AuthTokenSchema = z.union([
  authTokenV1_2Schema,
  authTokenV3Schema,
]);
export type AuthToken = z.input<typeof AuthTokenSchema>;
