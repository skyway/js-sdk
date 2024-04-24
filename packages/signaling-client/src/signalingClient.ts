import { validate as uuidValidate } from 'uuid';

import { ClientEvent } from './clientEvent';
import { AcknowledgePayload, isAcknowledgePayload, isMember, isMessagePayload, Member } from './payloadTypes';
import { ConnectionState, ServerEvent, Socket } from './socket';
import { Event } from './utils/event';
import { Logger } from './utils/logger';

const SIGNALING_SERVER_DOMAIN = 'signaling.skyway.ntt.com';
const API_VERSION = 'v1';

type SignalingClientParams = {
  token: string;
  channelId: string;
  channelName?: string;
  memberId: string;
  memberName?: string;
};

type SignalingClientOptions = {
  signalingServerDomain?: string;
  secure?: boolean;
  logger?: Logger;
};

type SignalingClientInternalOptions = Required<SignalingClientOptions> & {
  connectivityCheckIntervalSec: number;
};

export class SignalingClient {
  private readonly _options: SignalingClientInternalOptions;

  private readonly _logger: Logger;

  private _socket: Socket | undefined;

  readonly onConnectionStateChanged = new Event<ConnectionState>();

  readonly onConnectionFailed = new Event<void>();

  readonly onRequested = new Event<{
    data: Record<string, unknown>;
    reply: (data: Record<string, unknown>) => Promise<void>;
    requestEventId: string;
    src: Member;
  }>();

  private readonly _token: string;

  private readonly _channelId: string;

  private readonly _channelName?: string;

  private readonly _memberId: string;

  private readonly _memberName?: string;

  private _connectivityCheckInterval: ReturnType<typeof setInterval> | undefined;

  private _connectivityCheckTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private _responseCallbacks: Map<string, (data: Record<string, unknown>) => void> = new Map();

  private _acknowledgeCallbacks: Map<string, (data: AcknowledgePayload) => void> = new Map();

  constructor(
    { token, channelId, channelName, memberId, memberName }: SignalingClientParams,
    options?: SignalingClientOptions
  ) {
    this._token = token;
    this._channelId = channelId;
    this._channelName = channelName;
    this._memberId = memberId;
    this._memberName = memberName;

    const defaultOptions: SignalingClientInternalOptions = {
      connectivityCheckIntervalSec: 30,
      signalingServerDomain: SIGNALING_SERVER_DOMAIN,
      secure: true,
      logger: {
        debug: (message) => {
          console.debug(message);
        },
        error: (error) => {
          console.error(error);
        },
      },
    };
    this._options = Object.assign({}, defaultOptions, options ?? {});

    this._logger = this._options.logger;
    this._logger.debug(`Created instance with the options: ${this._options}`);
  }

  get connectionState(): ConnectionState {
    return this._socket?.connectionState ?? 'closed';
  }

  async connect(): Promise<void> {
    const WSProtocol = this._options.secure ? 'wss' : 'ws';

    const signalingServerDomain = this._options.signalingServerDomain || SIGNALING_SERVER_DOMAIN;

    this._socket = new Socket({
      sessionEndpoint: `${WSProtocol}://${signalingServerDomain}/${API_VERSION}/ws`,
      channelId: this._channelId,
      channelName: this._channelName,
      memberId: this._memberId,
      memberName: this._memberName,
      token: this._token,
      logger: this._logger,
    });

    this._socket.onEventReceived.addListener((data: ServerEvent) => {
      try {
        this._eventReceivedHandler(data);
      } catch (error) {
        this._logger.error('in _eventReceivedHandler', error as Error);
      }
    });

    this._socket.onConnectionFailed.addListener(() => {
      this.onConnectionFailed.emit();
    });

    this._socket.onConnectionStateChanged.addListener((state) => {
      this.onConnectionStateChanged.emit(state);
    });

    await this._socket.onOpened.asPromise(15 * 1000);

    this._startConnectivityCheck();
  }

