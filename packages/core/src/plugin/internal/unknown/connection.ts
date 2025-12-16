import { Event, Logger } from '@skyway-sdk/common';

import type { LocalPersonImpl } from '../../../member/localPerson';
import type { RemoteMemberImplInterface } from '../../../member/remoteMember';
import type { PublicationImpl } from '../../../publication';
import type { SubscriptionImpl } from '../../../subscription';
import type { SkyWayConnection } from '../../interface';

const log = new Logger(
  'packages/core/src/plugin/internal/unknown/connection.ts',
);

export class UnknownConnection implements SkyWayConnection {
  readonly type: string = 'unknown';
  readonly onDisconnect = new Event<void>();
  readonly onClose = new Event<void>();
  closed = false;

  constructor(
    readonly localPerson: LocalPersonImpl,
    readonly remoteMember: RemoteMemberImplInterface,
  ) {}

  close() {
    this.closed = true;
    this.onClose.emit();
  }

  async startPublishing(publication: PublicationImpl) {
    log.debug(
      `this is unknown type connection. should install ${this.remoteMember.subtype} plugin`,
      { publication },
    );
  }

  async stopPublishing(publication: PublicationImpl) {
    log.debug(
      `this is unknown type connection. should install ${this.remoteMember.subtype} plugin`,
      { publication },
    );
  }

  async startSubscribing(subscription: SubscriptionImpl) {
    log.debug(
      `this is unknown type connection. should install ${this.remoteMember.subtype} plugin`,
      { subscription },
    );
  }

  async stopSubscribing(subscription: SubscriptionImpl) {
    log.debug(
      `this is unknown type connection. should install ${this.remoteMember.subtype} plugin`,
      { subscription },
    );
  }
}
