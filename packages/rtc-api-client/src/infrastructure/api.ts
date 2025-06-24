import { Event, Logger, SkyWayError } from '@skyway-sdk/common';
import { Channel, Member, Publication, Subscription } from '@skyway-sdk/model';
import {
  errors as rpcErrors,
  RtcRpcApiClient,
} from '@skyway-sdk/rtc-rpc-api-client';
import { SkyWayAuthToken } from '@skyway-sdk/token';

import {
  ChannelInit,
  ChannelQuery,
  MemberInit,
  PublicationInit,
  RtcApi,
  SubscriptionInit,
} from '../domain/api';
import { errors } from '../errors';
import { createError } from '../util';

const log = new Logger('packages/rtc-api-client/src/infrastructure/api.ts');

export class RtcApiImpl implements RtcApi {
  closed = false;

  readonly onClose = new Event<void>();
  readonly onFatalError = new Event<SkyWayError>();

  private _token = SkyWayAuthToken.Decode(this._client.token);

  constructor(private _client: RtcRpcApiClient) {
    _client.onClose.once(() => {
      this.close();
    });
    _client.onFatalError.add((e) => {
      this.onFatalError.emit(e);
    });
  }

  /** @throws {@link SkyWayError} */
  async connect() {
    await this._client.connect();
  }

