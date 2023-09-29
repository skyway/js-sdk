import { Logger } from './logger';

const log = new Logger('packages/common/src/promise.ts');

/**@internal */
export class PromiseQueue {
  private id = Math.random().toString().slice(2);
  queue: {
    promise: () => Promise<unknown>;
    done: (...args: any[]) => void;
    failed: (...args: any[]) => void;
  }[] = [];
  running = false;

  push = <T extends any>(promise: () => Promise<T>) =>
    new Promise<T>((r, f) => {
      this.queue.push({ promise, done: r, failed: f });
      if (!this.running) {
        this.run().catch((e) => {
          log.error('push', e);
        });
      }
    });

  private async run() {
    const task = this.queue.shift();
    if (task) {
      this.running = true;
      // log.debug('[start] task', { id: this.id, task });

      try {
        const res = await task.promise();
        task.done(res);
      } catch (error) {
        task.failed(error);
      }

      // log.debug('[end] task', { id: this.id, task });

      await this.run();
    } else {
      this.running = false;
    }
  }
}
