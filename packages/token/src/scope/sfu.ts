import { z } from 'zod';
import { passthroughObject } from './passthrough';

// 公開する型は zod の型推論に依存しないよう明示的に定義している。
// zod のメジャーバージョンによって推論結果（index signature の表現や optional の `| undefined` の有無）が変わり、
// 配布する型定義（.d.ts）の出力が変わってしまうため。
// スキーマとの整合は __tests__/scope/public-types.test.ts で担保している。

const forwardingActions = ['create', 'write', 'delete'] as const;
const forwardingScopeSchema = passthroughObject({
  actions: z.array(
    // 型補完のため enum で定義しておく
    z
      .enum(forwardingActions)
      .refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては ForwardingAction 以外の文字列も許容する
      }),
  ),
});
export type ForwardingScope = {
  /**
   * 以下を複数指定可能
   * - write: Forwarding のすべての操作
   * - create: Forwarding の作成 (任意のメディアをSFU経由で新たに転送することができる)
   * - delete: Forwarding の削除 (SFU経由でのメディア転送を取りやめることができる)
   */
  actions: ('create' | 'write' | 'delete')[];
} & { [k: string]: unknown };

const sfuBotActions = ['create', 'write', 'delete'] as const;
/**@internal */
export const sfuScopeSchema = passthroughObject({
  actions: z.array(
    // 型補完のため enum で定義しておく
    z
      .enum(sfuBotActions)
      .refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては SFUBotAction 以外の文字列も許容する
      }),
  ),
  forwardings: z.array(forwardingScopeSchema),
});
/**sfuBot リソースに対する権限を表すスコープ */
export type SFUScope = {
  /**
   * 以下を複数指定可能
   * - write: SFU Bot のすべての操作をすることができる
   * - create: SFU Bot の作成ができる
   * - delete: SFU Bot の削除ができる
   */
  actions: ('create' | 'write' | 'delete')[];
  /**forwarding リソースに関するオブジェクトを指定（forwardingオブジェクトについては後述） */
  forwardings: ForwardingScope[];
} & { [k: string]: unknown };
