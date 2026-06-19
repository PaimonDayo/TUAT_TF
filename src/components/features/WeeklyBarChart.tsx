"use client";

import { useState } from "react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { ja } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PracticeRecord, Intensity } from "@/types";

const BAR_AREA = 88;

/** 直近7日間の日別走行距離。棒をタップで強度別の内訳を表示 */
export function WeeklyBarChart({ records }: { records: PracticeRecord[] }) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));

  const dayData = days.map((d) => {
    const dayRecords = records.filter((r) =>
      isSameDay(new Date(r.recorded_date + "T00:00:00"), d),
    );
    const by: Record<Intensity, number> = {
      low: sum(dayRecords, "dist_low"),
      mid: sum(dayRecords, "dist_mid"),
      high: sum(dayRecords, "dist_high"),
      speed: sum(dayRecords, "dist_speed"),
    };
    const total = Math.round(INTENSITY_ORDER.reduce((s, k) => s + by[k], 0) * 10) / 10;
    return { date: d, by, total };
  });

  const max = Math.max(...dayData.map((d) => d.total), 1);
  const grandTotal = Math.round(dayData.reduce((s, d) => s + d.total, 0) * 10) / 10;

  // 既定は今日を選択
  const [selected, setSelected] = useState(6);
  const sel = dayData[selected];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="section-label">直近7日間の走行距離</p>
        <p className="text-headline tabular-nums">
          {grandTotal}
          <span className="text-caption ml-0.5">km</span>
        </p>
      </div>

      {/* 棒グラフ（棒の高さ＝量。薄い枠線＋小さな影、上を少し丸く。背景に目盛り線） */}
      <div className="relative" style={{ height: `${BAR_AREA}px` }}>
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-separator/40" />
          ))}
        </div>
        <div className="relative h-full flex items-end justify-between gap-2">
          {dayData.map((d, i) => {
            const barH = d.total > 0 ? Math.max((d.total / max) * BAR_AREA, 6) : 0;
            const isSel = i === selected;
            return (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className="flex-1 h-full flex items-end justify-center"
              >
                {barH > 0 ? (
                  <div
                    className={cn(
                      "w-full max-w-7 rounded-t-[4px] overflow-hidden flex flex-col-reverse border border-separator/70 shadow-sm transition-all",
                      isSel ? "ring-2 ring-accent/50" : "opacity-95",
                    )}
                    style={{ height: `${barH}px` }}
                  >
                    {INTENSITY_ORDER.map((k) =>
                      d.by[k] > 0 ? (
                        <div
                          key={k}
                          style={{
                            height: `${(d.by[k] / d.total) * 100}%`,
                            backgroundColor: INTENSITY_LABELS[k].color,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                ) : (
                  <div className="w-full max-w-7 h-1 rounded-t-[3px] bg-separator/60" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 曜日ラベル */}
      <div className="flex justify-between gap-2">
        {dayData.map((d, i) => {
          const isSel = i === selected;
          return (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className="flex-1 flex flex-col items-center leading-none gap-0.5"
            >
              <span
                className="text-[11px]"
                style={{ color: isSel ? "#007aff" : "#8e8e93", fontWeight: isSel ? 700 : 400 }}
              >
                {format(d.date, "E", { locale: ja })}
              </span>
              <span className="text-micro">{format(d.date, "d")}</span>
            </button>
          );
        })}
      </div>

      {/* 選択日の内訳 */}
      <div className="rounded-xl bg-bg p-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-[12px] font-semibold">
            {format(sel.date, "M月d日(E)", { locale: ja })}
          </p>
          <p className="text-[13px] font-bold tabular-nums">
            {sel.total}
            <span className="text-caption ml-0.5">km</span>
          </p>
        </div>
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
          <p className="text-caption">この日は記録がありません</p>
        )}
      </div>
    </Card>
  );
}

function sum(records: PracticeRecord[], key: keyof PracticeRecord): number {
  return records.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}
