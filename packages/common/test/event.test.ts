import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Event, EventDisposer } from '../src/event';

describe('Event', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asPromise は timeout 後に listener を解除する', async () => {
    const event = new Event<string>();
    const promise = event.asPromise(100);
    const timeoutError = promise.catch((error) => error);

    expect(event.length).toBe(1);

    await vi.advanceTimersByTimeAsync(100);

    await expect(timeoutError).resolves.toMatchObject({
      message: 'Event asPromise timeout : 100',
    });
    expect(event.length).toBe(0);
  });

  it('watch は timeout 後に listener を解除して stale callback を呼ばない', async () => {
    const event = new Event<string>();
    const callback = vi.fn(() => false);
    const promise = event.watch(callback, 100);
    const timeoutError = promise.catch((error) => error);

    event.emit('before-timeout');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(event.length).toBe(1);

    await vi.advanceTimersByTimeAsync(100);

    await expect(timeoutError).resolves.toMatchObject({
      message: 'Event watch timeout : 100',
    });
    expect(event.length).toBe(0);

    event.emit('after-timeout');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('asPromise は resolve 後に listener を解除する', async () => {
    const event = new Event<string>();
    const promise = event.asPromise(100);

    expect(event.length).toBe(1);

    event.emit('resolved');

    await expect(promise).resolves.toBe('resolved');
    expect(event.length).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(event.length).toBe(0);
  });

  it('asPromise は disposer 経由で listener と timeout を解除する', async () => {
    const event = new Event<string>();
    const disposer = new EventDisposer();
    const resolve = vi.fn();
    const reject = vi.fn();

    event.asPromise(100, disposer).then(resolve, reject);

    expect(event.length).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    disposer.dispose();

    expect(event.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    event.emit('after-dispose');
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('watch は条件一致で resolve した後に listener を解除する', async () => {
    const event = new Event<string>();
    const callback = vi.fn((arg: string) => arg === 'resolved');
    const promise = event.watch(callback, 100);

    event.emit('pending');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(event.length).toBe(1);

    event.emit('resolved');

    await expect(promise).resolves.toBe('resolved');
    expect(callback).toHaveBeenCalledTimes(2);
    expect(event.length).toBe(0);

    event.emit('after-resolve');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('watch は disposer 経由で listener と timeout を解除する', async () => {
    const event = new Event<string>();
    const disposer = new EventDisposer();
    const callback = vi.fn(() => false);
    const resolve = vi.fn();
    const reject = vi.fn();

    event.watch(callback, 100, disposer).then(resolve, reject);

    expect(event.length).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    disposer.dispose();

    expect(event.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    event.emit('after-dispose');
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(callback).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('EventDisposer は登録解除した disposer を保持しない', () => {
    const disposer = new EventDisposer();
    const callback = vi.fn();

    disposer.push(callback);
    disposer.remove(callback);
    disposer.dispose();

    expect(callback).not.toHaveBeenCalled();
  });
});
