import WebSocket from 'isomorphic-ws';

import { ClientEvent } from './clientEvent';
import { ConnectionFailedEventPayload, isOpenServerEventPayload, OpenServerEventPayload } from './payloadTypes';
import { Event } from './utils/event';
import { Logger } from './utils/logger';

const ServerEventType = ['Open', 'Acknowledge'] as const;
type ServerEventType = (typeof ServerEventType)[number];

export type ServerEvent = {
  type: ServerEventType;
  id: string;
  payload: Record<string, unknown> | undefined;
};

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export type SocketParams = {
  sessionEndpoint: string;
  token: string;
  logger: Logger;
  sdkVersion: string;
  contextId: string;
};

const getReconnectWaitTime = (reconnectCount: number): number => {
  return (2 ** reconnectCount + Math.random()) * 1000;
};

export class Socket {
  private _sessionEndpoint: string;

  private _token: string;

  private _logger: Logger;

  private _sdkVersion: string;

  private _contextId: string;

  private _isOpen = false;

  private _isClosed = false;

  private _reconnectCount = 0;

  private _ws: WebSocket | undefined;

  connectionState: ConnectionState = 'connecting'; // コンストラクタ作成時点で繋ぎにいくので初期値はconnecting

  readonly onConnectionStateChanged = new Event<ConnectionState>();

  readonly onOpened = new Event<OpenServerEventPayload | undefined>();

  readonly onTokenExpired = new Event<void>();

  readonly onEventReceived = new Event<ServerEvent>();

  readonly onConnectionFailed = new Event<ConnectionFailedEventPayload>();

  private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  private _resendClientEvents: ClientEvent[] = [];

  constructor({ sessionEndpoint, token, logger, sdkVersion, contextId }: SocketParams) {
    this._sessionEndpoint = sessionEndpoint;
    this._token = token;
    this._logger = logger;
    this._sdkVersion = sdkVersion;
    this._contextId = contextId;

    this._connect();
  }

  private _setConnectionState(state: ConnectionState) {
    if (this.connectionState === state) return;
    this._logger.debug(`connectionState changed : ${state}`);
    this.connectionState = state;
    this.onConnectionStateChanged.emit(state);
  }

  private _connect(): void {
    let ws: WebSocket;
    try {
      // We use the SubProtocol header to send the token.
      // This is because the browser's WebSocket class does not allow the header to be changed freely.
      const subProtocol = `SkyWayAuthToken!${this._token}`;

      const wsProperties = {
        sdkPlatform: 'js',
        sdkVersion: this._sdkVersion,
        contextId: this._contextId,
      };
      const queryString = Object.entries(wsProperties)
        .filter(([_, v]) => v !== undefined)
        .map((pair) => pair.join('='))
        .join('&');
      const wsURL = `${this._sessionEndpoint}?${queryString}`;
      ws = new WebSocket(wsURL, subProtocol);

      this._logger.debug(`Connecting to analytics-logging-server: ${this._sessionEndpoint}`);

      ws.onerror = (event) => {
        this._logger.error('WebSocket error occurred', event.error);
        ws.close(4202);
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error();
      this._logger.error('Failed to create WebSocket instance', error);
      this.reconnect();
      return;
    }

    ws.onopen = () => {
      this._logger.debug('Connected to analytics-logging-server');
    };

    ws.onclose = (event) => {
      const logMessage =
        'Close event fired: ' + JSON.stringify({ code: event.code, reason: event.reason, type: event.type });

      // 1000, 4000~4099: normal case (should not reconnect)
      // 1009, 4100~4199: non-normal case (should not reconnect)
      // 4200~4299: non-normal case (should reconnect)
      // others: unexpected case (should reconnect)
      if ((4100 <= event.code && event.code <= 4199) || event.code === 1009) {
        this._logger.error(logMessage, new Error());
      } else {
        this._logger.debug(logMessage);
      }

      if (event.code !== 1000 && event.code !== 1009 && !(4000 <= event.code && event.code <= 4199)) {
        if (4200 === event.code) {
          this.onTokenExpired.emit();
        } else {
          this.reconnect();
        }
        return;
      }

      this._logger.debug('Closed the connection to analytics-logging-server');
      this.onConnectionFailed.emit({ code: event.code, reason: event.reason });
      this.close();
    };

    ws.onmessage = (event) => {
      this._messageHandler(event.data);
    };

    this._ws = ws;
  }

  updateAuthToken(token: string) {
    this._token = token;
  }

  reconnect(): void {
    if (this._ws !== undefined) {
      this._ws.close(4000);
    }
    this._ws = undefined;
    this._isOpen = false;

    // getReconnectWaitTime により30秒程まで再試行するため5を指定している
    if (this._reconnectCount >= 5) {
      this.onConnectionFailed.emit({});
      this.close();
      this._logger.error('Failed to reconnect for five times', new Error());
    } else {
      this._setConnectionState('reconnecting');

      const waitTime = getReconnectWaitTime(this._reconnectCount);
      this._reconnectTimer = setTimeout(() => {
        this._connect();
        this._reconnectCount++;
        this._logger.debug(`Try to reconnect: count = ${this._reconnectCount}`);
      }, waitTime);
    }
  }

  private close(): void {
    this._isClosed = true;
    this.destroy();
  }

  destroy(): void {
    this._setConnectionState('closed');

    this.onConnectionStateChanged.removeAllListeners();
    this.onOpened.removeAllListeners();
    this.onEventReceived.removeAllListeners();
    this.onConnectionFailed.removeAllListeners();

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }

    if (this._ws !== undefined) {
      this._ws.close(1000);
    }
  }

