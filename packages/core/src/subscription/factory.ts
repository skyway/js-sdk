import type model from '@skyway-sdk/model';

import type { SkyWayChannelImpl } from '../channel';
import type { RemoteMemberImplInterface } from '../member/remoteMember';
import { SubscriptionImpl } from '.';

/**@internal */
export function createSubscription(
  channel: SkyWayChannelImpl,
  { subscriberId, publicationId, id }: model.Subscription,
): SubscriptionImpl {
  const exist = channel._getSubscription(id);
  if (exist) return exist;

  const subscriber = channel._getMember(
    subscriberId,
  ) as RemoteMemberImplInterface;
  const publication = channel._getPublication(publicationId);
  const contentType = publication.contentType;

  const subscription = new SubscriptionImpl({
    channel,
    id,
    subscriber,
    publication,
    contentType,
  });

  return subscription;
}
