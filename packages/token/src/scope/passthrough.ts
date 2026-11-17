import { z } from 'zod';

/**
 * 未知のキーをそのまま通す（passthrough）オブジェクトスキーマを返す。
 *
 * zod 3 の `z.object(shape).passthrough()` は、shape にない未知のキーの値が `undefined` の場合、
 * そのキーを出力から取り除く。zod 4 では値が `undefined` のキーとして残るため、従来の挙動に揃える。
 * shape にあるキーは従来どおり、入力に存在すれば値が `undefined` でも出力に残る。
 */
export const passthroughObject = <Shape extends z.ZodRawShape>(
  shape: Shape,
) => {
  const knownKeys = new Set(Object.keys(shape));
  return z
    .object(shape)
    .passthrough()
    .transform((value) => {
      const result = { ...value };
      for (const key of Object.keys(result)) {
        if (
          !knownKeys.has(key) &&
          (result as Record<string, unknown>)[key] === undefined
        ) {
          delete (result as Record<string, unknown>)[key];
        }
      }
      return result;
    });
};
