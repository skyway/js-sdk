type EventExecute<T> = (arg: T) => void;

export class Event<T> {
  private _listeners = new Map<number, EventExecute<T>>();

  private _listenerIndex = 0;

  emit = (arg: T): void => {
    this._listeners.forEach((listener) => listener(arg));
  };

  removeAllListeners = (): void => {
    this._listeners.clear();
  };

  addListener = (listener: EventExecute<T>): { removeListener: () => void } => {
    const id = this._listenerIndex;
    this._listeners.set(id, listener);
    this._listenerIndex++;
    const removeListener = () => {
      this._listeners.delete(id);
    };

    return { removeListener };
  };

  addOneTimeListener = (listener: EventExecute<T>): { removeListener: () => void } => {
    const off = this.addListener((arg) => {
      off.removeListener();
      listener(arg);
    });

    return off;
  };

  asPromise = (timeLimit?: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let removeListener = () => {};
      const timeout =
        timeLimit &&
        setTimeout(() => {
          reject('Event asPromise timeout');
          removeListener();
        }, timeLimit);

      const off = this.addOneTimeListener((arg) => {
        if (timeout) clearTimeout(timeout);
        resolve(arg);
      });
      removeListener = off.removeListener;
    });
}