  async send(clientEvent: ClientEvent): Promise<void> {
    if (this._ws === undefined || !this._isOpen || this._ws.readyState !== WebSocket.OPEN) {
      this._logger.debug('Try to reconnect because connection is lost');
      this.resendAfterReconnect(clientEvent);
      return;
    }

    const data = JSON.stringify(clientEvent.toJSON());
    this._ws.send(data, (err) => {
      if (err) {
        this._logger.debug(`Try to reconnect because failed to send: ${err.message}`);
        this.resendAfterReconnect(clientEvent);
        return;
      }
    });
  }

  resendAfterReconnect(data: ClientEvent): void {
    const isEventExist = this._resendClientEvents.some((event) => event.id === data.id);
    if (!isEventExist) this._resendClientEvents.push(data);
    // この関数が複数回呼ばれた際に再接続の試行が重複しないよう、connectionStateを確認してから再接続する
    if (this.connectionState !== 'reconnecting') {
      this.reconnect();
    }
  }

  pushResendClientEventsQueue(data: ClientEvent): void {
    this._resendClientEvents.push(data);
  }

  isClosed() {
    return this._isClosed;
  }

  private _messageHandler(data: WebSocket.Data) {
    if (typeof data !== 'string') {
      this._logger.error('Received invalid message: not string', new Error());
      return;
    }

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error();
      this._logger.error('Received invalid message: parse error', error);
      return;
    }

    if (!isServerEvent(parsedData)) {
      this._logger.error(`Received invalid message: ${JSON.stringify(parsedData)}`, new Error());
      return;
    }

    if (parsedData.type === 'Open') {
      if (!isOpenServerEventPayload(parsedData.payload)) {
        this._logger.error(`Received invalid message: ${JSON.stringify(parsedData.payload)}`, new Error());
        return;
      }

      this._logger.debug('Received a open event');
      this._isOpen = true;
      this._setConnectionState('connected');

      if (this._reconnectCount !== 0) {
        this._reconnectCount = 0;
        this._logger.debug('Succeeded to reconnect');
      }

      if (this._resendClientEvents.length > 0) {
        for (const event of this._resendClientEvents) {
          if (this._ws === undefined || !this._isOpen || this._ws.readyState !== WebSocket.OPEN) {
            this._logger.error(`Failed to resend event because connection lost after reconnect: ${event}`, new Error());
            continue;
          }

          const data = JSON.stringify(event.toJSON());
          this._ws.send(data, (err) => {
            if (err) {
              this._logger.error(`Failed to resend event: ${event}`, err);
              return;
            }
            this._logger.debug(`Succeed to resend ClientEvent: ${event}`);
          });
        }

        this._logger.debug('Process of resending ClientEvents is completed');
        this._resendClientEvents = [];
      }
      this.onOpened.emit(parsedData.payload);
    } else {
      this._logger.debug(`Received the event: ${parsedData.type}, payload: ${JSON.stringify(parsedData.payload)}`);
      this.onEventReceived.emit(parsedData);
    }
  }
}

function isServerEvent(data: any): data is ServerEvent {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.type !== 'string' || !ServerEventType.includes(data.type)) return false;
  if (typeof data.id !== 'string') return false;
  if (data.payload && typeof data.payload !== 'object') return false;
  return true;
}
