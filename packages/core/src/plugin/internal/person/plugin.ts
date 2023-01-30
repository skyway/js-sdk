import model from '@skyway-sdk/model';

import { SkyWayChannelImpl } from '../../../channel';
import { SkyWayContext } from '../../../context';
import { LocalPersonImpl } from '../../../member/localPerson';
import { SkyWayPlugin } from '../../interface/plugin';
import { MessageBuffer } from './connection/messageBuffer';
import { RemotePersonImpl } from './member';

export class PersonPlugin extends SkyWayPlugin {
  readonly subtype = 'person';
  _messageBuffers: { [localPersonId: string]: MessageBuffer } = {};

  readonly _whenCreateLocalPerson = async (person: LocalPersonImpl) => {
    if (person._signaling) {
      this._messageBuffers[person.id] = new MessageBuffer(person._signaling);
    }
  };

  readonly _whenDisposeLocalPerson = async (person: LocalPersonImpl) => {
    const messageBuffer = this._messageBuffers[person.id];
    if (messageBuffer) {
      messageBuffer.close();
      delete this._messageBuffers[person.id];
    }
  };

  readonly _createRemoteMember = (
    channel: SkyWayChannelImpl,
    memberDto: model.Member
  ) => {
    const person = new RemotePersonImpl({
      ...this._context,
      context: this._context!,
      channel,
      metadata: memberDto.metadata,
      id: memberDto.id,
      name: memberDto.name,
      plugin: this,
    });
    return person;
  };
}

export const registerPersonPlugin = (context: SkyWayContext) => {
  const plugin = new PersonPlugin();
  context.registerPlugin(plugin);
  return plugin;
};
