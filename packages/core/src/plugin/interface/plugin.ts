import { Event } from '@skyway-sdk/common';
import type model from '@skyway-sdk/model';

import type { SkyWayChannel } from '../../channel';
import type { SkyWayContext } from '../../context';
import type { LocalPersonImpl } from '../../member/localPerson';
import type { RemoteMemberImplInterface } from '../../member/remoteMember';

export interface SkyWayPluginInterface {
  subtype: string;
}

/**@internal */
export abstract class SkyWayPlugin implements SkyWayPluginInterface {
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
    memberDto: model.Member,
  ): RemoteMemberImplInterface;
}
