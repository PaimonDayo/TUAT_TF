/** Visible/online only, bounded, non-overlapping polling. Resume keeps the interval. */
export function startVisiblePolling<T>({
  intervalMs, load, receive, immediate = false,
}: {
  intervalMs: number;
  load: (signal: AbortSignal) => Promise<T>;
  receive: (value: T) => void;
  immediate?: boolean;
}) {
  let lastAttempt = immediate ? -Infinity : Date.now();
  let stopped = false;
  let pending = false;
  let controller: AbortController | undefined;
  const refresh = async () => {
    if (stopped || pending || document.visibilityState !== "visible" ||
        navigator.onLine === false || Date.now() - lastAttempt < intervalMs) return;
    lastAttempt = Date.now();
    pending = true;
    const request = new AbortController();
    controller = request;
    const timeout = window.setTimeout(() => request.abort(), 25_000);
    try {
      const value = await load(request.signal);
      if (!stopped && !request.signal.aborted) receive(value);
    } catch {
      // Keep the last successful result; try again at the next interval.
    } finally {
      window.clearTimeout(timeout);
      pending = false;
    }
  };
  const resume = () => { void refresh(); };
  const timer = window.setInterval(resume, intervalMs);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  if (immediate) resume();
  return () => {
    stopped = true;
    controller?.abort();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("online", resume);
  };
}
