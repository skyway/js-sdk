import { Event } from '@skyway-sdk/common';

import { DataStreamMessageType, objectFlag } from '../local/data';
import { RemoteStreamBase } from './base';

export class RemoteDataStream extends RemoteStreamBase {
  private _isEnabled = true;
  readonly contentType = 'data';
  readonly onData = new Event<DataStreamMessageType>();

  /**@internal */
  constructor(
    id: string,
    /**@internal */
    public _datachannel: RTCDataChannel
  ) {
    super(id, 'data');

    _datachannel.onmessage = ({ data }) => {
      if (!this.isEnabled) {
        return;
      }

      if (typeof data === 'string' && data.includes(objectFlag)) {
        data = JSON.parse(data.slice(objectFlag.length));
      }
      this.onData.emit(data);
    };
  }

  /**@internal */
  get isEnabled() {
    return this._isEnabled;
  }

  /**@internal */
  setIsEnabled(b: boolean) {
    this._isEnabled = b;
  }
}
