/**
 * @description [japanese]
 * 以下のいずれかを指定可能
 * - disable: ログの出力を無効化する。
 * - error: 回復不能なエラーに関する情報を出力する。
 * - warn: SDK 内部で発生した、一時的なエラーに関する情報を出力する。基本的には SDK が内部でリトライ処理を行うことで回復する。
 * - info: SDK が提供しているメソッドの呼び出しに関する情報を出力する。
 * - debug: SDK の内部のメソッド呼び出しや、リクエスト・レスポンスに関する情報など、最も詳細なログを出力する。
 */
export const logLevelTypes = [
  'disable',
  'error',
  'warn',
  'info',
  'debug',
] as const;
export type LogLevel = (typeof logLevelTypes)[number];
export type LogFormat = 'object' | 'string';

export type OnLogForAnalyticsProps = {
  level: string;
  timestamp: string;
  message: any[];
  id: string;
  prefix: string;
};

export class Logger {
  static level: LogLevel = 'error';
  static format: LogFormat = 'object';
  static onLog: (props: {
    level: string;
    timestamp: string;
    message: any[];
    id: string;
  }) => void = () => {};
  /**@internal */
  static _onLogForAnalytics: (props: OnLogForAnalyticsProps) => void = () => {};

  /**@internal */
  static readonly id = Math.random().toString().slice(2, 7);
  static readonly formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  /**@internal */
  prefix: string;

  /**@internal */
  constructor(prefix: string) {
    this.prefix = prefix;
  }

  /**@internal */
  debug = (...msg: any[]) => {
    this._log('debug', ...msg);
    return Date.now();
  };

  /**@internal */
  info = (...msg: any[]) => {
    this._log('info', ...msg);
    return Date.now();
  };

  /**@internal */
  warn = (...msg: any[]) => {
    this._log('warn', ...msg);
  };

  /**@internal */
  error = (...msg: any[]) => {
    this._log('error', ...msg);
  };

  /**@internal */
  elapsed = (timestamp: number, ...msg: any[]) => {
    const elapsed = Date.now() - timestamp;
    this._log('info', `elapsed ms:${elapsed}`, ...msg);
  };

  private _log(level: LogLevel, ...msg: any[]) {
    const logType = logLevelTypes.indexOf(level);
    const logLevel = logLevelTypes.indexOf(Logger.level);

    if (logLevel >= logType) {
      const now = new Date();

      const parts = Logger.formatter.formatToParts(now);
      const get = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((p) => p.type === type)?.value;

      const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

      const timestamp = `${get('year')}-${get('month')}-${get('day')}T${get(
        'hour'
      )}:${get('minute')}:${get('second')}.${milliseconds}+09:00`;

      const parsed = [this.prefix, ...msg].map((m) => {
        if (m instanceof Error) {
          if ((m as any).toJSON) {
            return (m as any).toJSON() as object;
          }
          return { name: m.name, message: m.message, stack: m.stack };
        }
        if (typeof m === 'object') {
          try {
            return JSON.parse(JSON.stringify(m)) as object;
          } catch (error) {
            return 'json error';
          }
        }

        return m as object;
      });
      msg = parsed;

      let log = [timestamp, level, ...msg];
      if (Logger.format === 'string') {
        log = [timestamp + ' ' + level + ' ' + JSON.stringify(msg)];
      }

      switch (level) {
        case 'debug':
          console.debug(...log);
          break;
        case 'info':
          console.info(...log);
          break;
        case 'warn':
          console.warn(...log);
          break;
        case 'error':
          console.error(...log);
          break;
      }

      Logger.onLog({
        id: Logger.id,
        timestamp,
        level,
        message: msg,
      });
      Logger._onLogForAnalytics({
        id: Logger.id,
        timestamp,
        level,
        message: msg,
        prefix: this.prefix,
      });
    }
  }

  /**@internal */
  createBlock(info: object) {
    return {
      warn: (...msg: any[]) => {
        this.warn({ ...info }, ...msg);
      },
      debug: (...msg: any[]) => {
        this.debug({ ...info }, ...msg);
      },
      info: (...msg: any[]) => {
        this.info({ ...info }, ...msg);
      },
      error: (...msg: any[]) => {
        this.error({ ...info }, ...msg);
      },
    };
  }
}
