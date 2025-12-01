import { Event, Logger } from '@skyway-sdk/common';

import { errors } from '../../../errors';
import { createError } from '../../../util';
import { LocalStreamBase } from '.';

const log = new Logger('packages/core/src/media/stream/local/data.ts');

/**@description [japanese] DataStreamにて送受信できるデータの型。object型のデータを送信する場合、ArrayBufferなどの`JSON.stringify`に非対応な型をプロパティとして含めると正しいデータが送受信されないため、別途エンコード・デコード処理の実装が必要。 */
export type DataStreamMessageType = string | ArrayBuffer | object;

export class LocalDataStream extends LocalStreamBase {
  readonly contentType = 'data';
  /**@private */
  readonly _onWriteData = new Event<DataStreamMessageType>();
  private _isEnabled = true;

  /**
   * @description [japanese] データストリームが書き込み可能な状態になったことを通知するイベント
   * イベントデータとして、書き込み可能になったデータストリームのSubscriberの情報が通知される。
   */
  readonly onWritable = new Event<DataStreamSubscriber>();
  /**
   * @description [japanese] データストリームが書き込み不可能な状態になったことを通知するイベント。
   * イベントデータとして、書き込み不可能になったデータストリームのSubscriberの情報が通知される。
   */
  readonly onUnwritable = new Event<DataStreamSubscriber>();

  constructor(public readonly options: DataStreamOptions = {}) {
    super('data');
    this._setLabel('LocalDataStream');
  }

  /**@internal */
  setIsEnabled(b: boolean) {
    this._isEnabled = b;
  }

  /**@description [japanese] データを送信する */
  write(data: DataStreamMessageType) {
    if (!this._isEnabled) {
      throw createError({
        operationName: 'LocalDataStream.write',
        path: log.prefix,
        info: errors.disabledDataStream,
      });
    }

    const isObject = !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer) && !(typeof data === 'string');
    if (isObject) {
      data = objectFlag + JSON.stringify(data);
    }
    this._onWriteData.emit(data);
  }
}

/**@internal */
export const objectFlag = 'skyway_object:';

export type DataStreamOptions = {
  /**
   * @description [japanese] 再送待ち時間上限
   */
  maxPacketLifeTime?: number;
  /**
   * @description [japanese] 再送回数上限
   */
  maxRetransmits?: number;
  /**
   * @description [japanese] 順序制御
   */
  ordered?: boolean;
};

/**@description [japanese] データストリームをSubscribeしているMemberの情報 */
export type DataStreamSubscriber = {
  id: string,
  name?: string,
};
