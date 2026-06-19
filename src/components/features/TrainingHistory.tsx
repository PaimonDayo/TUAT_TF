"use client";

import { useMemo, useState } from "react";
import {
  startOfWeek,
  startOfMonth,
  subWeeks,
  subMonths,
  isSameDay,
  format,
} from "date-fns";
import { ja } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PracticeRecord, Intensity } from "@/types";

type Period = "week" | "month";
const COUNT = 12;
const AREA = 96;

interface Bucket {
  start: Date;
  by: Record<Intensity, number>;
  total: number;
}

/** Appleヘルスケア風：過去の練習量（週/月）の推移グラフ */
export function TrainingHistory({ records }: { records: PracticeRecord[] }) {
  const [period, setPeriod] = useState<Period>("week");
  const [selected, setSelected] = useState(COUNT - 1);

  const buckets = useMemo<Bucket[]>(() => {
    const now = new Date();
    const arr: Bucket[] = [];
    for (let i = COUNT - 1; i >= 0; i--) {
      const base = period === "week" ? subWeeks(now, i) : subMonths(now, i);
      const start =
        period === "week" ? startOfWeek(base, { weekStartsOn: 1 }) : startOfMonth(base);
      arr.push({ start, by: { low: 0, mid: 0, high: 0, speed: 0 }, total: 0 });
    }
    for (const r of records) {
      const d = new Date(r.recorded_date + "T00:00:00");
      const start =
        period === "week" ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d);
      const b = arr.find((x) => isSameDay(x.start, start));
      if (!b) continue;
      b.by.low += r.dist_low;
      b.by.mid += r.dist_mid;
      b.by.high += r.dist_high;
      b.by.speed += r.dist_speed;
    }
    for (const b of arr) {
      b.total = Math.round((b.by.low + b.by.mid + b.by.high + b.by.speed) * 10) / 10;
    }
    return arr;
  }, [records, period]);

  const max = Math.max(...buckets.map((b) => b.total), 1);
  const total = Math.round(buckets.reduce((s, b) => s + b.total, 0) * 10) / 10;
  const active = buckets.filter((b) => b.total > 0).length;
  const avg = active > 0 ? Math.round((total / active) * 10) / 10 : 0;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="section-label">練習量の推移</p>
        <div className="w-28">
          <SegmentedControl
            items={[
              { key: "week", label: "週" },
              { key: "month", label: "月" },
            ]}
            value={period}
            onChange={(k) => setPeriod(k as Period)}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div>
          <p className="text-caption">合計</p>
          <p className="text-headline tabular-nums">
            {total}
            <span className="text-caption ml-0.5">km</span>
          </p>
        </div>
        <div>
          <p className="text-caption">{period === "week" ? "週平均" : "月平均"}</p>
          <p className="text-headline tabular-nums">
            {avg}
            <span className="text-caption ml-0.5">km</span>
          </p>
        </div>
      </div>

      {/* 棒グラフ（固定枠＋丸い塗り。タップで内訳） */}
      <div className="flex items-end justify-between gap-1" style={{ height: `${AREA}px` }}>
        {buckets.map((b, i) => {
          const barH = b.total > 0 ? Math.max((b.total / max) * AREA, 8) : 0;
          const isSel = i === selected;
          return (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className="flex-1 h-full flex items-end justify-center"
            >
              <div
                className={cn("relative w-full max-w-6 rounded-full bg-bg", isSel && "ring-2 ring-accent/40")}
                style={{ height: `${AREA}px` }}
              >
                {barH > 0 && (
                  <div
                    className="absolute bottom-0 inset-x-0 rounded-full overflow-hidden flex flex-col-reverse"
                    style={{ height: `${barH}px`, opacity: isSel ? 1 : 0.85 }}
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
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ラベル（間引いて表示） */}
      <div className="flex justify-between gap-1">
        {buckets.map((b, i) => {
          const show = i % 3 === 0 || i === buckets.length - 1;
          return (
            <div key={i} className="flex-1 text-center">
              {show && (
                <span className={cn("text-[9px]", i === selected ? "text-accent font-bold" : "text-muted2")}>
                  {period === "week"
                    ? format(b.start, "M/d", { locale: ja })
                    : format(b.start, "M月", { locale: ja })}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 選択期間の内訳 */}
      {(() => {
        const b = buckets[selected];
        const label =
          period === "week"
            ? `${format(b.start, "M/d", { locale: ja })}の週`
            : format(b.start, "yyyy年M月", { locale: ja });
        return (
          <div className="rounded-xl bg-bg p-3">
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[12px] font-semibold">{label}</p>
              <p className="text-[13px] font-bold tabular-nums">
                {b.total}
                <span className="text-caption ml-0.5">km</span>
              </p>
            </div>
            {b.total > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {INTENSITY_ORDER.map((k) =>
                  b.by[k] > 0 ? (
                    <span key={k} className="flex items-center gap-1 text-[12px] text-muted2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: INTENSITY_LABELS[k].color }} />
                      {INTENSITY_LABELS[k].label} {Math.round(b.by[k] * 10) / 10}km
                    </span>
                  ) : null,
                )}
              </div>
            ) : (
              <p className="text-caption">この期間は記録がありません</p>
            )}
          </div>
        );
      })()}
    </Card>
  );
}
