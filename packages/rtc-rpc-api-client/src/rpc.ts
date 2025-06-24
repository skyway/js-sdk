import { Events, Logger, SkyWayError } from '@skyway-sdk/common';
import WebSocket from 'isomorphic-ws';
import { v4 as uuidV4 } from 'uuid';

import { rpcTimeout } from './const';
import { errors } from './errors';
import { createError, createWarnPayload } from './util';

const log = new Logger('packages/rtc-rpc-api-client/src/rpc.ts');

const WS_CLOSE_CODE_USAGE_LIMIT_EXCEEDED = 4291;

export class RPC {
  private readonly _id = uuidV4();
  /**@private */
  _ws!: WebSocket;
  closed = false;
  negotiated = false;
  private _reconnecting = false;
  set reconnecting(b: boolean) {
    this._reconnecting = b;
  }
  get reconnecting() {
    return this._reconnecting;
  }
  private _pendingRequests: object[] = [];

  private readonly _events = new Events();
  private readonly _onMessage = this._events.make<
    RequestMessage | ResponseMessage
  >();
  readonly onNotify = this._events.make<{ method: string; params: object }>();
  readonly onFatalError = this._events.make<SkyWayError>();
  readonly onDisconnected = this._events.make<void>();
  readonly onClosed = this._events.make<void>();

  async connect({
    domain,
    token,
    secure,
  }: {
    domain: string;
    token: string;
    secure: boolean;
  }) {
    const subProtocol = token;
    this._ws = new WebSocket(
      `${secure ? 'wss' : 'ws'}://${domain}/ws`,
      subProtocol
    );

    this._ws.onmessage = (ev: any) => {
      this._onMessage.emit(JSON.parse(ev.data as string));
    };

    this._ws.onclose = async (e) => {
      log.debug('websocket closed', {
        id: this._id,
        code: e.code,
        reason: e.reason,
      });

      if (e.code === WS_CLOSE_CODE_USAGE_LIMIT_EXCEEDED) {
        // USAGE_LIMIT_EXCEEDED_WS_CLOSE_CODEはProjectUsageLimitExceededエラーに起因してWebSocket接続が閉じられたことを示すSkyWay特有のカスタムコード
        this.close();
      } else {
        this.onDisconnected.emit();
      }
    };

    this._onMessage.add((msg) => {
      if (isNotifyMessage(msg)) {
        this.onNotify.emit(msg);
      }
    });

    const error = await new Promise<void>((r, f) => {
      const timeout = setTimeout(() => {
        f(
          createError({
            operationName: 'RPC.connect',
            info: { ...errors.timeout, detail: 'ws.open' },
            path: log.prefix,
          })
        );
      }, 5_000);
      this._ws.onerror = (e: any) => {
        f(
          createError({
            operationName: 'RPC.connect',
            info: errors.websocketConnectionFailure,
            path: log.prefix,
            error: e,
          })
        );
      };
      this._ws.onopen = () => {
        clearTimeout(timeout);
        r();
      };
    }).catch((e) => e);
    if (error) {
      throw error;
    }
    this.negotiated = true;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;

    log.debug('closed');
    this._ws.close();
    this.onClosed.emit();

    this._events.dispose();
  }

  resolvePendingRequests() {
    log.debug('resolve pendingRequests', [...this._pendingRequests]);
    this._pendingRequests.forEach(async (req) => {
      await this._send(req);
    });
    this._pendingRequests = [];
  }

  private _send = (request: object) =>
    new Promise<void>(async (r, f) => {
      // 非同期化
      await new Promise((r) => setTimeout(r, 0));

      if (this._ws.readyState !== this._ws.OPEN) {
        f(
          createError({
            operationName: 'RPC._send',
            info: { ...errors.internalError, detail: 'wrong state' },
            path: log.prefix,
            payload: {
              request,
              wsReadyState: wsStates[this._ws.readyState],
            },
          })
        );
        return;
      }

      this._ws.send(JSON.stringify(request), (error: any) => {
        if (error) {
          throw f(
            createError({
              operationName: 'RPC._send',
              info: {
                ...errors.internalError,
                detail: 'failed to send rpc message',
              },
              path: log.prefix,
              error,
            })
          );
        }
      });
      r();
    });

