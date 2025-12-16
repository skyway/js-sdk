import type { SkyWayConnection } from '../plugin/interface';
import type { Member, MemberImpl } from '.';
import type { LocalPersonImpl } from './localPerson';

export interface RemoteMember extends Member {
  readonly side: 'remote';
}

/**@internal */
export interface RemoteMemberImplInterface extends MemberImpl {
  readonly side: 'remote';

  _getConnection: (localPersonId: string) => SkyWayConnection | undefined;
  _getOrCreateConnection: (localPerson: LocalPersonImpl) => SkyWayConnection;
  _dispose: () => void;
}

/**@internal */
export function isRemoteMember(
  member: Member,
): member is RemoteMemberImplInterface {
  if (member.side === 'remote') {
    return true;
  }
  return false;
}
