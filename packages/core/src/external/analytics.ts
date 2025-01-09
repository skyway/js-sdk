import { AnalyticsClient, ConnectionState } from '@skyway-sdk/analytics-client';
import { Event, Logger } from '@skyway-sdk/common';
import { Member } from '@skyway-sdk/model';

import { SkyWayChannelImpl } from '../channel';
import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { createError } from '../util';

const log = new Logger('packages/core/src/external/analytics.ts');

export async function setupAnalyticsSession(
  context: SkyWayContext,
  channel: SkyWayChannelImpl,
  memberDto: Member
) {
  const { analyticsService } = context.config;

  const client = new AnalyticsClient(
    {
      token: context.authTokenString,
      channelId: channel.id,
      channelName: channel.name,
      memberId: memberDto.id,
      memberName: memberDto.name,
      sdkVersion: SkyWayContext.version, // coreパッケージのバージョンを引き渡す
    },
    {
      logger: {
        error: async (message: string, error: any) => {
          log.error(
            `AnalyticsClient error: ${message}`,
            createError({
              operationName: 'AnalyticsClient.logger',
              context,
              info: { ...errors.internal, detail: 'AnalyticsClient error' },
              error,
              path: log.prefix,
              channel,
            })
          );
        },
        debug: (message, ...optionalParams) => {
          log.debug('[analytics]:', message, ...optionalParams);
        },
        warn: (message, ...optionalParams) => {
          log.warn('[analytics]:', message, ...optionalParams);
        },
      },
      analyticsLoggingServerDomain: analyticsService.domain,
      secure: analyticsService.secure,
    }
  );

  const analyticsSession = new AnalyticsSession(client, context);

  analyticsSession.connectWithTimeout().catch((error) => {
    analyticsSession.close();
    log.error(
      `AnalyticsClient error: ${error.message}`,
      createError({
        operationName: 'AnalyticsClient.logger',
        context,
        info: { ...errors.internal, detail: 'AnalyticsClient error' },
        error,
        path: log.prefix,
        channel,
      })
    );
    analyticsSession.onConnectionFailed.emit({});
  });
  return analyticsSession;
}

export class AnalyticsSession {
  readonly onConnectionFailed = new Event();
  readonly onConnectionStateChanged = new Event<ConnectionState>();
  readonly onMessage = new Event<MessageEvent>();
  private _isClosed = false;

  constructor(public client: AnalyticsClient, private context: SkyWayContext) {
    this._listen();
    context._onTokenUpdated.add((token) => {
      this.client.setNewSkyWayAuthToken(token);
    });
  }

  private _listen() {
    this.client.onConnectionFailed.addOneTimeListener(() => {
      this.onConnectionFailed.emit({});
    });
    this.client.onConnectionStateChanged.addListener((state) => {
      if (state === 'closed' && !this.isClosed() && this.client.isClosed()) {
        this.close();
      }
      this.onConnectionStateChanged.emit(state);
    });
  }

  get connectionState() {
    return this.client.connectionState;
  }

  private async _connect(): Promise<void> {
    log.debug('[start] connect analyticsService');
    await this.client
      .connect()
      .then(() => {
        log.debug('[end] connect analyticsService');
      })
      .catch((error) => {
        this.close();
        log.debug(
          '[end] failed connect analyticsService: also unreachable to server'
        );
        log.error(
          `AnalyticsClient error: ${error.message}`,
          createError({
            operationName: 'AnalyticsClient.logger',
            info: { ...errors.internal, detail: 'AnalyticsClient error' },
            error,
            path: log.prefix,
          })
        );
        this.onConnectionFailed.emit({});
      });
    return;
  }

  async connectWithTimeout() {
    let connectTimeout: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
      connectTimeout = setTimeout(() => {
        log.debug(
          '[end] failed connect analyticsService: no initial response from the server'
        );
        reject(new Error('failed connect analyticsService'));
      }, 30 * 1000);
    });
    const firstConnectionFailedPromise = new Promise<void>((resolve, _) => {
      this.client.onAnalyticsNotEnabledError.addOneTimeListener((data) => {
        log.warn(`[end] failed connect analyticsService: ${data.reason}`);
        resolve();
      });
    });

    return Promise.race([
      this._connect(),
      timeoutPromise,
      firstConnectionFailedPromise,
    ]).finally(() => {
      clearTimeout(connectTimeout);
    });
  }

  close() {
    this._isClosed = true;
    this.onConnectionFailed.removeAllListeners();
    this.onConnectionStateChanged.removeAllListeners();
    this.onMessage.removeAllListeners();
  }

  isClosed() {
    return this._isClosed;
  }
}

export { ConnectionState };
