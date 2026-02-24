import {
  AnalyticsClient,
  type ConnectionState,
} from '@skyway-sdk/analytics-client';
import type { OnLogForAnalyticsProps } from '@skyway-sdk/common';
import { Event, Logger } from '@skyway-sdk/common';

import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { createError } from '../util';

const LOGGER_PREFIX = 'packages/core/src/external/analytics.ts';

const log = new Logger(LOGGER_PREFIX);

/**@internal */
export async function setupAnalyticsSession(
  context: SkyWayContext,
): Promise<AnalyticsSession> {
  const { analyticsService } = context.config;

  const client = new AnalyticsClient(
    {
      token: context.authTokenString,
      sdkVersion: SkyWayContext.version, // coreパッケージのバージョンを引き渡す
      contextId: SkyWayContext.id,
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
            }),
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
    },
  );

  const analyticsSession = new AnalyticsSession(client, context);
  const onLogForAnalytics = (props: OnLogForAnalyticsProps) => {
    if (props.prefix === LOGGER_PREFIX) {
      return; // Avoid logging from this file to avoid infinite loop
    }
    if (analyticsSession.isClosed() || client.isClosed()) {
      return;
    }
    void client.bufferOrSendSdkLog(props);
  };
  // Logger._onLogForAnalytics はglobal hookなので、close時に解除する前提で登録する。
  Logger._onLogForAnalytics = onLogForAnalytics;
  analyticsSession.setOnClose(() => {
    // 他セッションが後からhookを差し替えている可能性があるため、自分のhookの場合のみ解除する。
    if (Logger._onLogForAnalytics === onLogForAnalytics) {
      Logger._onLogForAnalytics = () => {};
    }
  });

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
      }),
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
  private _onClose = () => {};

  constructor(
    public client: AnalyticsClient,
    context: SkyWayContext,
  ) {
    this._listen();
    context.onTokenUpdated.add((token) => {
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
          '[end] failed connect analyticsService: also unreachable to server',
        );
        log.error(
          `AnalyticsClient error: ${error.message}`,
          createError({
            operationName: 'AnalyticsClient.logger',
            info: { ...errors.internal, detail: 'AnalyticsClient error' },
            error,
            path: log.prefix,
          }),
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
          '[end] failed connect analyticsService: no initial response from the server',
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
    if (this._isClosed) {
      return;
    }
    this._isClosed = true;
    this.onConnectionFailed.removeAllListeners();
    this.onConnectionStateChanged.removeAllListeners();
    this.onMessage.removeAllListeners();
    this._onClose();
    this._onClose = () => {};
  }

  isClosed() {
    return this._isClosed;
  }

  /**@internal */
  setOnClose(onClose: () => void) {
    this._onClose = onClose;
  }
}

export type { ConnectionState };