  async updateAuthToken(token: string) {
    this._token = SkyWayAuthToken.Decode(token);
    await this._client.updateToken(token).catch((e) => {
      const { info } = e as { info: typeof rpcErrors.rpcResponseError };
      if (info?.error?.data?.code === 429001) {
        throw createError({
          operationName: 'RtcApiImpl.updateAuthToken',
          path: log.prefix,
          info: errors.projectUsageLimitExceeded,
          error: e,
        });
      }
      const error = this._commonError(
        'RtcApiImpl.updateAuthToken',
        info?.error?.code ?? -1,
        e
      );
      if (error) {
        throw error;
      }
      switch (info?.error?.code) {
        case 401:
          throw createError({
            operationName: 'RtcApiImpl.updateAuthToken',
            path: log.prefix,
            info: errors.invalidAuthToken,
            error: e,
          });
        default:
          throw createError({
            operationName: 'RtcApiImpl.updateAuthToken',
            path: log.prefix,
            info: errors.internalError,
            error: e,
          });
      }
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;

    log.debug('closed');

    this._client.close();
    this.onClose.emit();

    this.onClose.removeAllListeners();
  }

  private _commonError(method: string, code: number, detail: any) {
    switch (code) {
      case -32602:
        return createError({
          operationName: method,
          info: errors.invalidRequestParameter,
          path: log.prefix,
          error: detail,
        });
      case -32603:
        return createError({
          operationName: method,
          info: errors.internalError,
          path: log.prefix,
          error: detail,
        });
      case 403:
      case 4030:
        return createError({
          operationName: method,
          info: errors.insufficientPermissions,
          path: log.prefix,
          error: detail,
        });
      case 429:
        return createError({
          operationName: method,
          info: errors.rateLimitExceeded,
          path: log.prefix,
          error: detail,
        });
    }
  }

  /**@throws {@link SkyWayError} */
  async createChannel(
    appId: string,
    channelInit: ChannelInit
  ): Promise<Channel> {
    const { id } = await this._client
      .createChannel({
        appId,
        name: channelInit.name,
        metadata: channelInit.metadata,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.createChannel',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.createChannel',
              path: log.prefix,
              info: errors.channelNotFound,
              error: e,
            });
          case 409:
            throw createError({
              operationName: 'RtcApiImpl.createChannel',
              path: log.prefix,
              info: errors.channelNameDuplicated,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.createChannel',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
    const res = await this.getChannel(appId, { id });
    return res;
  }

  async getChannel(
    appId: string,
    { name, id }: ChannelQuery
  ): Promise<Channel> {
    if (id) {
      return await this._client.getChannel({ appId, id }).catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.getChannel',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.getChannel',
              path: log.prefix,
              info: errors.channelNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.getChannel',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
    }
    if (name) {
      return await this._client.getChannelByName({ appId, name }).catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.getChannel',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'getChannel',
              path: log.prefix,
              info: errors.channelNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'getChannel',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
    }

    throw createError({
      operationName: 'RtcApiImpl.createChannel',
      path: log.prefix,
      info: errors.invalidRequestParameter,
    });
  }

  async findOrCreateChannel(
    appId: string,
    query: ChannelInit
  ): Promise<Channel> {
    return this._client.findOrCreateChannel({ ...query, appId }).catch((e) => {
      const { info } = e as { info: typeof rpcErrors.rpcResponseError };
      const error = this._commonError(
        'RtcApiImpl.findOrCreateChannel',
        info?.error?.code ?? -1,
        e
      );
      if (error) {
        throw error;
      }

      if (query.name && info?.error?.code === 409) {
        return this.getChannel(appId, { name: query.name });
      }

      switch (info?.error?.code) {
        case 404:
          throw createError({
            operationName: 'RtcApiImpl.findOrCreateChannel',
            path: log.prefix,
            info: errors.channelNotFound,
            error: e,
          });
        case 409:
          throw createError({
            operationName: 'RtcApiImpl.findOrCreateChannel',
            path: log.prefix,
            info: errors.channelNameDuplicated,
            error: e,
          });
        default:
          throw createError({
            operationName: 'RtcApiImpl.findOrCreateChannel',
            path: log.prefix,
            info: errors.internalError,
            error: e,
          });
      }
    });
  }

  async deleteChannel(appId: string, id: Channel['id']): Promise<void> {
    await this._client.deleteChannel({ appId, id }).catch((e) => {
      const { info } = e as { info: typeof rpcErrors.rpcResponseError };
      const error = this._commonError(
        'RtcApiImpl.deleteChannel',
        info?.error?.code ?? -1,
        e
      );
      if (error) {
        throw error;
      }
      switch (info?.error?.code) {
        case 404:
          throw createError({
            operationName: 'RtcApiImpl.deleteChannel',
            path: log.prefix,
            info: errors.channelNotFound,
            error: e,
          });
        default:
          throw createError({
            operationName: 'RtcApiImpl.deleteChannel',
            path: log.prefix,
            info: errors.internalError,
            error: e,
          });
      }
    });
  }

  async updateChannelMetadata(
    appId: string,
    id: Channel['id'],
    metadata: string
  ): Promise<void> {
    await this._client
      .updateChannelMetadata({ appId, id, metadata })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.updateChannelMetadata',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.updateChannelMetadata',
              path: log.prefix,
              info: errors.channelNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.updateChannelMetadata',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  async join(appId: string, channelId: Channel['id'], memberInit: MemberInit) {
    const { memberId } = await this._client
      .addMember({
        appId,
        channelId,
        name: memberInit.name,
        metadata: memberInit.metadata,
        ttlSec: memberInit.ttlSec,
        type: memberInit.type,
        subtype: memberInit.subtype,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.addMember',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.addMember',
              path: log.prefix,
              info: errors.channelNotFound,
              error: e,
            });
          case 409:
            throw createError({
              operationName: 'RtcApiImpl.addMember',
              path: log.prefix,
              info: errors.memberNameDuplicated,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.addMember',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });

    const member: Member = {
      id: memberId,
      name: memberInit.name,
      type: memberInit.type,
      subtype: memberInit.subtype,
      metadata: memberInit.metadata,
    };
    return member;
  }

  async updateMemberTtl(
    appId: string,
    channelId: Channel['id'],
    memberId: Member['id'],
    ttlSec: number
  ): Promise<void> {
    await this._client
      .updateMemberTtl({
        appId,
        channelId,
        memberId,
        ttlSec,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.updateMemberTtl',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.updateMemberTtl',
              path: log.prefix,
              info: errors.memberNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.updateMemberTtl',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  /**
   * @returns Date.now()
   */
  async getServerUnixtime(appId: string): Promise<number> {
    return await this._client
      .getServerUnixtime({
        appId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.getServerUnixtime',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        throw createError({
          operationName: 'RtcApiImpl.getServerUnixtime',
          path: log.prefix,
          info: errors.internalError,
          error: e,
        });
      });
  }

  async updateMemberMetadata(
    appId: string,
    channelId: Channel['id'],
    memberId: Member['id'],
    metadata: string
  ): Promise<void> {
    await this._client
      .updateMemberMetadata({
        appId,
        channelId,
        memberId,
        metadata,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.updateMemberMetadata',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.updateMemberMetadata',
              path: log.prefix,
              info: errors.memberNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.updateMemberMetadata',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  async leave(
    appId: string,
    channelId: Channel['id'],
    memberId: Member['id']
  ): Promise<void> {
    await this._client
      .leaveChannel({
        channelId,
        id: memberId,
        appId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.leaveChannel',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.leaveChannel',
              path: log.prefix,
              info: errors.memberNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.leaveChannel',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  /**@throws {@link SkyWayError} */
  async publish(appId: string, init: PublicationInit): Promise<string> {
    const { publicationId } = await this._client
      .publishStream({
        channelId: init.channel,
        publisherId: init.publisher,
        contentType: init.contentType,
        metadata: init.metadata,
        origin: init.origin,
        codecCapabilities: init.codecCapabilities,
        encodings: init.encodings,
        isEnabled: init.isEnabled,
        appId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.publish',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          default:
            throw createError({
              operationName: 'RtcApiImpl.publish',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
    return publicationId;
  }

  async updatePublicationMetadata(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id'],
    metadata: string
  ): Promise<void> {
    await this._client
      .updatePublicationMetadata({
        channelId,
        publicationId,
        metadata,
        appId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.updatePublicationMetadata',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.updatePublicationMetadata',
              path: log.prefix,
              info: errors.publicationNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.updatePublicationMetadata',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  async disablePublication(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id']
  ): Promise<void> {
    await this._client
      .disablePublication({
        channelId,
        publicationId,
        appId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.disablePublication',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.disablePublication',
              path: log.prefix,
              info: errors.publicationNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.disablePublication',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  async enablePublication(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id']
  ): Promise<void> {
    await this._client
      .enablePublication({
        channelId,
        publicationId,
        appId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.enablePublication',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.enablePublication',
              path: log.prefix,
              info: errors.publicationNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.enablePublication',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  async unpublish(
    appId: string,
    channelId: Channel['id'],
    publicationId: Publication['id']
  ): Promise<void> {
    await this._client
      .unpublishStream({ channelId, publicationId, appId })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.unpublishStream',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.unpublishStream',
              path: log.prefix,
              info: errors.publicationNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.unpublishStream',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }

  /**@throws {@link SkyWayError} */
  async subscribe(appId: string, init: SubscriptionInit): Promise<string> {
    const { subscriptionId } = await this._client
      .subscribeStream({
        channelId: init.channel.id,
        subscriberId: init.subscriber.id,
        publicationId: init.publication.id,
        appId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.subscribeStream',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.subscribeStream',
              path: log.prefix,
              info: errors.publicationNotFound,
              error: e,
            });
          case 409:
            throw createError({
              operationName: 'RtcApiImpl.subscribeStream',
              path: log.prefix,
              info: errors.subscriptionAlreadyExists,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.subscribeStream',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
    return subscriptionId;
  }

  async unsubscribe(
    appId: string,
    channelId: Channel['id'],
    subscriptionId: Subscription['id']
  ): Promise<void> {
    await this._client
      .unsubscribeStream({
        appId,
        channelId,
        subscriptionId,
      })
      .catch((e) => {
        const { info } = e as { info: typeof rpcErrors.rpcResponseError };
        const error = this._commonError(
          'RtcApiImpl.unsubscribeStream',
          info?.error?.code ?? -1,
          e
        );
        if (error) {
          throw error;
        }
        switch (info?.error?.code) {
          case 404:
            throw createError({
              operationName: 'RtcApiImpl.unsubscribeStream',
              path: log.prefix,
              info: errors.publicationNotFound,
              error: e,
            });
          default:
            throw createError({
              operationName: 'RtcApiImpl.unsubscribeStream',
              path: log.prefix,
              info: errors.internalError,
              error: e,
            });
        }
      });
  }
}
