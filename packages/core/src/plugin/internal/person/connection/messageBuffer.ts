import { EventDisposer, Logger } from '@skyway-sdk/common';

import { MessageEvent, SignalingSession } from '../../../../external/signaling';

const log = new Logger(
  'packages/core/src/plugin/internal/person/connection/messageBuffer.ts'
);

/*
connectionが生成されるイベントの通信経路と、
メッセージングの通信経路が違うので、
connectionが生成される前にメッセージを受信する
タイミング問題が起きうる。
その対策のためのコンポーネント
*/

export class MessageBuffer {
  private _indicateMessageBuffer: {
    [requesterIdName: string]: MessageEvent[];
  } = {};
  private _excludeConnectionIndicateBuffering = new Set<string>();
  private _disposer = new EventDisposer();

  constructor(readonly signaling: SignalingSession) {
    this.signaling.onMessage
      .add((req) => {
        const requesterIdName = req.src.id + req.src.name;

        if (this._excludeConnectionIndicateBuffering.has(requesterIdName)) {
          return;
        }

        if (!this._indicateMessageBuffer[requesterIdName]) {
          this._indicateMessageBuffer[requesterIdName] = [];
        }
        this._indicateMessageBuffer[requesterIdName].push(req);
      })
      .disposer(this._disposer);
  }

  resolveMessagingBuffer({ id, name }: { id: string; name?: string }) {
    const endpointIdName = id + name;

    const bufferedIndicates = this._indicateMessageBuffer[endpointIdName];
    if (bufferedIndicates?.length > 0) {
      log.debug('resolveMessagingBuffer', { length: bufferedIndicates.length });

      bufferedIndicates.forEach((req) => {
        this.signaling.onMessage.emit(req);
      });
      delete this._indicateMessageBuffer[endpointIdName];
    }
    this._excludeConnectionIndicateBuffering.add(endpointIdName);
  }

  close() {
    this._disposer.dispose();
    this._indicateMessageBuffer = {};
    this._excludeConnectionIndicateBuffering = new Set();
  }
}
