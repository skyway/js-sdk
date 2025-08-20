import {
  BackOff,
  HttpClient,
  HttpResponse,
  LogFormat,
  Logger,
  LogLevel,
} from '@skyway-sdk/common';
import { ConsumerOptions } from '@skyway-sdk/mediasoup-client/lib/Consumer';
import { DataConsumerOptions } from '@skyway-sdk/mediasoup-client/lib/DataConsumer';
import { RtpCapabilities } from '@skyway-sdk/mediasoup-client/lib/RtpParameters';
import {
  IceParameters,
  TransportOptions,
} from '@skyway-sdk/mediasoup-client/lib/Transport';

import { defaultSfuApiOptions } from './const';
import { errors } from './errors';
import { createError, createWarnPayload } from './util';

const log = new Logger('packages/sfu-api-client/src/api.ts');

export class SfuRestApiClient {
  readonly options: SfuApiOptions;
  readonly endpoint: string;
  readonly http: HttpClient;
  private readonly _headers = { authorization: `Bearer ${this._token}` };

  constructor(
    private _token: string,
    _options: Partial<SfuApiOptions> & Pick<SfuApiOptions, 'log'>
  ) {
    this.options = {
      ...defaultSfuApiOptions,
      ..._options,
    };

    this.endpoint = `http${this.options.secure ? 's' : ''}://${
      this.options.domain
    }/v${this.options.version}`;
    this.http = new HttpClient(this.endpoint);

    Logger.level = this.options.log.level;
    Logger.format = this.options.log.format;

    log.debug('SfuRestApiClient spawned', { endpoint: this.endpoint });
  }

  updateToken(token: string) {
    this._token = token;
  }

  private _commonErrorHandler(e: HttpResponse, operationName: string) {
    switch (e?.status) {
      case 401:
        return createError({
          operationName,
          info: errors.invalidRequestParameter,
          path: log.prefix,
          payload: e,
        });
      case 403:
        return createError({
          operationName,
          info: errors.insufficientPermissions,
          path: log.prefix,
          payload: e,
        });
      case 404:
        return createError({
          operationName,
          info: errors.notFound,
          path: log.prefix,
          payload: e,
        });
      case 429:
        return createError({
          operationName,
          info: errors.quotaExceededError,
          path: log.prefix,
          payload: e,
        });
      default:
        return createError({
          operationName,
          info: errors.backendError,
          path: log.prefix,
          payload: e,
        });
    }
  }

