import { secret } from '../../../env';
import { nowInSec } from '../dist';
import {
  AppActions,
  ChannelActions,
  ChannelScope,
  ForwardingActions,
  MemberActions,
  PublicationActions,
  SfuBotActions,
  SfuSubscriptionActions,
  SkyWayAuthToken,
  SubscriptionActions,
  uuidV4,
} from '../src';

const token = new SkyWayAuthToken({
  jti: uuidV4(),
  iat: nowInSec(),
  exp: nowInSec() + 60 * 60,
  scope: {
    app: {
      id: uuidV4(),
      actions: AppActions,
      channels: [...new Array(10)].map(
        () =>
          ({
            name: uuidV4(),
            actions: ChannelActions,
            members: [
              {
                name: uuidV4(),
                actions: MemberActions,
                publication: { actions: PublicationActions },
                subscription: { actions: SubscriptionActions },
              },
            ],
            sfuBots: [
              {
                actions: SfuBotActions,
                forwardings: [
                  {
                    actions: ForwardingActions,
                    subscription: { actions: SfuSubscriptionActions },
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
