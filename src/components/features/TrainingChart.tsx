"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  subDays,
  subWeeks,
  subMonths,
  isSameDay,
  format,
} from "date-fns";
import { ja } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { INTENSITY_ORDER, INTENSITY_LABELS, CONDITIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PracticeRecord, Intensity } from "@/types";

type Period = "day" | "week" | "month";

const COUNTS: Record<Period, number> = { day: 35, week: 16, month: 12 };
const AREA = 96;

interface Bucket {
  start: Date;
  by: Record<Intensity, number>;
  total: number;
  records: PracticeRecord[];
}

function bucketStart(d: Date, period: Period): Date {
  if (period === "day") return startOfDay(d);
  if (period === "week") return startOfWeek(d, { weekStartsOn: 1 });
  return startOfMonth(d);
}

/** 練習量の推移。日/週/月を切り替え、横スライドで過去を遡れる。棒タップで内訳。 */
export function TrainingChart({ records }: { records: PracticeRecord[] }) {
  const [period, setPeriod] = useState<Period>("day");
  const [selected, setSelected] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const buckets = useMemo<Bucket[]>(() => {
    const count = COUNTS[period];
    const now = new Date();
    const arr: Bucket[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const base =
        period === "day" ? subDays(now, i) : period === "week" ? subWeeks(now, i) : subMonths(now, i);
      arr.push({ start: bucketStart(base, period), by: { low: 0, mid: 0, high: 0, speed: 0 }, total: 0, records: [] });
    }
    for (const r of records) {
      const start = bucketStart(new Date(r.recorded_date + "T00:00:00"), period);
      const b = arr.find((x) => isSameDay(x.start, start));
      if (!b) continue;
      b.by.low += r.dist_low;
      b.by.mid += r.dist_mid;
      b.by.high += r.dist_high;
      b.by.speed += r.dist_speed;
      b.records.push(r);
    }
    for (const b of arr) {
      b.total = Math.round((b.by.low + b.by.mid + b.by.high + b.by.speed) * 10) / 10;
    }
    return arr;
  }, [records, period]);

  const max = Math.max(...buckets.map((b) => b.total), 1);
  const selIndex = selected ?? buckets.length - 1;
  const sel = buckets[selIndex];

  // 期間切替・初期表示で右端（最新）までスクロール
  useEffect(() => {
    setSelected(null);
    setShowDetail(false);
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [period]);

  function bucketLabel(b: Bucket, long = false): string {
    if (period === "day") return format(b.start, long ? "M月d日(E)" : "M/d", { locale: ja });
    if (period === "week") return long ? `${format(b.start, "M/d", { locale: ja })}の週` : format(b.start, "M/d", { locale: ja });
    return format(b.start, long ? "yyyy年M月" : "M月", { locale: ja });
  }

  const labelEvery = period === "day" ? 5 : period === "week" ? 2 : 1;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="section-label">練習量の推移</p>
        <div className="w-36">
          <SegmentedControl
            items={[
              { key: "day", label: "日" },
              { key: "week", label: "週" },
              { key: "month", label: "月" },
            ]}
            value={period}
            onChange={(k) => setPeriod(k as Period)}
          />
        </div>
      </div>

      {/* 横スクロールできる棒グラフ */}
      <div ref={scrollRef} className="overflow-x-auto -mx-1 px-1">
        <div className="relative w-max">
          {/* 目盛り線 */}
          <div
            className="absolute left-0 right-0 top-0 flex flex-col justify-between pointer-events-none"
            style={{ height: `${AREA}px` }}
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border-t border-separator/40" />
            ))}
          </div>

          {/* 棒 */}
          <div className="relative flex items-end gap-2" style={{ height: `${AREA}px` }}>
            {buckets.map((b, i) => {
              const barH = b.total > 0 ? Math.max((b.total / max) * AREA, 6) : 0;
              const isSel = i === selIndex;
              return (
                <button
                  key={i}
                  onClick={() => {
                    setSelected(i);
                    setShowDetail(false);
                  }}
                  className="shrink-0 w-6 h-full flex items-end justify-center"
                >
                  {barH > 0 ? (
                    <div
                      className={cn(
                        "w-full rounded-t-[4px] overflow-hidden flex flex-col-reverse border border-separator/70 shadow-sm transition-all",
                        isSel ? "ring-2 ring-accent/50" : "opacity-95",
                      )}
                      style={{ height: `${barH}px` }}
                    >
                      {INTENSITY_ORDER.map((k) =>
                        b.by[k] > 0 ? (
                          <div
                            key={k}
                            style={{
                              height: `${(b.by[k] / b.total) * 100}%`,
                              backgroundColor: INTENSITY_LABELS[k].color,
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-1 rounded-t-[3px] bg-separator/60" />
                  )}
                </button>
              );
            })}
          </div>

          {/* ラベル（間引き） */}
          <div className="flex gap-2 mt-1.5">
            {buckets.map((b, i) => {
              const show = (buckets.length - 1 - i) % labelEvery === 0;
              return (
                <div key={i} className="shrink-0 w-6 text-center">
                  {show && (
                    <span className={cn("text-[9px]", i === selIndex ? "text-accent font-bold" : "text-muted2")}>
                      {bucketLabel(b)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 選択した期間の内訳（枠の高さは固定） */}
      {(() => {
        const hasText = sel.records.some(
          (r) => r.result_text || r.strength_text || r.memo || r.condition,
        );
        return (
          <div className="rounded-xl bg-bg p-3">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[12px] font-semibold">{bucketLabel(sel, true)}</p>
              <p className="text-[13px] font-bold tabular-nums">
                {sel.total}
                <span className="text-caption ml-0.5">km</span>
              </p>
            </div>

            {/* 内訳エリア（高さ固定で日ごとにガタつかない） */}
            <div className="h-9 overflow-hidden">
              {sel.total > 0 ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {INTENSITY_ORDER.map((k) =>
                    sel.by[k] > 0 ? (
                      <span key={k} className="flex items-center gap-1 text-[12px] text-muted2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: INTENSITY_LABELS[k].color }} />
                        {INTENSITY_LABELS[k].label} {Math.round(sel.by[k] * 10) / 10}km
                      </span>
                    ) : null,
                  )}
                </div>
              ) : (
                <p className="text-caption">この期間は記録がありません</p>
              )}
            </div>

            {/* 詳細ボタン行（記録が無くても高さを確保） */}
            <div className="h-6 flex items-center">
              {hasText && (
                <button
                  onClick={() => setShowDetail((v) => !v)}
                  className="text-[12px] text-accent font-medium active:opacity-50"
                >
                  {showDetail ? "詳細を閉じる" : "詳細（結果・補強・感想）"}
                </button>
              )}
            </div>

            {hasText && (
              <>
                {showDetail && (
                  <div className="mt-1 space-y-2 border-t border-separator pt-2">
                    {sel.records.map((r) => {
                      const cond = r.condition ? CONDITIONS[r.condition] : null;
                      return (
                        <div key={r.id} className="text-[12px] space-y-0.5">
                          {period !== "day" && (
                            <p className="font-semibold flex items-center gap-1.5">
                              {format(new Date(r.recorded_date + "T00:00:00"), "M/d(E)", { locale: ja })}
                              {cond && (
                                <span style={{ color: cond.color }}>
                                  {cond.symbol} {cond.label}
                                </span>
                              )}
                            </p>
                          )}
                          {period === "day" && cond && (
                            <p className="font-semibold" style={{ color: cond.color }}>
                              {cond.symbol} {cond.label}
                            </p>
                          )}
                          {r.result_text && <DetailLine label="結果" value={r.result_text} />}
                          {r.strength_text && <DetailLine label="補強" value={r.strength_text} />}
                          {r.memo && <DetailLine label="感想" value={r.memo} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}
    </Card>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-muted2">
      <span className="text-faint">{label}：</span>
      <span className="whitespace-pre-wrap break-words">{value}</span>
    </p>
  );
}
