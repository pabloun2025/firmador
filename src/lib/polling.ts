/** Wait after each response, rather than accumulating overlapping requests. */
export function startPolling(task: () => Promise<unknown>, interval: number, onError: (error: unknown) => void = () => {}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  async function tick() {
    try {
      if (document.visibilityState !== 'hidden' && navigator.onLine !== false) await task();
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      if (!stopped) timer = setTimeout(tick, interval);
    }
  }
  timer = setTimeout(tick, interval);
  return () => { stopped = true; clearTimeout(timer); };
}