  async createBot({
    appId,
    channelId,
  }: {
    appId: string;
    channelId: string;
  }): Promise<string> {
    const res = await this.http
      .post<{ id: string }>(
        '/bots',
        {
          appId,
          channelId,
        },
        { headers: { authorization: `Bearer ${this._token}` } }
      )
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(e, 'SfuRestApiClient.createBot');
      });

    return res.id;
  }

  async deleteBot({ botId }: { botId: string }) {
    await this.http
      .delete(`/bots/${botId}`, {
        headers: { authorization: `Bearer ${this._token}` },
      })
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(e, 'SfuRestApiClient.deleteBot');
      });
  }

  async startForwarding({
    botId,
    publicationId,
    maxSubscribers,
    contentType,
    publisherId,
  }: {
    botId: string;
    publicationId: string;
    maxSubscribers: number;
    contentType: ContentType;
    publisherId: string;
  }) {
    const backOff = new BackOff();

    const body = {
      publicationId,
      maxSubscribers,
      contentType: contentType[0].toUpperCase() + contentType.slice(1),
      publisherId,
    };

    const res = await this.http
      .post<{
        forwardingId: string;
        broadcasterTransportId: string;
        rtpCapabilities?: RtpCapabilities;
        broadcasterTransportOptions?: TransportOptions;
        identifierKey: string;
      }>(`/bots/${botId}/forwardings`, body, {
        headers: { authorization: `Bearer ${this._token}` },
        retry: async (err) => {
          if ([400, 403, 429].includes(err.status)) {
            return false;
          }
          return await backOff.wait();
        },
      })
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(e, 'SfuRestApiClient.startForwarding');
      });

    if (backOff.count > 0) {
      log.warn(
        'success to retry startForwarding',
        createWarnPayload({
          operationName: 'SfuRestApiClient.startForwarding',
          detail: 'success to retry startForwarding',
          botId,
          memberId: publisherId,
          payload: { publicationId, count: backOff.count },
        })
      );
    }

    return res;
  }

  async createProducer({
    botId,
    forwardingId,
    transportId,
    producerOptions,
  }: {
    botId: string;
    forwardingId: string;
    transportId: string;
    producerOptions: object;
  }) {
    const backOff = new BackOff();

    const res = await this.http
      .put<{ producerId: string }>(
        `/bots/${botId}/forwardings/${forwardingId}/transports/producers`,
        { transportId, producerOptions },
        {
          headers: { authorization: `Bearer ${this._token}` },
          retry: async () => {
            return await backOff.wait();
          },
        }
      )
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(e, 'SfuRestApiClient.createProducer');
      });

    if (backOff.count > 0) {
      log.warn(
        'success to retry createProducer',
        createWarnPayload({
          operationName: 'SfuRestApiClient.createProducer',
          detail: 'success to retry createProducer',
          botId,
          payload: { forwardingId, transportId, count: backOff.count },
        })
      );
    }

    return res;
  }

  /**@throws {maxSubscriberExceededError,} */
  async createConsumer({
    botId,
    forwardingId,
    rtpCapabilities,
    subscriptionId,
    subscriberId,
    spatialLayer,
    originPublicationId,
  }: {
    botId: string;
    forwardingId: string;
    rtpCapabilities: RtpCapabilities;
    subscriptionId: string;
    subscriberId: string;
    spatialLayer?: number;
    originPublicationId: string;
  }) {
    const backOff = new BackOff({ times: 5, interval: 100 }); // 5.5sec

    const requestPayload: {
      rtpCapabilities: object;
      subscriptionId: string;
      subscriberId: string;
      spatialLayer?: number;
      originPublicationId: string;
    } = {
      rtpCapabilities,
      subscriptionId,
      subscriberId,
      spatialLayer,
      originPublicationId,
    };

    const res = await this.http
      .post<{
        consumerOptions: ConsumerOptions;
        producerId: string;
        transportId: string;
        transportOptions: TransportOptions | undefined;
      }>(
        `/bots/${botId}/forwardings/${forwardingId}/transports/consumers`,
        requestPayload,
        {
          retry: async (err) => {
            if (
              [
                400, 403,
                //  404,
                429,
              ].includes(err.status)
            ) {
              return false;
            }
            return await backOff.wait();
          },
          headers: { authorization: `Bearer ${this._token}` },
        }
      )
      .catch((e: HttpResponse) => {
        if (e.status === 429) {
          throw createError({
            operationName: 'SfuRestApiClient.createConsumer',
            info: errors.maxSubscriberExceededError,
            path: log.prefix,
            payload: e,
          });
        } else if (e.status === 403) {
          throw createError({
            operationName: 'SfuRestApiClient.createConsumer',
            info: errors.notAllowedConsumeError,
            path: log.prefix,
            payload: e,
          });
        } else {
          throw this._commonErrorHandler(e, 'SfuRestApiClient.createConsumer');
        }
      });

    if (backOff.count > 0) {
      log.warn(
        'success to retry createConsumer',
        createWarnPayload({
          operationName: 'SfuRestApiClient.createConsumer',
          detail: 'success to retry createConsumer',
          botId,
          payload: { forwardingId, count: backOff.count },
        })
      );
    }
    log.debug('response of createConsumer', res);
    return res;
  }

  async connect({
    transportId,
    dtlsParameters,
  }: {
    transportId: string;
    dtlsParameters: object;
  }) {
    const backOff = new BackOff();

    const body = { transportId, dtlsParameters };

    const res = await this.http
      .put<{ transportId: string }>(`/transports/connections`, body, {
        headers: { authorization: `Bearer ${this._token}` },
        retry: async () => {
          return await backOff.wait();
        },
      })
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(e, 'SfuRestApiClient.connect');
      });

    if (backOff.count > 0) {
      log.warn(
        'success to retry connect',
        createWarnPayload({
          operationName: 'SfuRestApiClient.connect',
          detail: 'success to retry connect',
          payload: { transportId, count: backOff.count },
        })
      );
    }

    return res;
  }

  async changeConsumerLayer({
    transportId,
    consumerId,
    spatialLayer,
    publicationId,
  }: {
    transportId: string;
    consumerId: string;
    spatialLayer: number;
    publicationId: string;
  }) {
    const res = await this.http
      .put<{ transportId: string }>(
        `transports/consumers/${consumerId}/layers`,
        { transportId, spatialLayer, publicationId },
        {
          headers: { authorization: `Bearer ${this._token}` },
        }
      )
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(
          e,
          'SfuRestApiClient.changeConsumerLayer'
        );
      });

    return res;
  }

  stopForwarding({
    botId,
    forwardingId,
  }: {
    botId: string;
    forwardingId: string;
  }) {
    let fulfilled: any = false;

    const promise = this.http
      .delete(`/bots/${botId}/forwardings/${forwardingId}`, {
        headers: { authorization: `Bearer ${this._token}` },
      })
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(e, 'SfuRestApiClient.stopForwarding');
      })
      .then((res) => {
        fulfilled = res;
      });
    return { promise, fulfilled };
  }

  async iceRestart({ transportId }: { transportId: string }) {
    const res = await this.http
      .put<{ iceParameters: IceParameters }>(
        `/transports/connections/ice`,
        { transportId },
        { headers: this._headers }
      )
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(e, 'SfuRestApiClient.iceRestart');
      });

    return res.iceParameters;
  }

  async getRtpCapabilities({
    botId,
    forwardingId,
    originPublicationId,
  }: {
    botId: string;
    forwardingId: string;
    originPublicationId: string;
  }): Promise<RtpCapabilities> {
    const backOff = new BackOff();

    const res = await this.http
      .get<{
        rtpCapabilities: RtpCapabilities;
      }>(
        `/bots/${botId}/forwardings/${forwardingId}/transports/rtp-capabilities?originPublicationId=${originPublicationId}`,
        {
          headers: { authorization: `Bearer ${this._token}` },
          retry: async () => {
            return await backOff.wait();
          },
        }
      )
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(
          e,
          'SfuRestApiClient.getRtpCapabilities'
        );
      });

    if (backOff.count > 0) {
      log.warn(
        'getCapabilities to retry connect',
        createWarnPayload({
          operationName: 'SfuRestApiClient.getRtpCapabilities',
          detail: 'getCapabilities to retry connect',
          botId,
          payload: { forwardingId, count: backOff.count },
        })
      );
    }

    return res.rtpCapabilities;
  }

  async confirmSubscription({
    forwardingId,
    subscriptionId,
    identifierKey,
  }: {
    forwardingId: string;
    subscriptionId: string;
    identifierKey: string;
  }) {
    const requestPayload: {
      forwardingId: string;
      subscriptionId: string;
      identifierKey: string;
    } = {
      forwardingId,
      subscriptionId,
      identifierKey,
    };

    const res = await this.http
      .post<{
        message: string;
        operationId: string;
      }>('/confirm-subscription', requestPayload, {
        headers: { authorization: `Bearer ${this._token}` },
      })
      .catch((e: HttpResponse) => {
        throw this._commonErrorHandler(
          e,
          'SfuRestApiClient.confirmSubscription'
        );
      });
    log.debug('response of confirmSubscription', res);
    return res;
  }
}

type ContentType = 'video' | 'audio';

export type SfuApiOptions = {
  domain: string;
  secure: boolean;
  version: number;
  log: { level: LogLevel; format: LogFormat };
};
