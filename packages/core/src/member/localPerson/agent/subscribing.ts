import { SubscriptionImpl } from '../../../subscription';
import type { LocalPersonImpl } from '../../localPerson';

export class SubscribingAgent {
  private _disposers: { [subscriptionId: string]: () => void } = {};
  private _context = this._localPerson.context;
  constructor(private readonly _localPerson: LocalPersonImpl) {}

  async startSubscribing(subscription: SubscriptionImpl): Promise<void> {
    if (this._context.config.internal.disableDPlane) {
      await new Promise((r) => setTimeout(r, 500));
      return;
    }

    const publisher = subscription.publication.publisher;
    const connection = publisher._getOrCreateConnection(this._localPerson);

    if (connection.startSubscribing) {
      await connection.startSubscribing(subscription);

      const { removeListener } = subscription._onChangeEncoding.add(
        async () => {
          await connection.changePreferredEncoding?.(subscription);
        }
      );
      this._disposers[subscription.id] = removeListener;
    }
  }

  async stopSubscribing(subscription: SubscriptionImpl) {
    const publisher = subscription.publication.publisher;
    const connection = publisher._getConnection(this._localPerson.id);

    if (connection?.stopSubscribing) {
      await connection.stopSubscribing(subscription);
      this._disposers[subscription.id]?.();
    }
  }
}
