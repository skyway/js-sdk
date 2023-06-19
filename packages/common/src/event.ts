import { Logger } from './logger';

const log = new Logger('packages/common/src/event.ts');

type EventExecute<T extends any> = (arg: T) => void;

export class Event<T extends any> {
  private _stack: {
    execute: EventExecute<T>;
    id: number;
  }[] = [];
  private _eventIndex = 0;

  /**@internal */
  constructor(private _onSetListener: () => void = () => {}) {}

  /**@internal */
  emit = (arg: T) => {
    for (const task of this._stack) {
      try {
        task.execute(arg);
      } catch (error) {
        log.error('task throws error', error);
      }
    }
  };

  /**@internal */
  removeAllListeners = () => {
    this._stack = [];
  };

  /**@internal */
  pipe = (event: Event<T>) => {
    return this.add((arg) => event.emit(arg));
  };

  /**
   * イベントが起きた時に実行する関数を登録する。
   * 戻り値として関数の登録を解除する関数が帰ってくる
   */
  add = (callback: (args: T) => void) => {
    const id = this._eventIndex;
    this._stack.push({ execute: callback, id });
    this._eventIndex++;

    const removeListener = () => {
      this._stack = this._stack.filter((item) => item.id !== id && item);
    };

    const disposer = (disposer: EventDisposer) => {
      disposer.push(removeListener);
    };

    this._onSetListener();

    return { removeListener, disposer };
  };

  /**イベントが起きた時に一度だけ実行される関数を登録する */
  once = (callback: (arg: T) => void) => {
    const off = this.add((arg) => {
      off.removeListener();
      callback(arg);
    });
    return off;
  };

  /**
   * イベントが起きた時に Promise が resolve される
   * @param timeLimit ms
   */
  asPromise = (timeLimit?: number) =>
    new Promise<T>((resolve, reject) => {
      const timeout =
        timeLimit &&
        setTimeout(() => {
          reject(
            new SerializableError('Event asPromise timeout : ' + timeLimit)
          );
        }, timeLimit);
      this.once((arg) => {
        if (timeout) clearTimeout(timeout);
        resolve(arg);
      });
    });

  /**
   * イベントが起きた時に実行される boolean を返す関数を登録する。
   * 登録した関数が true を返した時に Promise が resolve される
   * */
  watch = (
    callback: (arg: T) => boolean | undefined | null,
    /**ms */
    timeLimit?: number
  ) =>
    new Promise<T>((resolve, reject) => {
      const timeout =
        timeLimit &&
        setTimeout(() => {
          reject(new SerializableError('Event watch timeout : ' + timeLimit));
        }, timeLimit);

      const { removeListener } = this.add((arg) => {
        const done = callback(arg);
        if (done) {
          if (timeout) clearTimeout(timeout);
          removeListener();
          resolve(arg);
        }
      });
    });

  /**@internal */
  get length() {
    return this._stack.length;
  }
}

/**@internal */
export class Events {
  events: Event<any>[] = [];

  make<T extends any>() {
    const event = new Event<T>();
    this.events.push(event);
    return event;
  }

  dispose() {
    this.events.forEach((event) => event.removeAllListeners());
    this.events = [];
  }
}

/**@internal */
export class EventDisposer {
  private _disposer: (() => void)[] = [];

  push(disposer: () => void) {
    this._disposer.push(disposer);
  }

  dispose() {
    this._disposer.forEach((d) => d());
    this._disposer = [];
  }
}

class SerializableError extends Error {
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,
    };
  }
}
