import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LogFormat, Logger, type LogLevel } from '../src/logger';

describe('Logger', () => {
  let previousLevel: LogLevel;
  let previousFormat: LogFormat;
  let previousOnLog: typeof Logger.onLog;
  let previousOnLogForAnalytics: typeof Logger._onLogForAnalytics;

  beforeEach(() => {
    previousLevel = Logger.level;
    previousFormat = Logger.format;
    previousOnLog = Logger.onLog;
    previousOnLogForAnalytics = Logger._onLogForAnalytics;

    Logger.level = 'debug';
    Logger.format = 'object';
    Logger.onLog = () => {};
    Logger._onLogForAnalytics = () => {};

    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    Logger.level = previousLevel;
    Logger.format = previousFormat;
    Logger.onLog = previousOnLog;
    Logger._onLogForAnalytics = previousOnLogForAnalytics;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('JSTの固定形式でtimestampを生成する', () => {
    vi.setSystemTime(new Date('2024-01-01T01:02:03.004Z'));

    const logger = new Logger('logger.test.ts');
    let timestamp = '';
    Logger.onLog = ({ timestamp: value }) => {
      timestamp = value;
    };

    logger.info('test');

    expect(timestamp).toBe('2024-01-01T10:02:03.004+09:00');
  });

  it('UTCの日付跨ぎでもJSTのtimestampを正しく生成する', () => {
    vi.setSystemTime(new Date('2024-01-01T18:59:59.987Z'));

    const logger = new Logger('logger.test.ts');
    let timestamp = '';
    Logger.onLog = ({ timestamp: value }) => {
      timestamp = value;
    };

    logger.info('test');

    expect(timestamp).toBe('2024-01-02T03:59:59.987+09:00');
  });

  it('Intl.DateTimeFormatを呼ばなくてもtimestamp生成に影響しない', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00.001Z'));

    const dateTimeFormatSpy = vi.spyOn(Intl, 'DateTimeFormat');

    const logger = new Logger('logger.test.ts');
    let timestamp = '';
    Logger.onLog = ({ timestamp: value }) => {
      timestamp = value;
    };

    expect(() => logger.info('test')).not.toThrow();
    expect(timestamp).toBe('2024-01-01T09:00:00.001+09:00');
    expect(dateTimeFormatSpy).not.toHaveBeenCalled();
  });

  it('string形式ログでも同じtimestampを先頭に含める', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00.001Z'));
    Logger.format = 'string';

    const logger = new Logger('logger.test.ts');
    logger.info('test');

    const infoCall = vi.mocked(console.info).mock.calls[0];
    expect(typeof infoCall[0]).toBe('string');
    expect(infoCall[0].startsWith('2024-01-01T09:00:00.001+09:00')).toBe(true);
  });
});
