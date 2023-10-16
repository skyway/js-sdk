/**@internal */
export class BackOff {
  count = 0;
  readonly times: number = 8;
  /**ms */
  readonly interval: number = 100;
  /**ms */
  readonly jitter: number = 0;

  /**20.4 sec {var sum=0;for(i=0;i<=8;i++){sum +=i ** 2 * 100}} */
  constructor(
    props: Partial<Pick<BackOff, 'times' | 'interval' | 'jitter'>> = {}
  ) {
    Object.assign(this, props);
  }

  /**if need wait return true */
  async wait() {
    if (this.exceeded) {
      return false;
    }
    const timeout = this.timeout;
    this.count++;

    await new Promise((r) => setTimeout(r, timeout));
    return true;
  }

  get timeout() {
    const timeout =
      this.count ** 2 * this.interval +
      this.count ** 2 * this.jitter * Math.random();
    return timeout;
  }

  get exceeded() {
    return this.count >= this.times;
  }

  reset() {
    this.count = 0;
  }
}

/**@internal */
export const deepCopy = <T = object>(o: T): T => JSON.parse(JSON.stringify(o));

/**@internal */
export interface RuntimeInfo {
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
}
