import { Event, Events, Logger } from '@skyway-sdk/common';
import model from '@skyway-sdk/model';

import { Channel, SkyWayChannelImpl } from '../channel';
import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { LocalStream } from '../media/stream';
import {
  RemoteAudioStream,
  RemoteDataStream,
  RemoteVideoStream,
} from '../media/stream';
import { Publication } from '../publication';
import { Subscription } from '../subscription';
import { createError, createLogPayload } from '../util';

const log = new Logger('packages/core/src/member/index.ts');

export interface Member {
  id: string;
  name?: string;
  channel: Channel;
  type: MemberType;
  subtype: string;
  side: MemberSide;
  metadata?: string;
  state: MemberState;

  // events

  /**@description [japanese] Channelから離脱したときに発火するイベント */
  onLeft: Event<void>;
  /**@description [japanese] Metadataが変化したときに発火するイベント */
  onMetadataUpdated: Event<string>;
  /**@description [japanese] このMemberのPublicationのリスト */
  publications: Publication<LocalStream>[];
  /**@description [japanese] このMemberのSubscriptionのリスト */
  subscriptions: Subscription<
    RemoteVideoStream | RemoteAudioStream | RemoteDataStream
  >[];

  /**
   * @description [japanese] metadataを更新する
   */
  updateMetadata: (metadata: string) => Promise<void>;
  /**
   * @description [japanese] memberをChannelから退去させる
   */
  leave: () => Promise<void>;
}

/**@internal */
export abstract class MemberImpl implements Member {
  readonly channel: SkyWayChannelImpl;
  readonly id: string;
  readonly name?: string;
  readonly type!: MemberType;
  readonly context: SkyWayContext;
  abstract readonly side: MemberSide;
  readonly subtype!: string;
  private _metadata?: string;
  private _state: MemberState = 'joined';

  /**@internal */
  readonly _events = new Events();
  readonly onLeft = this._events.make<void>();
  readonly onMetadataUpdated = this._events.make<string>();

  constructor(args: {
    channel: SkyWayChannelImpl;
    name?: string;
    id: string;
    metadata?: string;
    context: SkyWayContext;
  }) {
    this.channel = args.channel;
    this.id = args.id;
    this.name = args.name;
    this._metadata = args.metadata;
    this.context = args.context;
  }

  get metadata() {
    return this._metadata;
  }

  get state() {
    return this._state;
  }

  get publications() {
    return this.channel.publications.filter((p) => p.publisher.id === this.id);
  }
  get subscriptions() {
    return this.channel.subscriptions.filter(
      (p) => p.subscriber.id === this.id
    );
  }

  /**@internal */
  toJSON(): model.Member {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      subtype: this.subtype,
      metadata: this.metadata,
    };
  }

  /** @private*/
  _left() {
    this._state = 'left';

    this.onLeft.emit();
    this._events.dispose();
  }

  /** @private*/
  _metadataUpdated(metadata: string) {
    this._metadata = metadata;

    this.onMetadataUpdated.emit(metadata);
  }

  async updateMetadata(metadata: string) {
    await this.channel._updateMemberMetadata(this.id, metadata);
  }

  /**@throws {@link SkyWayError} */
  async leave() {
    const timestamp = log.info(
      '[start] leave',
      await createLogPayload({
        operationName: 'localPerson.leave',
        channel: this.channel,
      })
    );
    if (this.state === 'left') {
      throw createError({
        operationName: 'localPerson.leave',
        info: errors.localPersonNotJoinedChannel,
        path: log.prefix,
        context: this.context,
        channel: this.channel,
      });
    }
    await this.channel.leave(this);
    log.elapsed(timestamp, '[end] leave');
  }
}

export type MemberState = 'joined' | 'left';
export type MemberType = 'person' | 'bot';
export type MemberSide = 'local' | 'remote';
