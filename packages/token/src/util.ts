import { Logger, SkyWayError } from '@skyway-sdk/common';
import { type AuthToken, type RoomScopeV3Base, tokenErrors } from '.';

const log = new Logger('packages/token/src/util.ts');

/**@private */
export const nowInSec = () => Math.floor(Date.now() / 1000);

/**@internal */
function matchId(
  // 指定されてない場合は `*` として扱う（何でもマッチする）
  queryId = '*',
  id?: string,
): boolean {
  if (queryId === '*') {
    return true;
  }

  // queryId が指定されているにも関わらず、id がない場合は NG
  if (id === undefined) {
    return false;
  }

  return queryId === id;
}

/**@internal */
function matchName(
  tokenVersion: AuthToken['version'],
  // 指定されてない場合は `*` として扱う（何でもマッチする）
  queryName = '*',
  name?: string,
): boolean {
  if (queryName === '*') {
    return true;
  }

  switch (tokenVersion) {
    case 1:
      // queryName が指定されているにも関わらず、name がない場合は NG
      if (name === undefined) {
        return false;
      }
      // 完全一致の場合マッチしていると判定する
      return queryName === name;
    case 2:
    case 3:
      // v2, 3 の場合、`*` を部分一致として解釈し、一致している場合マッチしていると判定する
      return matchVersion2ScopeName(queryName, name);
    default: {
      // should never reach here
      throw new SkyWayError({
        path: log.prefix,
        info: tokenErrors.invalidParameter,
        error: new Error(
          `invalid token version: version ${tokenVersion} is not supported.`,
        ),
      });
    }
  }
}

/**@internal */
function matchVersion2ScopeName(query: string, name?: string): boolean {
  const m = query.match(/\*/g);
  if (m && m.length > 8) {
    return false;
  }

  // nameがundefinedの場合は、tokenName文字列が*でのみ構成されている場合のみtrue
  if (name === undefined) {
    if (query.match(/^\**$/)) {
      return true;
    }
    return false;
  }

  const replacedName = query
    .replace(/\./g, '\\.') // 「.」をエスケープ
    .replace(/\*/g, '.*') // *を「.*」に置換
    .replace(/\\\.\*/g, '\\*'); // 「\.*」を「\*」に置換
  const regex = new RegExp(`^${replacedName}$`);
  return regex.test(name);
}

/**@internal */
export function matchScopeIdentifier(
  query: RoomScopeV3Base,
  channelIdentifier: RoomScopeV3Base,
  tokenVersion: AuthToken['version'],
): boolean {
  return (
    matchId(channelIdentifier.id, query.id) &&
    matchName(tokenVersion, channelIdentifier.name, query.name)
  );
}
