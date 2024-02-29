import { Logger } from '@skyway-sdk/common';

import { errors } from '../../../errors';
import { RemoteMemberImplInterface } from '../../../member/remoteMember';
import { PublicationImpl } from '../../../publication';
import { SubscriptionImpl } from '../../../subscription';
import { createError } from '../../../util';
import type { LocalPersonImpl } from '../../localPerson';

const log = new Logger('packages/core/src/dataPlane/agent/publishing.ts');

export class PublishingAgent {
  readonly context = this._localPerson.context;
  constructor(private readonly _localPerson: LocalPersonImpl) {}

  /**@throws {SkyWayError} */
  async startPublishing(subscription: SubscriptionImpl): Promise<void> {
    if (this.context.config.internal.disableDPlane) {
      await new Promise((r) => setTimeout(r, 500));
      return;
    }
    const publication: PublicationImpl = subscription.publication;
    const endpoint: RemoteMemberImplInterface = subscription.subscriber;

    // タイミング的にstreamのセットが完了していない可能性がある
    if (!publication.stream) {
      await this._localPerson.onStreamPublished
        .watch(
          (e) => e.publication.id === publication.id,
          this.context.config.rtcApi.timeout
        )
        .catch((error) => {
          throw createError({
            operationName: 'PublishingAgent.startPublishing',
            context: this.context,
            channel: this._localPerson.channel,
            info: {
              ...errors.timeout,
              detail: 'PublishingAgent onStreamPublished',
            },
            path: log.prefix,
            payload: { publication },
            error,
          });
        });
    }

    const connection = endpoint._getOrCreateConnection(this._localPerson);

    if (connection.startPublishing) {
      await connection.startPublishing(publication, subscription.id);
    }
  }

  async stopPublishing(
    publication: PublicationImpl,
    endpoint: RemoteMemberImplInterface
  ) {
    const connection = endpoint._getConnection(this._localPerson.id);
    if (connection?.stopPublishing) {
      connection.stopPublishing(publication).catch((err) => {
        log.error('stopPublishing failed', err);
      });
    }
  }
}
