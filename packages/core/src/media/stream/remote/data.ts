import { Event, Logger } from '@skyway-sdk/common';
import { createWarnPayload } from '../../../util';
import { type DataStreamMessageType, objectFlag } from '../local/data';
import { RemoteStreamBase } from './base';

const log = new Logger('packages/core/src/media/stream/remote/data.ts');
const textEncoder = new TextEncoder();

/**@internal */
export const remoteDataStreamMessageBufferMaxSize = 10 * 1024 * 1024;

export class RemoteDataStream extends RemoteStreamBase {
  private _isEnabled = true;
  private _bufferingUntilFirstListener = true;
  private _bufferedMessages: DataStreamMessageType[] = [];
  private _bufferedMessageSize = 0;
  private _hasWarnedBufferOverflow = false;
  readonly contentType = 'data';
  readonly onData = new Event<DataStreamMessageType>(() => {
    this._queueFlushBufferedMessages();
  });

  /**@internal */
  constructor(
    id: string,
    /**@internal */
    public _datachannel: RTCDataChannel,
  ) {
    super(id, 'data');

    _datachannel.onmessage = ({ data }) => {
      if (!this._isEnabled) {
        return;
      }

      const parsed = this._parseMessage(data);

      if (this._bufferingUntilFirstListener) {
        this._bufferIncomingMessage(parsed);
        return;
      }

      this.onData.emit(parsed);
    };

    _datachannel.onclose = () => {
      this._clearBufferedMessages();
    };
  }

  /**@internal */
  setIsEnabled(b: boolean) {
    this._isEnabled = b;
    if (!b) {
      // Streamが無効化された場合はバッファリングしているデータを破棄する
      this._clearBufferedMessages();
    }
  }

  private _parseMessage(data: unknown) {
    if (typeof data === 'string' && data.startsWith(objectFlag)) {
      try {
        return JSON.parse(
          data.slice(objectFlag.length),
        ) as DataStreamMessageType;
      } catch {
        return data as DataStreamMessageType;
      }
    }

    return data as DataStreamMessageType;
  }

  private _bufferIncomingMessage(data: DataStreamMessageType) {
    const size = this._estimateMessageSize(data);

    if (
      this._bufferedMessageSize + size >
      remoteDataStreamMessageBufferMaxSize
    ) {
      if (!this._hasWarnedBufferOverflow) {
        log.warn(
          createWarnPayload({
            operationName: 'RemoteDataStream._bufferIncomingMessage',
            detail:
              'remote data stream receive buffer overflowed before onData listener was set; dropping newly received data',
            payload: {
              streamId: this.id,
              bufferSize: this._bufferedMessageSize,
              incomingDataSize: size,
              maxBufferSize: remoteDataStreamMessageBufferMaxSize,
            },
          }),
        );
        this._hasWarnedBufferOverflow = true;
      }
      return;
    }

    this._bufferedMessages.push(data);
    this._bufferedMessageSize += size;
  }

  private _flushBufferedMessages() {
    if (!this._bufferingUntilFirstListener || this.onData.length === 0) {
      return;
    }

    this._bufferingUntilFirstListener = false;

    const bufferedMessages = this._bufferedMessages;
    this._bufferedMessages = [];
    this._bufferedMessageSize = 0;
    this._hasWarnedBufferOverflow = false;

    // 無効なStreamのデータはユーザに渡さない
    if (!this._isEnabled) {
      return;
    }

    bufferedMessages.forEach((data) => {
      this.onData.emit(data);
    });
  }

  private _clearBufferedMessages() {
    this._bufferedMessages = [];
    this._bufferedMessageSize = 0;
    this._hasWarnedBufferOverflow = false;
  }

  private _estimateMessageSize(data: DataStreamMessageType) {
    if (typeof data === 'string') {
      return textEncoder.encode(data).byteLength;
    }

    if (data instanceof Blob) {
      return data.size;
    }

    if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }

    if (ArrayBuffer.isView(data)) {
      return data.byteLength;
    }

    return textEncoder.encode(JSON.stringify(data)).byteLength;
  }

  private _queueFlushBufferedMessages() {
    if (!this._bufferingUntilFirstListener || this.onData.length === 0) {
      return;
    }

    queueMicrotask(() => {
      this._flushBufferedMessages();
    });
  }
}
