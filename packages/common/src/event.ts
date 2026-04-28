import { Logger } from './logger';

const log = new Logger('packages/common/src/event.ts');

type EventExecute<T> = (arg: T) => void;

export interface EventInterface<T> {
  emit: (arg: T) => void;
  removeAllListeners: () => void;
  add: (callback: (args: T) => void) => {
    removeListener: () => void;
    disposer: (disposer: EventDisposerInterface) => void;
  };
  once: (callback: (arg: T) => void) => {
    removeListener: () => void;
    disposer: (disposer: EventDisposerInterface) => void;
  };
  asPromise: (timeLimit?: number) => Promise<T>;
  watch: (
    callback: (arg: T) => boolean | undefined | null,
    timeLimit?: number,
  ) => Promise<T>;
}

interface PrivateEventInterface<T> extends EventInterface<T> {
  asPromise: (
    timeLimit?: number,
    disposer?: PrivateEventDisposerInterface,
  ) => Promise<T>;
  watch: (
    callback: (arg: T) => boolean | undefined | null,
    timeLimit?: number,
    disposer?: PrivateEventDisposerInterface,
  ) => Promise<T>;
}

export class Event<T> implements PrivateEventInterface<T> {
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

    const disposer = (disposer: EventDisposerInterface) => {
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
  asPromise = (timeLimit?: number, disposer?: PrivateEventDisposerInterface) =>
    new Promise<T>((resolve, reject) => {
      const off = this.once((arg) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(arg);
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let cancel = () => {};
      const cleanup = () => {
        off.removeListener();
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        disposer?.remove(cancel);
      };
      cancel = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
      };
      if (timeLimit) {
        timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(
            new SerializableError(`Event asPromise timeout : ${timeLimit}`),
          );
        }, timeLimit);
      }
      disposer?.push(cancel);
    });

  /**
   * イベントが起きた時に実行される boolean を返す関数を登録する。
   * 登録した関数が true を返した時に Promise が resolve される
   * */
  watch = (
    callback: (arg: T) => boolean | undefined | null,
    /**ms */
    timeLimit?: number,
    disposer?: PrivateEventDisposerInterface,
  ) =>
    new Promise<T>((resolve, reject) => {
      const off = this.add((arg) => {
        const done = callback(arg);
        if (done) {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(arg);
        }
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let cancel = () => {};
      const cleanup = () => {
        off.removeListener();
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        disposer?.remove(cancel);
      };
      cancel = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
      };
      if (timeLimit) {
        timeout = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(new SerializableError(`Event watch timeout : ${timeLimit}`));
        }, timeLimit);
      }
      disposer?.push(cancel);
    });

  /**@internal */
  get length() {
    return this._stack.length;
  }
}

/**@internal */
export class Events {
  events: Event<any>[] = [];

  make<T>() {
    const event = new Event<T>();
    this.events.push(event);
    return event;
  }

  dispose() {
    this.events.forEach((event) => {
      event.removeAllListeners();
    });
    this.events = [];
  }
}

/**@internal */
export interface EventDisposerInterface {
  push: (disposer: () => void) => void;
  dispose: () => void;
}

interface PrivateEventDisposerInterface extends EventDisposerInterface {
  remove: (disposer: () => void) => void;
}

/**@internal */
export class EventDisposer implements PrivateEventDisposerInterface {
  private _disposer: (() => void)[] = [];

  push(disposer: () => void) {
    this._disposer.push(disposer);
  }

  remove(disposer: () => void) {
    this._disposer = this._disposer.filter((item) => item !== disposer);
  }

  dispose() {
    this._disposer.forEach((d) => {
      d();
    });
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