  disconnect(): void {
    this._stopConnectivityCheck();

    this._socket?.destroy();
    this._socket = undefined;

    this._responseCallbacks.clear();
    this._acknowledgeCallbacks.clear();
  }

  private _startConnectivityCheck() {
    if (this._connectivityCheckInterval) {
      this._logger.debug('connectivity check timer is already set');
      return;
    }

    this._connectivityCheckInterval = setInterval(() => {
      const clientEvent = new ClientEvent('checkConnectivity');
      this._socket?.send(clientEvent).catch(() => {
        this._acknowledgeCallbacks.delete(clientEvent.eventId);
      });

      this._connectivityCheckTimers.set(
        clientEvent.eventId,
        setTimeout(() => {
          this._acknowledgeCallbacks.delete(clientEvent.eventId);
          this._socket?.reconnect();
          this._logger.debug('connectivity check timer is expired');
        }, 5 * 1000)
      );

      this._setAcknowledgeCallback(clientEvent.eventId, (data: Record<string, unknown>) => {
        const timer = this._connectivityCheckTimers.get(clientEvent.eventId);
        if (timer) {
          clearTimeout(timer);
          this._connectivityCheckTimers.delete(clientEvent.eventId);
        }
        if (!data.ok) {
          this._socket?.reconnect();
          this._logger.debug('connectivity check response from server was not ok');
        }
      });
    }, this._options.connectivityCheckIntervalSec * 1000);

    this._logger.debug('Started connectivity check timer');
  }

  private _stopConnectivityCheck() {
    if (!this._connectivityCheckInterval) {
      this._logger.debug('connectivity check timer is not set');
      return;
    }

    clearInterval(this._connectivityCheckInterval);
    this._connectivityCheckInterval = undefined;
    this._logger.debug('Stopped connectivity check timer');

    for (const [_, timer] of this._connectivityCheckTimers) {
      clearTimeout(timer);
    }
    this._connectivityCheckTimers.clear();
  }

