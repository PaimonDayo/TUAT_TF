const REFRESH_MS = 5 * 60_000;

/** 表示中だけ取得。復帰時も間隔を守り、通信失敗時は直前の表示を残す。 */
export function startCompetitionProgramPolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  receive: (data: T) => void,
  isCompetitionDay: () => boolean,
) {
  let lastAttempt = Date.now();
  let pending = false;
  let stopped = false;
  let controller: AbortController | undefined;
  const refresh = async () => {
    if (stopped || pending || document.visibilityState !== "visible" ||
        !isCompetitionDay() || Date.now() - lastAttempt < REFRESH_MS) return;
    lastAttempt = Date.now();
    pending = true;
    controller = new AbortController();
    const requestController = controller;
    const timeout = window.setTimeout(() => requestController.abort(), 25_000);
    try {
      const data = await load(requestController.signal);
      if (!stopped && !requestController.signal.aborted) receive(data);
    } catch {
      // オフライン・認証失効・一時障害でも取得済みのプログラムは消さない。
    } finally {
      window.clearTimeout(timeout);
      pending = false;
    }
  };
  const resume = () => { void refresh(); };
  const timer = window.setInterval(resume, 60_000);
  document.addEventListener("visibilitychange", resume);
  return () => {
    stopped = true;
    controller?.abort();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
  };
}