  /**
   * @throws {@link SkyWayError}
   */
  async request<Result extends object>(
    method: string,
    params: { [key: string]: any; appId?: string; authToken: string }
  ) {
    if (this.closed) {
      throw createError({
        operationName: 'RPC.request',
        info: {
          ...errors.internalError,
          detail: 'rpc closed',
        },
        path: log.prefix,
        payload: { method, params, id: this._id },
      });
    }

    let promiseResolved = false;
    try {
      const request = buildRequest(method, params);

      const handleMessage = async (): Promise<
        ResponseMessage & {
          result: Result;
        }
      > =>
        (await this._onMessage
          .watch((msg) => msg.id === request.id, rpcTimeout)
          .catch(() => {
            if (promiseResolved) {
              return;
            }
            throw createError({
              operationName: 'RPC.request',
              info: {
                ...errors.timeout,
                detail: 'rpc request timeout',
              },
              path: log.prefix,
              payload: {
                rpcTimeout,
                method,
                params,
                wsReadyState: wsStates[this._ws.readyState],
                id: this._id,
              },
            });
          })) as ResponseMessage & { result: Result };

      const pendingRequest = async (): Promise<
        ResponseMessage & {
          result: Result;
        }
      > => {
        log.warn(
          '[start] reconnecting. pending request',
          createWarnPayload({
            operationName: 'RPC.request',
            detail: '[start] reconnecting. pending request',
            payload: { request, id: this._id },
          })
        );
        // 再接続後に再送する
        this._pendingRequests.push(request);

        const message = await Promise.race([
          handleMessage(),
          this.onFatalError.asPromise(rpcTimeout + 100).then((e) => {
            if (!promiseResolved) {
              log.error(
                '[failed] reconnecting. pending request',
                createError({
                  operationName: 'RPC.request',
                  info: {
                    ...errors.internalError,
                    detail: 'onFatalError while request',
                  },
                  path: log.prefix,
                }),
                e
              );
            }
            throw e;
          }),
        ]);
        promiseResolved = true;

        log.warn(
          '[end] reconnecting. pending request',
          createWarnPayload({
            operationName: 'RPC.request',
            detail: '[end] reconnecting. pending request',
            payload: { request, id: this._id },
          })
        );

        return message;
      };

      let message: ResponseMessage & { result: Result };

      if (!this._reconnecting) {
        this._send(request).catch((e) => {
          log.error('send error', e);
        });

        message = await Promise.race([
          handleMessage(),
          // 返信待ち中に接続が切れた場合
          (async (): Promise<ResponseMessage & { result: Result }> => {
            await this.onDisconnected.asPromise(rpcTimeout + 100);
            if (promiseResolved) {
              return {} as any;
            }

            try {
              const message = await pendingRequest();
              log.warn(
                createWarnPayload({
                  operationName: 'request.pendingRequest',
                  detail: 'success to handle disconnected',
                })
              );
              return message;
            } catch (error: any) {
              throw createError({
                operationName: 'RPC.request',
                info: errors.connectionDisconnected,
                path: log.prefix,
                error,
              });
            }
          })(),
          this.onFatalError.asPromise(rpcTimeout + 100).then((e) => {
            if (promiseResolved) {
              return {} as any;
            }
            throw createError({
              operationName: 'RPC.request',
              info: {
                ...errors.internalError,
                detail: 'onFatalError while requesting',
              },
              path: log.prefix,
              error: e,
            });
          }),
          this.onClosed.asPromise(rpcTimeout + 100).then(() => {
            if (promiseResolved) {
              return {} as any;
            }
            throw createError({
              operationName: 'RPC.request',
              info: errors.onClosedWhileRequesting,
              path: log.prefix,
              payload: { method, params },
            });
          }),
        ]);
        promiseResolved = true;
      } else {
        message = await pendingRequest();
      }

      if (message.error) {
        log.warn('[failed] request ', { message, method, params });
        throw createError({
          operationName: 'RPC.request',
          info: {
            ...errors.rpcResponseError,
            detail: method,
            error: message.error,
          } as typeof errors.rpcResponseError,
          payload: { message, method, params },
          path: log.prefix,
        });
      }

      return message.result;
    } catch (error) {
      promiseResolved = true;
      throw error;
    }
  }

  async notify(method: string, params: object) {
    const request = buildRequest(method, params, true);
    await this._send(request);
  }

  async batch<Result extends object>(
    requests: { method: string; params: object }[]
  ) {
    const messages: RequestMessage[] = requests.map(({ method, params }) =>
      buildRequest(method, params)
    );
    this._send(messages).catch((e) => {
      throw e;
    });
    const responses = await Promise.all(
      messages.map(async ({ id }) => {
        const message = (await this._onMessage.watch(
          (msg) => msg.id === id,
          rpcTimeout
        )) as ResponseMessage & { result: Result };
        return message;
      })
    );
    return responses;
  }
}

const buildRequest = (
  method: string,
  params: object,
  notify?: boolean
): RequestMessage => {
  if (notify) {
    return { jsonrpc: '2.0', method, params };
  }
  const id = uuidV4();
  return { jsonrpc: '2.0', method, params, id };
};

interface RequestMessage {
  jsonrpc: '2.0';
  method: string;
  params: object;
  id?: string;
}

interface ResponseMessage {
  jsonrpc: '2.0';
  result: object;
  error?: ResponseError;
  id: string;
}

export interface ResponseError {
  code: number;
  message: string;
  data: RtcApiRpcError;
}

type RtcApiRpcError = {
  code: number;
  message: string;
}

const isNotifyMessage = (
  msg: RequestMessage | ResponseMessage
): msg is RequestMessage => {
  const notify = msg as RequestMessage;
  if (notify.method && notify.id == undefined) {
    return true;
  }
  return false;
};

const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;
