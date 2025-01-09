import { secret } from '../../../env';
import { nowInSec } from '../dist';
import {
  ChannelScope,
  SkyWayAuthToken,
  uuidV4,
} from '../src';

const token = new SkyWayAuthToken({
  version: 1,
  jti: uuidV4(),
  iat: nowInSec(),
  exp: nowInSec() + 60 * 60,
  scope: {
    app: {
      id: uuidV4(),
      actions: ['read'],
      channels: [...new Array(10)].map(
        () =>
          ({
            name: uuidV4(),
            actions: ['write'],
            members: [
              {
                name: uuidV4(),
                actions: ['write'],
                publication: { actions: ['write'] },
                subscription: { actions: ['write'] },
              },
            ],
            sfuBots: [
              {
                actions: ['write'],
                forwardings: [
                  {
                    actions: ['write'],
                    subscription: { actions: ['write'] },
                  },
                ],
              },
            ],
          } as ChannelScope)
      ),
      turn: true,
    },
  },
});
const str = token.encode(secret);
console.log(Buffer.from(str).length);