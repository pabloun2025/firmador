import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startPolling } from '../src/lib/polling';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('waits until a slow request finishes before scheduling another', async () => {
  let finish!: () => void;
  let calls = 0;
  const stop = startPolling(() => { calls++; return new Promise<void>(resolve => { finish = resolve; }); }, 5000);
  await vi.advanceTimersByTimeAsync(20000);
  expect(calls).toBe(1);
  finish();
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls).toBe(2);
  stop(); finish();
});

it.each(['hidden', 'offline'])('pauses automatic traffic when %s and resumes safely', async state => {
  if (state === 'hidden') vi.stubGlobal('document', { visibilityState: 'hidden' });
  else vi.stubGlobal('navigator', { onLine: false });
  let calls = 0;
  const stop = startPolling(async () => { calls++; }, 5000);
  await vi.advanceTimersByTimeAsync(15000);
  expect(calls).toBe(0);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('navigator', { onLine: true });
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls).toBe(1);
  stop();
});

it('reports a failure once per interval without a tight retry loop', async () => {
  const failures: unknown[] = [];
  const stop = startPolling(async () => { throw new Error('network'); }, 5000, error => failures.push(error));
  await vi.advanceTimersByTimeAsync(10000);
  expect(failures).toHaveLength(2);
  stop();
  await vi.advanceTimersByTimeAsync(20000);
  expect(failures).toHaveLength(2);
});

it('does not restart after unmounting during an outstanding request', async () => {
  let finish!: () => void;
  let calls = 0;
  const stop = startPolling(() => { calls++; return new Promise<void>(resolve => { finish = resolve; }); }, 5000);
  await vi.advanceTimersByTimeAsync(5000);
  stop(); finish();
  await vi.advanceTimersByTimeAsync(20000);
  expect(calls).toBe(1);
});
