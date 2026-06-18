import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { ja } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";
import type { PracticeRecord } from "@/types";

/** 直近7日間の日別走行距離を、強度別の色で積み上げ表示 */
export function WeeklyBarChart({ records }: { records: PracticeRecord[] }) {
  const today = startOfDay(new Date());
  // 古い順（左）→ 今日（右）
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));

  const dayData = days.map((d) => {
    const dayRecords = records.filter((r) =>
      isSameDay(new Date(r.recorded_date + "T00:00:00"), d),
    );
    const byIntensity = {
      low: sum(dayRecords, "dist_low"),
      mid: sum(dayRecords, "dist_mid"),
      high: sum(dayRecords, "dist_high"),
      speed: sum(dayRecords, "dist_speed"),
    };
    const total = INTENSITY_ORDER.reduce((s, k) => s + byIntensity[k], 0);
    return { date: d, byIntensity, total: Math.round(total * 10) / 10 };
  });

  const max = Math.max(...dayData.map((d) => d.total), 1);
  const grandTotal = Math.round(dayData.reduce((s, d) => s + d.total, 0) * 10) / 10;
  const BAR_AREA = 80; // px

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between mb-1">
        <p className="section-label">直近7日間の走行距離</p>
        <p className="text-headline tabular-nums">
          {grandTotal}
          <span className="text-caption ml-0.5">km</span>
        </p>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-3">
        {INTENSITY_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1 text-[10px] text-muted2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: INTENSITY_LABELS[k].color }} />
            {INTENSITY_LABELS[k].label}
          </span>
        ))}
      </div>

      {/* 棒グラフ（棒の高さ＝量。上を丸く。空の枠は描かない） */}
      <div className="flex items-end justify-between gap-2" style={{ height: `${BAR_AREA}px` }}>
        {dayData.map((d, i) => {
          const barH = d.total > 0 ? Math.max((d.total / max) * BAR_AREA, 6) : 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <span className="text-micro tabular-nums mb-1">{d.total > 0 ? d.total : ""}</span>
              {barH > 0 ? (
                <div
                  className="w-full max-w-7 flex flex-col-reverse rounded-t-full overflow-hidden"
                  style={{ height: `${barH}px` }}
                >
                  {INTENSITY_ORDER.map((k) =>
                    d.byIntensity[k] > 0 ? (
                      <div
                        key={k}
                        style={{
                          height: `${(d.byIntensity[k] / d.total) * 100}%`,
                          backgroundColor: INTENSITY_LABELS[k].color,
                        }}
                      />
                    ) : null,
                  )}
                </div>
              ) : (
                <div className="w-full max-w-7 h-[3px] rounded-full bg-separator" />
              )}
            </div>
          );
        })}
      </div>

      {/* 曜日・日付ラベル */}
      <div className="flex justify-between gap-2 mt-1.5">
        {dayData.map((d, i) => {
          const today_ = isSameDay(d.date, new Date());
          return (
            <div key={i} className="flex-1 flex flex-col items-center leading-none gap-0.5">
              <span
                className="text-[11px]"
                style={{ color: today_ ? "#007aff" : "#8e8e93", fontWeight: today_ ? 700 : 400 }}
              >
                {format(d.date, "E", { locale: ja })}
              </span>
              <span className="text-micro">{format(d.date, "d")}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function sum(records: PracticeRecord[], key: keyof PracticeRecord): number {
  return records.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}
