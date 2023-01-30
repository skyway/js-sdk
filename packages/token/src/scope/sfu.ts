export type SfuScope = {
  // id: string;
  /**
   * 以下を複数指定可能
   * - write: 作成、削除
   * - create: 作成
   * - delete: 削除
   */
  actions: readonly SfuBotAction[];
  /**forwarding リソースに関するオブジェクトを指定（forwardingオブジェクトについては後述） */
  forwardings: ForwardingScope[];
};
/**@internal */
export const SfuBotActions = ['create', 'write', 'delete'] as const;
export type SfuBotAction = (typeof SfuBotActions)[number];

export type ForwardingScope = {
  /**
   * 以下を複数指定可能
   * - write: 作成、削除
   * - create: 作成 (任意のメディアをSFU経由で新たに転送することができる)
   * - delete: 削除 (SFU経由でのメディア転送を取りやめることができる)
   */
  actions: readonly ForwardingAction[];
  /**subscription リソースに関するオブジェクトを指定*/
  subscription?: SfuSubscriptionScope;
};
/**@internal */
export const ForwardingActions = ['create', 'write', 'delete'] as const;
export type ForwardingAction = (typeof ForwardingActions)[number];

export type SfuSubscriptionScope = {
  /**
   * 以下を複数指定可能
   * - write: subscribe、unsubscribe
   * - create: subscribe（subscribe時に subscription が作成される）
   * - delete: unsubscribe（unsubscribe時に subscription が削除される）
   */
  actions: readonly SfuSubscriptionAction[];
};
/**@internal */
export const SfuSubscriptionActions = ['create', 'write', 'delete'] as const;
export type SfuSubscriptionAction = (typeof SfuSubscriptionActions)[number];
