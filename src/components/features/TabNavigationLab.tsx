"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type TabLabMode = "empty" | "light" | "home";

type TabKey = "home" | "schedule" | "timeline" | "notes" | "mypage";
type Sample = { tab: TabKey; ms: number; at: number };

const TABS: { key: TabKey; label: string }[] = [
  { key: "home", label: "ホーム" },
  { key: "schedule", label: "予定" },
  { key: "timeline", label: "タイムライン" },
  { key: "notes", label: "ノート" },
  { key: "mypage", label: "マイページ" },
];

const MODE_LABELS: Record<TabLabMode, string> = {
  empty: "A: 空画面",
  light: "B: 軽量DOM",
  home: "C: 現ホーム",
};

export function TabNavigationLab({
  mode,
  homeContent,
}: {
  mode: TabLabMode;
  homeContent?: ReactNode;
}) {
  const [active, setActive] = useState<TabKey>("schedule");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [maxGap, setMaxGap] = useState(0);
  const [copied, setCopied] = useState(false);
  const pendingTap = useRef<{ tab: TabKey; startedAt: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<TabKey, number>>({
    home: 0,
    schedule: 0,
    timeline: 0,
    notes: 0,
    mypage: 0,
  });
  const maxGapRef = useRef(0);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = scrollPositions.current[active];
    const pending = pendingTap.current;
    if (!pending || pending.tab !== active) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const sample = {
          tab: active,
          ms: Math.round((performance.now() - pending.startedAt) * 10) / 10,
          at: Date.now(),
        } satisfies Sample;
        setSamples((current) => [...current.slice(-99), sample]);
        pendingTap.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [active]);

  useEffect(() => {
    let last = performance.now();
    const resetClock = () => { last = performance.now(); };
    const heartbeat = window.setInterval(() => {
      const now = performance.now();
      const gap = Math.max(0, now - last - 250);
      last = now;
      if (document.visibilityState === "visible") {
        maxGapRef.current = Math.max(maxGapRef.current, gap);
      }
    }, 250);
    const publish = window.setInterval(() => {
      setMaxGap(Math.round(maxGapRef.current));
    }, 1000);
    document.addEventListener("visibilitychange", resetClock);
    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(publish);
      document.removeEventListener("visibilitychange", resetClock);
    };
  }, []);

  const worst = samples.reduce((value, sample) => Math.max(value, sample.ms), 0);
  const average = samples.length
    ? samples.reduce((sum, sample) => sum + sample.ms, 0) / samples.length
    : 0;

  useEffect(() => {
    try {
      localStorage.setItem("tuat-tab-lab-report", JSON.stringify({
        mode,
        switches: samples.length,
        averageMs: Math.round(average * 10) / 10,
        worstMs: worst,
        maxEventLoopGapMs: maxGap,
        recent: samples.slice(-20),
        updatedAt: Date.now(),
      }));
    } catch {
      // 計測保存の失敗はラボ操作を妨げない。
    }
  }, [average, maxGap, mode, samples, worst]);

  function selectTab(tab: TabKey, startedAt: number) {
    if (tab === active) return;
    if (viewport.current) scrollPositions.current[active] = viewport.current.scrollTop;
    pendingTap.current = { tab, startedAt };
    try {
      const attempts = JSON.parse(localStorage.getItem("tuat-tab-lab-attempts") ?? "[]") as unknown[];
      localStorage.setItem("tuat-tab-lab-attempts", JSON.stringify([
        ...attempts.slice(-49),
        { mode, from: active, to: tab, at: startedAt },
      ]));
    } catch {
      // Failure logging must never block tab switching.
    }

    setActive(tab);
  }

  function resetMetrics() {
    setSamples([]);
    setMaxGap(0);
    maxGapRef.current = 0;
    try { localStorage.removeItem("tuat-tab-lab-report"); localStorage.removeItem("tuat-tab-lab-attempts"); } catch { /* ignore */ }
  }

  async function copyReport() {
    const report = JSON.stringify({
      metrics: JSON.parse(localStorage.getItem("tuat-tab-lab-report") ?? "null"),
      attempts: JSON.parse(localStorage.getItem("tuat-tab-lab-attempts") ?? "[]"),
    });
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      ref={viewport}
      className="fixed inset-0 z-[100] overflow-y-auto bg-bg pb-[calc(64px+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]"
    >
      <section className="border-b border-separator bg-card px-4 py-3 text-[12px]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-bold">タブ切替ラボ — {MODE_LABELS[mode]}</p>
            <p className="mt-0.5 text-muted">Router不使用・非表示DOMを保持しない</p>
          </div>
          <a href="/home" className="shrink-0 rounded-lg bg-bg px-3 py-2 font-semibold text-accent">終了</a>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["empty", "light", "home"] as TabLabMode[]).map((item) => (
            <a
              key={item}
              href={`/tab-lab?mode=${item}`}
              className={`rounded-lg px-2 py-2 text-center font-semibold ${mode === item ? "bg-accent text-white" : "bg-bg text-ink"}`}
            >
              {MODE_LABELS[item]}
            </a>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center tabular-nums">
          <Metric label="切替" value={`${samples.length}`} />
          <Metric label="平均" value={`${Math.round(average)}ms`} />
          <Metric label="最悪" value={`${Math.round(worst)}ms`} />
          <Metric label="停止" value={`${maxGap}ms`} />
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={resetMetrics} className="flex-1 rounded-lg border border-separator px-3 py-2 font-semibold">計測リセット</button>
          <button onClick={copyReport} className="flex-1 rounded-lg border border-separator px-3 py-2 font-semibold text-accent">{copied ? "コピー済み" : "結果をコピー"}</button>
        </div>
      </section>

      <div key={`${mode}-${active}`}>
        {mode === "empty" && <EmptyPanel tab={active} />}
        {mode === "light" && <LightPanel tab={active} />}
        {mode === "home" && (active === "home" ? homeContent : <EmptyPanel tab={active} />)}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-[110] mx-auto w-full max-w-md border-t border-separator bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="grid h-16 grid-cols-5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={(event) => selectTab(tab.key, event.timeStamp)}
              className={`px-1 text-[10px] font-semibold ${active === tab.key ? "text-accent" : "text-muted"}`}
            >
              <span className="block text-lg leading-5">●</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-bg px-1 py-2"><p className="text-[10px] text-muted">{label}</p><p className="mt-0.5 font-bold">{value}</p></div>;
}

function EmptyPanel({ tab }: { tab: TabKey }) {
  const label = TABS.find((item) => item.key === tab)?.label ?? tab;
  return (
    <main className="flex min-h-[65dvh] items-center justify-center px-4">
      <div className="rounded-2xl border border-separator bg-card px-8 py-10 text-center">
        <p className="text-large-title">{label}</p>
        <p className="mt-2 text-body text-muted">空のClient画面</p>
      </div>
    </main>
  );
}

function LightPanel({ tab }: { tab: TabKey }) {
  const label = TABS.find((item) => item.key === tab)?.label ?? tab;
  return (
    <main className="space-y-3 px-4 py-4">
      <h1 className="text-large-title">{label}</h1>
      {Array.from({ length: 36 }, (_, index) => (
        <article key={index} className="rounded-2xl border border-separator bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-separator" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">軽量カード {index + 1}</p>
              <p className="mt-1 text-caption">Client DOMの再構築負荷を確認する固定データ</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-bg" />
        </article>
      ))}
    </main>
  );
}
