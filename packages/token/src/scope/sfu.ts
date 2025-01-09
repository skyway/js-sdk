import { z } from 'zod';

const forwardingActions = ['create', 'write', 'delete'] as const;
const forwardingScopeSchema = z
  .object({
    /**
     * 以下を複数指定可能
     * - write: Forwarding のすべての操作
     * - create: Forwarding の作成 (任意のメディアをSFU経由で新たに転送することができる)
     * - delete: Forwarding の削除 (SFU経由でのメディア転送を取りやめることができる)
     */
    actions: z.array(
      // 型補完のため enum で定義しておく
      z.enum(forwardingActions).refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては ForwardingAction 以外の文字列も許容する
      })
    ),
  })
  .passthrough();
export type ForwardingScope = z.input<typeof forwardingScopeSchema>;

const sfuBotActions = ['create', 'write', 'delete'] as const;
/**@internal */
export const sfuScopeSchema = z
  .object({
    /**
     * 以下を複数指定可能
     * - write: SFU Bot のすべての操作をすることができる
     * - create: SFU Bot の作成ができる
     * - delete: SFU Bot の削除ができる
     */
    actions: z.array(
      // 型補完のため enum で定義しておく
      z.enum(sfuBotActions).refine((arg) => {
        return typeof arg === 'string'; // バリデーションとしては SfuBotAction 以外の文字列も許容する
      })
    ),
    /**forwarding リソースに関するオブジェクトを指定（forwardingオブジェクトについては後述） */
    forwardings: z.array(forwardingScopeSchema),
  })
  .passthrough();
export type SfuScope = z.input<typeof sfuScopeSchema>;
