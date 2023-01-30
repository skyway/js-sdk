import model from '@skyway-sdk/model';

import { SkyWayChannelImpl } from '../../../channel';
import { SkyWayPlugin } from '../../interface/plugin';
import { UnknownMemberImpl } from './member';

export class UnknownPlugin extends SkyWayPlugin {
  readonly subtype = 'unknown';

  readonly _createRemoteMember = (
    channel: SkyWayChannelImpl,
    memberDto: model.Member
  ) => {
    const person = new UnknownMemberImpl({
      ...this._context,
      context: this._context!,
      channel,
      metadata: memberDto.metadata,
      id: memberDto.id,
      name: memberDto.name,
      plugin: this,
      subtype: memberDto.subtype,
    });
    return person;
  };
}
