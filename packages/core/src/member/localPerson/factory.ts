import { Logger } from '@skyway-sdk/common';
import model from '@skyway-sdk/model';

import { PersonInit, SkyWayChannelImpl } from '../../channel';
import { MaxIceParamServerTTL } from '../../const';
import { SkyWayContext } from '../../context';
import { errors } from '../../errors';
import { setupSignalingSession } from '../../external/signaling';
import { LocalPersonImpl } from '.';
import { IceManager } from '../../external/ice';
import { createError } from '../../util';

const log = new Logger('packages/core/src/member/person/local/factory.ts');

/**@internal */
export async function createLocalPerson(
  context: SkyWayContext,
  channel: SkyWayChannelImpl,
  memberDto: model.Member,
  {
    keepaliveIntervalSec,
    keepaliveIntervalGapSec,
    disableSignaling,
  }: PersonInit = {}
) {
  log.debug('createLocalPerson', {
    channel,
    memberDto,
    keepaliveIntervalSec,
    keepaliveIntervalGapSec,
  });

  const { iceParamServer } = context.config;

  const signalingSession =
    disableSignaling === true
      ? undefined
      : await setupSignalingSession(context, channel, memberDto);

  const iceManager = new IceManager({
    ...iceParamServer,
    memberId: memberDto.id,
    channelId: channel.id,
    ttl: MaxIceParamServerTTL,
    context,
  });

  await iceManager.updateIceParams().catch((err) => {
    throw createError({
      operationName: 'createLocalPerson',
      context,
      channel,
      info: { ...errors.internal, detail: 'updateIceParams failed' },
      path: log.prefix,
      error: err,
    });
  });

  const person = await LocalPersonImpl.Create({
    iceManager,
    channel,
    signaling: signalingSession,
    metadata: memberDto.metadata,
    name: memberDto.name,
    id: memberDto.id,
    keepaliveIntervalSec,
    keepaliveIntervalGapSec,
    context,
  });

  for (const plugin of context.plugins) {
    await plugin._whenCreateLocalPerson?.(person);
    person._onDisposed.once(async () => {
      await plugin._whenDisposeLocalPerson?.(person);
    });
  }

  return person;
}
