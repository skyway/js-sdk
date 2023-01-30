import { Logger } from './logger';

const log = new Logger('packages/common/src/error.ts');

export class SkyWayError<
  PayloadType extends Record<string, any> = Record<string, any>
> extends Error {
  private readonly id = Math.random().toString().slice(2, 10);
  payload?: PayloadType;
  path?: string;
  error?: Error;
  info!: ErrorInfo;

  /**@internal */
  constructor(
    init: Pick<SkyWayError<PayloadType>, 'path' | 'payload' | 'error' | 'info'>,
    logging = true
  ) {
    super(init.info.detail);
    Object.assign(this, init);
    this.name = this.info.name;

    if (logging) {
      const messages: any[] = [
        'SkyWayError',
        `name:${this.info.name}, detail:${this.info.detail}, solution:${this.info.solution}`,
      ];
      if (this.path) {
        messages.push(this.path);
      }
      if (this.error) {
        messages.push(this.error);
      }
      if (this.payload) {
        messages.push(this.payload);
      }
      messages.push(this.id);

      log.warn(...messages);
    }
  }

  toJSON() {
    return {
      id: this.id,
      info: this.info,
      path: this.path,
      payload: this.payload,
      error: this.error,
      stack: this.stack,
    };
  }
}

/**@internal */
export interface ErrorInfo {
  name: string;
  detail: string;
  solution: string;
}