  request(target: Member, data: Record<string, unknown>, timeoutSec = 10): Promise<Record<string, unknown>> {
    validateTarget(target);
    validateData(data);
    return new Promise((resolve, reject) => {
      if (this._socket === undefined) {
        reject(new Error('websocket is not connected'));
        return;
      }

      const payload = {
        dst: target,
        data,
      };
      const clientEvent = new ClientEvent('sendRequestSignalingMessage', payload);

      const timer = setTimeout(() => {
        this._acknowledgeCallbacks.delete(clientEvent.eventId);
        reject(new Error('request timeout'));
      }, timeoutSec * 1000);

      this._setResponseCallback(clientEvent.eventId, (data: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(data);
      });

      this._setAcknowledgeCallback(clientEvent.eventId, (data: AcknowledgePayload) => {
        if (!data.ok) {
          clearTimeout(timer);
          reject(data);
        }
      });

      this._socket.send(clientEvent).catch((err) => {
        this._acknowledgeCallbacks.delete(clientEvent.eventId);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private _response(
    target: Member,
    requestEventId: string,
    data: Record<string, unknown>,
    timeoutSec: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      validateData(data);
      if (this._socket === undefined) {
        reject(new Error('websocket is not connected'));
        return;
      }

      const payload = {
        dst: target,
        requestEventId,
        data,
      };
      const clientEvent = new ClientEvent('sendResponseSignalingMessage', payload);

      const timer = setTimeout(() => {
        this._acknowledgeCallbacks.delete(clientEvent.eventId);
        reject(new Error('response timeout'));
      }, timeoutSec * 1000);

      this._setAcknowledgeCallback(clientEvent.eventId, (data: AcknowledgePayload) => {
        clearTimeout(timer);

        if (data.ok) {
          resolve();
        } else {
          reject(data);
        }
      });

      this._socket.send(clientEvent).catch((err) => {
        this._acknowledgeCallbacks.delete(clientEvent.eventId);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  updateSkyWayAuthToken(token: string, timeoutSec = 10): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._socket === undefined) {
        reject(new Error('websocket is not connected'));
        return;
      }

      const payload = {
        token,
      };
      const clientEvent = new ClientEvent('updateSkyWayAuthToken', payload);

      const timer = setTimeout(() => {
        this._acknowledgeCallbacks.delete(clientEvent.eventId);
        reject(new Error('updateSkyWayAuthToken timeout'));
      }, timeoutSec * 1000);

      this._setAcknowledgeCallback(clientEvent.eventId, (data: AcknowledgePayload) => {
        clearTimeout(timer);
        if (data.ok) {
          if (this._socket === undefined) {
            reject(new Error('websocket is not connected'));
            return;
          }
          this._socket.updateAuthToken(token);
          resolve();
        } else {
          reject(data);
        }
      });

      this._socket.send(clientEvent).catch((err) => {
        this._acknowledgeCallbacks.delete(clientEvent.eventId);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private _eventReceivedHandler(data: ServerEvent) {
    switch (data.event) {
      case 'acknowledge':
        this._acknowledgeHandler(data.payload);
        break;
      case 'sendRequestSignalingMessage':
        this._eventMessageRequestHandler(data.payload);
        break;
      case 'sendResponseSignalingMessage':
        this._eventMessageResponseHandler(data.payload);
        break;
      case 'open':
        break; // nop
      default: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _: never = data.event;
        this._logger.debug(`Unknown event: ${data.event}`);
      }
    }
  }

  private _acknowledgeHandler(payload: unknown) {
    if (!isAcknowledgePayload(payload)) {
      throw new Error('Invalid payload');
    }

    const { eventId } = payload;
    if (!this._acknowledgeCallbacks.has(eventId)) {
      throw new Error(`acknowledge event has unknown eventId: ${eventId}`);
    }
    const callback = this._acknowledgeCallbacks.get(eventId);
    if (callback) {
      this._acknowledgeCallbacks.delete(eventId);
      callback(payload);
    }
  }

  private _eventMessageRequestHandler(payload: unknown) {
    if (!isMessagePayload(payload)) {
      throw new Error('Invalid payload');
    }

    if (!payload.requestEventId) {
      throw new Error('Invalid payload');
    }
    const src = payload.src;
    const requestEventId = payload.requestEventId;

    const reply = async (data: Record<string, unknown>, timeout = 10): Promise<void> => {
      await this._response(src, requestEventId, data, timeout);
    };

    this.onRequested.emit({
      data: payload.data,
      reply: reply,
      requestEventId: payload.requestEventId,
      src: payload.src,
    });
  }

  private _eventMessageResponseHandler(payload: unknown) {
    if (!isMessagePayload(payload)) {
      throw new Error('Invalid payload');
    }

    if (!payload.requestEventId || !this._responseCallbacks.has(payload.requestEventId)) {
      throw new Error(`received response has unknown eventId: ${payload.requestEventId}`);
    }

    const callback = this._responseCallbacks.get(payload.requestEventId);
    if (callback) {
      this._responseCallbacks.delete(payload.requestEventId);
      callback(payload.data);
    }
  }

  private _setResponseCallback(eventId: string, callback: (data: Record<string, unknown>) => void) {
    this._responseCallbacks.set(eventId, callback);
  }

  private _setAcknowledgeCallback(eventId: string, callback: (data: AcknowledgePayload) => void) {
    this._acknowledgeCallbacks.set(eventId, callback);
  }
}

function validateData(data: Record<string, unknown>): void {
  if (!data || typeof data !== 'object') {
    throw new Error('the type of data must be object');
  }
}

function validateTarget(target: Member): void {
  if (!isMember(target)) {
    throw new Error('the type of target must be {id: string, name: string}');
  }
  if (!uuidValidate(target.id)) {
    throw new Error('the type of target.id must be uuid format');
  }
}
