import { BackOff, Event, EventDisposer, Logger } from '@skyway-sdk/common';
import type { Member } from '@skyway-sdk/model';
import {
  type ConnectionState,
  getMaxRequestDataLength,
  SignalingClient,
} from '@skyway-sdk/signaling-client';
import { uuidV4 } from '@skyway-sdk/token';

import type { SkyWayChannelImpl } from '../channel';
import type { SkyWayContext } from '../context';
import { errors } from '../errors';
import type { RemoteMember } from '../member/remoteMember';
import { createError, createWarnPayload } from '../util';

const log = new Logger('packages/core/src/external/signaling.ts');

export async function setupSignalingSession(
  context: SkyWayContext,
  channel: SkyWayChannelImpl,
  memberDto: Member,
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
            }),
          );
        },
        debug: () => {},
      },
      signalingServerDomain: signalingService.domain,
      secure: signalingService.secure,
    },
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

  constructor(
    public _client: SignalingClient,
    private context: SkyWayContext,
  ) {
    this._listen();
    context.onTokenUpdated
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
          e,
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
        e,
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
    timeout = 10_000,
  ) {
    try {
      const payload = JSON.stringify(data);
      const id = uuidV4();
      const dst: SignalingDestination = { id: target.id, name: target.name };
      const maxChunkLength = getMaxChunkLength(dst, id);

      // chunking message
      if (encodedLength(payload) > maxChunkLength) {
        const split = splitByEncodedLength(payload, maxChunkLength);

        let offset = 0;
        for (const chunk of split) {
          const chunkMessage: SignalingMessageChunk = {
            type: messageType,
            length: split.length - 1,
            offset: offset++,
            chunk,
            id,
          };
          await this._client.request(dst, chunkMessage as any, timeout / 1000);
        }
      } else {
        const chunkMessage: SignalingMessageChunk = {
          type: messageType,
          length: 0,
          offset: 0,
          chunk: payload,
          id,
        };
        await this._client.request(dst, chunkMessage as any, timeout / 1000);
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

type SignalingDestination = Pick<Member, 'id' | 'name'>;

const textEncoder = new TextEncoder();

/** 文字列を JSON の文字列値として埋め込んだときの UTF-8 のバイト数（両端の `"` を除く） */
const encodedLength = (text: string) =>
  textEncoder.encode(JSON.stringify(text)).length - 2;

/** 1 コードポイント分の文字列を JSON の文字列値として埋め込んだときの UTF-8 のバイト数 */
const encodedCharLength = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  // 制御文字・`"`・`\`・ペアになっていないサロゲートは、ASCII のエスケープ表記になる
  if (
    code < 0x20 ||
    code === 0x22 ||
    code === 0x5c ||
    (code >= 0xd800 && code <= 0xdfff)
  ) {
    return JSON.stringify(char).length - 2;
  }
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
};

/** 1 回の送信に載せられる chunk の長さ（エスケープ後の UTF-8 のバイト数）を返す */
const getMaxChunkLength = (dst: SignalingDestination, id: string) => {
  // length と offset は実際の値によらず、最大の桁数で見積もる
  const emptyChunk: SignalingMessageChunk = {
    type: messageType,
    length: Number.MAX_SAFE_INTEGER,
    offset: Number.MAX_SAFE_INTEGER,
    chunk: '',
    id,
  };
  const maxDataLength = getMaxRequestDataLength(dst);
  const wrapperLength = textEncoder.encode(JSON.stringify(emptyChunk)).length;
  const maxChunkLength = maxDataLength - wrapperLength;
  // dst だけで上限を使い切る場合は、上限を超える送信をせずにここで失敗させる
  if (maxChunkLength <= 0) {
    throw new Error(
      `signaling message destination is too large: ${maxDataLength} bytes are available for data, but the chunk wrapper takes ${wrapperLength} bytes`,
    );
  }
  return maxChunkLength;
};

/**
 * エスケープ後の UTF-8 のバイト数が maxLength 以下になるように文字列を分割する。
 * サロゲートペアを分けないようにコードポイント単位で区切る。
 */
const splitByEncodedLength = (text: string, maxLength: number) => {
  const chunks: string[] = [];
  let start = 0;
  let end = 0;
  let chunkLength = 0;
  for (const char of text) {
    const charLength = encodedCharLength(char);
    if (end > start && chunkLength + charLength > maxLength) {
      chunks.push(text.slice(start, end));
      start = end;
      chunkLength = 0;
    }
    chunkLength += charLength;
    end += char.length;
  }
  if (end > start) {
    chunks.push(text.slice(start, end));
  }
  return chunks;
};

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
