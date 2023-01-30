import { Event, Logger } from '@skyway-sdk/common';
import model from '@skyway-sdk/model';
import { ChannelEvent, RtcRpcApiClient } from '@skyway-sdk/rtc-rpc-api-client';

import { RtcApiConfig } from '../config';
import { EventObserver } from '../domain/eventObserver';
import { errors } from '../errors';
import { createError, createWarnPayload } from '../util';

const log = new Logger(
  'packages/rtc-api-client/src/infrastructure/eventObserver.ts'
);

export class EventObserverImpl implements EventObserver {
  readonly onEvent = new Event<ChannelEvent>();
  private _disposer: (() => void)[] = [];

  constructor(
    appId: string,
    client: RtcRpcApiClient,
    channelDto: model.Channel,
    config: RtcApiConfig
  ) {
    const eventBuffer = new EventJitterBuffer(
      channelDto.version,
      async (expectNextVersion) => {
        // ここで回復できなければシステム継続不能

        await client.subscribeChannelEvents({
          appId,
          channelId: channelDto.id,
          offset: expectNextVersion,
        });

        await new Promise((r) => setTimeout(r, config.eventSubscribeTimeout));
        if (eventBuffer.packetLostHappened) {
          log.error(
            createError({
              operationName: 'EventObserverImpl.eventJitterBuffer',
              info: {
                ...errors.internalError,
                detail: 'failed to resolve event lost',
              },
              channelId: channelDto.id,
              appId,
              path: log.prefix,
            })
          );
        }
      }
    );
    this._disposer = [
      client.onEvent.add(async ({ channelId, event }) => {
        if (channelId === channelDto.id) {
          eventBuffer.push({ event, version: event.data.channel.version });
        }
      }).removeListener,
      eventBuffer.onEvent.add((e) => {
        this.onEvent.emit(e as ChannelEvent);
      }).removeListener,
    ];
  }

  dispose() {
    this._disposer.forEach((d) => d());
    this.onEvent.removeAllListeners();
  }
}

export interface EventFrame {
  version: number;
  event: unknown;
}

/**@internal */
export class EventJitterBuffer {
  readonly onEvent = new Event<unknown>();

  private eventBuffer: { [version: number]: EventFrame } = {};

  packetLifeTimer?: any;
  packetLostHappened = false;

  constructor(
    private presentVersion: number,
    private onPacketLost: (expectNextVersion: number) => Promise<void>,
    private packetLifetime = 1000
  ) {}

  private get expectNextVersion() {
    return this.presentVersion + 1;
  }

  push(eventFrame: EventFrame) {
    const incomingVersion = eventFrame.version;

    if (incomingVersion < this.expectNextVersion) {
      log.debug('duplicate event', {
        ...eventFrame,
        presentVersion: this.presentVersion,
      });
      return;
    }

    if (incomingVersion > this.expectNextVersion) {
      log.debug('maybe miss order event received', {
        ...eventFrame,
        presentVersion: this.presentVersion,
      });
      this.eventBuffer[incomingVersion] = eventFrame;

      this.handlePacketLifetime();
      return;
    }

    // expected version event received

    if (this.packetLostHappened) {
      log.warn(
        'event packetLost resolved',
        createWarnPayload({
          operationName: 'EventJitterBuffer.push',
          detail: 'event packetLost resolved',
          payload: { eventFrame },
        })
      );
      this.packetLostHappened = false;
    }
    this.eventBuffer[incomingVersion] = eventFrame;
    this.resolveEvents();
  }

  private handlePacketLifetime() {
    const [oldestBufferedEvent] = Object.keys(this.eventBuffer)
      .sort()
      .map((key) => this.eventBuffer[Number(key)]);

    if (this.packetLifeTimer == undefined && oldestBufferedEvent) {
      log.debug('set event packetLost timer', {
        ...oldestBufferedEvent,
        presentVersion: this.presentVersion,
      });

      this.packetLifeTimer = setTimeout(async () => {
        if (this.presentVersion < oldestBufferedEvent.version) {
          log.warn(
            'event packetLost',
            createWarnPayload({
              operationName: 'EventJitterBuffer.handlePacketLifetime',
              detail: 'eventPacket lost',
              payload: {
                oldestBufferedEvent,
                eventBufferLength: Object.keys(this.eventBuffer).length,
                presentVersion: this.presentVersion,
              },
            })
          );

          if (this.packetLostHappened) {
            return;
          } else {
            this.packetLostHappened = true;
            await this.onPacketLost(this.expectNextVersion);
          }
        }

        this.packetLifeTimer = undefined;
        this.handlePacketLifetime();
      }, this.packetLifetime);
    }
  }

  private resolveEvents() {
    const resolve: EventFrame[] = [];

    for (let i = this.expectNextVersion; ; i++) {
      const frame = this.eventBuffer[i];
      if (frame) {
        resolve.push(frame);
        delete this.eventBuffer[i];
      } else {
        break;
      }
    }
    if (resolve.length > 0) {
      this.presentVersion = resolve.slice(-1)[0].version;

      resolve.forEach((frame) => {
        this.onEvent.emit(frame.event);
      });
    }
  }
}
