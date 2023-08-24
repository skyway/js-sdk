import { Event } from '@skyway-sdk/common';
import model from '@skyway-sdk/model';

import { SkyWayChannel } from '../../channel';
import { SkyWayContext } from '../../context';
import { LocalPersonImpl } from '../../member/localPerson';
import { RemoteMemberImplInterface } from '../../member/remoteMember';

/**@internal */
export abstract class SkyWayPlugin {
  subtype!: string;
  /**@internal */
  _context?: SkyWayContext;
  /**@internal */
  _onContextAttached = new Event<SkyWayContext>();

  /**@internal */
  _attachContext(context: SkyWayContext) {
    this._context = context;
    this._onContextAttached.emit(context);
  }

  /**@internal */
  _whenCreateLocalPerson?: (member: LocalPersonImpl) => Promise<void>;

  /**@internal */
  _whenDisposeLocalPerson?: (member: LocalPersonImpl) => Promise<void>;

  /**@internal */
  abstract _createRemoteMember(
    channel: SkyWayChannel,
    memberDto: model.Member
  ): RemoteMemberImplInterface;
}
