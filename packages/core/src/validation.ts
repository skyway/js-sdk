const NAME_REGEX = /^[A-Za-z0-9\-._%*]{1,128}$/;

/**@internal */
export function isValidName(input: unknown): boolean {
  if (input === undefined) return true;

  // 文字列でない場合は無効
  if (typeof input !== 'string') return false;

  // "*" 単体は無効
  if (input === '*') return false;

  // 正規表現にマッチしない場合は無効
  if (!NAME_REGEX.test(input)) return false;

  // すべてのチェックをパスしたら有効
  return true;
}
