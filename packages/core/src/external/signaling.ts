import { BackOff, Event, EventDisposer, Logger } from '@skyway-sdk/common';
import { Member } from '@skyway-sdk/model';
import { ConnectionState, SignalingClient } from '@skyway-sdk/signaling-client';
import { uuidV4 } from '@skyway-sdk/token';

import { SkyWayChannelImpl } from '../channel';
import { SkyWayContext } from '../context';
import { errors } from '../errors';
import { RemoteMember } from '../member/remoteMember';
import { createError, createWarnPayload } from '../util';

const log = new Logger('packages/core/src/external/signaling.ts');

export async function setupSignalingSession(
  context: SkyWayContext,
  channel: SkyWayChannelImpl,
  memberDto: Member
) {
  const { signalingService } = context.config;

  const client = new SignalingClient(
    {
      token: context.authTokenString,
      channelId: channel.id,
      channelName: channel.name,
      memberId: memberDto.id,
      memberName: memberDto.name,
    },
    {
      logger: {
        error: async (error: any) => {
          log.error(
            'SignalingClient error',
            createError({
              operationName: 'SignalingClient.logger',
              context,
              info: { ...errors.internal, detail: 'signalingClient error' },
              error,
              path: log.prefix,
              channel,
            })
          );
        },
        debug: (s) => {
          // log.debug('signaling service:', s);
        },
      },
      signalingServerDomain: signalingService.domain,
      secure: signalingService.secure,
    }
  );

  const signalingSession = new SignalingSession(client, context);
  await signalingSession.connect();

  return signalingSession;
}

export class SignalingSession {
  readonly onConnectionFailed = new Event();
  readonly onConnectionStateChanged = new Event<ConnectionState>();
  readonly onMessage = new Event<MessageEvent>();
  closed = false;

  private _chunkedMessageBuffer: { [messageId: string]: string[] } = {};
  private _backoffUpdateSkyWayAuthToken = new BackOff({
    times: 8,
    interval: 100,
    jitter: 100,
  });
  private _disposer = new EventDisposer();

  constructor(public _client: SignalingClient, private context: SkyWayContext) {
    this._listen();
    context._onTokenUpdated
      .add(async (token) => {
        await this._updateSkyWayAuthToken(token);
      })
      .disposer(this._disposer);
  }

  updateClient(client: SignalingClient) {
    this._client = client;
    this._listen();
  }

  private _listen() {
    this._client.onConnectionFailed.addOneTimeListener(() => {
      this.onConnectionFailed.emit({});
    });
    this._client.onConnectionStateChanged.addListener((state) => {
      log.debug('signalingClient onConnectionStateChanged', state);
      this.onConnectionStateChanged.emit(state);
    });
    this._client.onRequested.addListener(async ({ data, src, reply }) => {
      const messageChunk = data as unknown as SignalingMessageChunk;
      const { chunk, length, offset, id, type } = messageChunk;
      if (type !== messageType) return;

      if (length === 0) {
        this.onMessage.emit({
          src,
          data: JSON.parse(chunk),
        });
      } else {
        this._chunkedMessageBuffer[id] = [
          ...(this._chunkedMessageBuffer[id] ?? []),
          messageChunk.chunk,
        ];
        if (length === offset) {
          const message = this._chunkedMessageBuffer[id].join('');
          delete this._chunkedMessageBuffer[id];

          this.onMessage.emit({
            src,
            data: JSON.parse(message),
          });
        }
      }

      await reply({}).catch((e) => {
        if (this.closed) return;
        log.warn(
          'failed to reply',
          createWarnPayload({
            operationName: 'SignalingSession.reply',
            detail: 'SignalingClient failed to reply',
          }),
          e
        );
      });
    });
  }

  private async _updateSkyWayAuthToken(token: string) {
    if (this._backoffUpdateSkyWayAuthToken.exceeded) {
      log.error('[failed] updateSkyWayAuthToken');
      return;
    }
    await this._backoffUpdateSkyWayAuthToken.wait();

    log.debug('[start] updateSkyWayAuthToken', {
      count: this._backoffUpdateSkyWayAuthToken.count,
    });

    const e = await this._client
      .updateSkyWayAuthToken(token)
      .catch((e) => e as Error);
    if (e) {
      log.warn(
        '[retry] updateSkyWayAuthToken',
        createWarnPayload({
          operationName: 'SignalingSession._updateSkyWayAuthToken',
          detail: '[retry] updateSkyWayAuthToken',
        }),
        e
      );
      await this._updateSkyWayAuthToken(token);
      return;
    }

    log.debug('[end] updateSkyWayAuthToken');
    this._backoffUpdateSkyWayAuthToken.reset();
  }

  get connectionState() {
    return this._client.connectionState;
  }

  async connect() {
    log.debug('[start] connect signalingService');
    await this._client.connect().catch((err) => {
      throw createError({
        operationName: 'signalingSession.connect',
        path: log.prefix,
        info: {
          ...errors.internal,
          detail: 'signalingClient failed to connect Server',
        },
        context: this.context,
        error: err,
      });
    });
    log.debug('[end] connect signalingService');
  }

  close() {
    this.closed = true;
    this._disposer.dispose();
    this._client.disconnect();
  }

  /**@throws {@link SkyWayError} */
  async send(
    target: RemoteMember,
    data: object,
    /**ms */
    timeout = 10_000
  ) {
    try {
      const payload = JSON.stringify(data);
      const id = uuidV4();

      // chunking message
      if (payload.length > 20480) {
        const split = payload.match(/.{1,20480}/g) ?? [];

        let offset = 0;
        for (const chunk of split) {
          const chunkMessage: SignalingMessageChunk = {
            type: messageType,
            length: split.length - 1,
            offset: offset++,
            chunk,
            id,
          };
          await this._client.request(
            target,
            chunkMessage as any,
            timeout / 1000
          );
        }
      } else {
        const chunkMessage: SignalingMessageChunk = {
          type: messageType,
          length: 0,
          offset: 0,
          chunk: payload,
          id,
        };
        await this._client.request(target, chunkMessage as any, timeout / 1000);
      }
    } catch (error: any) {
      if (this.closed || target.state !== 'joined') return;

      throw createError({
        operationName: 'SignalingSession.send',
        context: this.context,
        info: { ...errors.internal, detail: 'signalingClient' },
        error,
        path: log.prefix,
        payload: { target, data },
      });
    }
  }
}

const messageType = 'signalingMessage' as const;

interface SignalingMessageChunk {
  type: typeof messageType;
  length: number;
  offset: number;
  chunk: string;
  id: string;
}

export interface MessageEvent {
  src: { name?: string; id: string };
  data: Record<string, any>;
}
