import { SkyWayChannelImpl } from '../../../channel';
import { SkyWayContext } from '../../../context';
import { MemberImpl } from '../../../member';
import { LocalPersonImpl } from '../../../member/localPerson';
import { RemoteMemberImplInterface } from '../../../member/remoteMember';
import { UnknownConnection } from './connection';
import { UnknownPlugin } from './plugin';

export class UnknownMemberImpl
  extends MemberImpl
  implements RemoteMemberImplInterface
{
  readonly type = 'bot';
  readonly subtype: string;
  readonly side = 'remote';
  readonly plugin: UnknownPlugin;

  private _connections: { [localPersonSystemId: string]: UnknownConnection } =
    {};

  constructor(args: {
    channel: SkyWayChannelImpl;
    name?: string;
    id: string;
    metadata?: string;
    plugin: UnknownPlugin;
    subtype: string;
    context: SkyWayContext;
  }) {
    super(args);

    this.plugin = args.plugin;
    this.subtype = args.subtype;
  }

  /**@private */
  _getConnection(localPersonId: string): UnknownConnection | undefined {
    return this._connections[localPersonId];
  }

  /**@private */
  _getOrCreateConnection(localPerson: LocalPersonImpl): UnknownConnection {
    const connection =
      this._getConnection(localPerson.id) ??
      this._createConnection(localPerson, this);
    return connection;
  }

  private _createConnection(
    localPerson: LocalPersonImpl,
    endpointMember: RemoteMemberImplInterface
  ): UnknownConnection {
    return new UnknownConnection(localPerson, endpointMember);
  }

  _dispose() {}
}
