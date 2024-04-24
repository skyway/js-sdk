import WebSocket from 'isomorphic-ws';

import { ClientEvent } from './clientEvent';
import { Event } from './utils/event';
import { Logger } from './utils/logger';
import { PACKAGE_VERSION } from './version';

const ServerEventType = ['open', 'sendRequestSignalingMessage', 'sendResponseSignalingMessage', 'acknowledge'] as const;
type ServerEventType = (typeof ServerEventType)[number];

export type ServerEvent = {
  event: ServerEventType;
  eventId: string;
  payload: Record<string, unknown> | undefined;
};

export type ConnectionState = 'connected' | 'reconnecting' | 'closed';

export type SocketParams = {
  sessionEndpoint: string;
  channelId: string;
  channelName?: string;
  memberId: string;
  memberName?: string;
  token: string;
  logger: Logger;
};

const getReconnectWaitTime = (reconnectCount: number): number => {
  return (2 ** reconnectCount + Math.random()) * 1000;
};

export class Socket {
  private _sessionEndpoint: string;

  private readonly _channelId: string;

  private readonly _channelName?: string;

  private readonly _memberId: string;

  private readonly _memberName?: string;

  private _token: string;

  private _logger: Logger;

  private _isOpen = false;

  private _isDestroyed = false;

  private _reconnectCount = 0;

  private _ws: WebSocket | undefined;

  connectionState: ConnectionState = 'closed';

  readonly onConnectionStateChanged = new Event<ConnectionState>();

  readonly onOpened = new Event<void>();

  readonly onEventReceived = new Event<ServerEvent>();

  readonly onConnectionFailed = new Event<void>();

  private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor({ channelId, channelName, memberId, memberName, sessionEndpoint, token, logger }: SocketParams) {
    this._sessionEndpoint = sessionEndpoint;
    this._channelId = channelId;
    this._channelName = channelName;
    this._memberId = memberId;
    this._memberName = memberName;
    this._token = token;
    this._logger = logger;

    this._connect();
  }

  private _setConnectionState(state: ConnectionState) {
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
        channelId: this._channelId,
        channelName: this._channelName,
        memberId: this._memberId,
        memberName: this._memberName,
        platform: 'javascript',
        version: PACKAGE_VERSION,
      };
      const queryString = Object.entries(wsProperties)
        .filter(([_, v]) => v !== undefined)
        .map((pair) => pair.join('='))
        .join('&');
      const wsURL = `${this._sessionEndpoint}?${queryString}`;
      ws = new WebSocket(wsURL, subProtocol);

      this._logger.debug(`Connecting to signaling-server: ${this._sessionEndpoint}`);

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
      this._logger.debug('Connected to signaling-server');
    };

    ws.onclose = (event) => {
      const logMessage =
        'Close event fired: ' + JSON.stringify({ code: event.code, reason: event.reason, type: event.type });

      // 1000, 4000~4099: normal case (should not reconnect)
      // 4100~4199: non-normal case (should not reconnect)
      // 4200~4299: non-normal case (should reconnect)
      // others: unexpected case (should reconnect)
      if (4100 <= event.code && event.code <= 4199) {
        this._logger.error(logMessage, new Error());
      } else {
        this._logger.debug(logMessage);
      }

      if (event.code !== 1000 && !(4000 <= event.code && event.code <= 4199)) {
        this.reconnect();
        return;
      }

      // Return not to destroy _ws successfully reconnected
      if (event.code === 4000) {
        return;
      }

      this._logger.debug('Closed the connection to signaling-server');
      this.onConnectionFailed.emit();
      this.destroy();
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

    if (this._reconnectCount >= 8) {
      this.onConnectionFailed.emit();
      this.destroy();
      this._logger.error('Failed to reconnect for eight times', new Error());
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

  destroy(): void {
    this._isDestroyed = true;

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

  send(clientEvent: ClientEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      const retrySend = () => {
        this.onOpened.addOneTimeListener(() => {
          this.send(clientEvent)
            .then(() => {
              resolve();
            })
            .catch((err) => {
              reject(err);
            });
        });
        this.onConnectionFailed.addOneTimeListener(() => {
          reject(new Error('Connection failed'));
        });
      };

      if (this._isDestroyed) {
        reject(new Error('The socket is already destroyed'));
        return;
      }

      if (this._ws === undefined || !this._isOpen) {
        // Call send method again after connected
        this._logger.debug(
          'Retry send the client event when connected because WebSocket is undefined or isOpen = false'
        );
        retrySend();
        return;
      }

      this._logger.debug(`Send the event: ${clientEvent.data}`);

      this._ws.send(clientEvent.data, (err) => {
        if (err) {
          // If state is invalid, call send method again after reconnected
          if (this._ws === undefined || !this._isOpen || this._ws.readyState !== WebSocket.OPEN) {
            this._logger.debug('Retry send the client event when connected because WebSocket.send failed');
            retrySend();
            return;
          }

          reject(err);
        } else {
          resolve();
        }
      });
    });
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
      this._logger.error(`Received invalid message: ${parsedData}`, new Error());
      return;
    }

    if (parsedData.event === 'open') {
      this._logger.debug('Received a open event');
      this._isOpen = true;
      this._setConnectionState('connected');

      if (this._reconnectCount !== 0) {
        this._reconnectCount = 0;
        this._logger.debug('Succeeded to reconnect');
      }

      this.onOpened.emit();
    } else {
      this._logger.debug(`Received the event: ${parsedData.event}, payload: ${JSON.stringify(parsedData.payload)}`);
      this.onEventReceived.emit(parsedData);
    }
  }
}

function isServerEvent(data: any): data is ServerEvent {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.event !== 'string' || !ServerEventType.includes(data.event)) return false;
  if (typeof data.eventId !== 'string') return false;
  if (data.payload && typeof data.payload !== 'object') return false;
  return true;
}
