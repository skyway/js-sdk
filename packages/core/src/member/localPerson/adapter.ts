import { Events, SkyWayError } from '@skyway-sdk/common';

import { LocalStream } from '../../media/stream';
import { RemoteAudioStream } from '../../media/stream/remote/audio';
import { RemoteDataStream } from '../../media/stream/remote/data';
import { RemoteVideoStream } from '../../media/stream/remote/video';
import { Publication } from '../../publication';
import { Subscription } from '../../subscription';
import {
  LocalPerson,
  LocalPersonImpl,
  PublicationOptions,
  SubscriptionOptions,
} from '.';

/**@internal */
export class LocalPersonAdapter implements LocalPerson {
  get keepaliveIntervalSec() {
    return this._impl.keepaliveIntervalSec;
  }
  get keepaliveIntervalGapSec() {
    return this._impl.keepaliveIntervalGapSec;
  }
  get disableSignaling() {
    return this._impl.disableSignaling;
  }
  get type() {
    return this._impl.type;
  }
  get subtype() {
    return this._impl.subtype;
  }
  get side() {
    return this._impl.side;
  }
  get id() {
    return this._impl.id;
  }
  get name() {
    return this._impl.name;
  }
  get channel() {
    return this._impl.channel;
  }
  get metadata() {
    return this._impl.metadata;
  }
  get state() {
    return this._impl.state;
  }
  get publications() {
    return this._impl.publications;
  }
  get subscriptions() {
    return this._impl.subscriptions;
  }

  private _events = new Events();
  readonly onLeft = this._events.make<void>();
  readonly onMetadataUpdated = this._events.make<string>();
  readonly onMemberStateChanged = this._events.make<void>();
  readonly onStreamPublished = this._events.make<{
    publication: Publication;
  }>();
  readonly onStreamUnpublished = this._events.make<{
    publication: Publication;
  }>();
  readonly onPublicationListChanged = this._events.make<void>();
  readonly onPublicationSubscribed = this._events.make<{
    subscription: Subscription;
    stream: RemoteVideoStream | RemoteAudioStream | RemoteDataStream;
  }>();
  readonly onPublicationUnsubscribed = this._events.make<{
    subscription: Subscription;
  }>();
  readonly onSubscriptionListChanged = this._events.make<void>();
  readonly onFatalError = this._events.make<SkyWayError>();

  constructor(
    /**@private */
    public _impl: LocalPersonImpl
  ) {
    this.apply(_impl);
  }

  // localPersonにAdapterを適用する
  apply(person: LocalPersonImpl) {
    this._impl = person;

    person.onLeft.pipe(this.onLeft);
    person.onMetadataUpdated.pipe(this.onMetadataUpdated);
    person.onStreamPublished.pipe(this.onStreamPublished);
    person.onStreamUnpublished.pipe(this.onStreamUnpublished);
    person.onPublicationListChanged.pipe(this.onPublicationListChanged);
    person.onPublicationSubscribed.pipe(this.onPublicationSubscribed);
    person.onPublicationUnsubscribed.pipe(this.onPublicationUnsubscribed);
    person.onSubscriptionListChanged.pipe(this.onSubscriptionListChanged);
    person.onFatalError.pipe(this.onFatalError);
  }

  subscribe<T extends RemoteVideoStream | RemoteAudioStream | RemoteDataStream>(
    publication: string | Publication,
    options?: SubscriptionOptions
  ) {
    return this._impl.subscribe<T>(publication, options);
  }

  unsubscribe(subscription: string | Subscription) {
    return this._impl.unsubscribe(subscription);
  }

  publish<T extends LocalStream>(stream: T, options: PublicationOptions = {}) {
    return this._impl.publish(stream, options);
  }

  unpublish(publication: string | Publication) {
    return this._impl.unpublish(publication);
  }

  updateMetadata(metadata: string) {
    return this._impl.updateMetadata(metadata);
  }

  async leave() {
    await this._impl.leave();
  }

  dispose() {
    this._impl.dispose();
  }
}
