import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";
import { displayedDistance, unclassifiedDistance } from "@/lib/record-distance";
import { formatKm } from "@/lib/utils";
import type { PracticeRecord } from "@/types";

/** 強度別距離を積み上げ横バーで表示 */
export function IntensityBar({ record }: { record: Pick<PracticeRecord, "dist_low" | "dist_mid" | "dist_high" | "dist_speed" | "dist_actual"> }) {
  const values = {
    low: record.dist_low ?? 0,
    mid: record.dist_mid ?? 0,
    high: record.dist_high ?? 0,
    speed: record.dist_speed ?? 0,
  };
  const other = unclassifiedDistance(record);
  const total = displayedDistance(record);
  if (total <= 0) return null;


  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="section-label">走行距離</span>
        <span className="text-headline tabular-nums">
          {formatKm(total)}
          <span className="text-caption ml-0.5">km</span>
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-bg">
        {INTENSITY_ORDER.map((k) =>
          values[k] > 0 ? (
            <div
              key={k}
              style={{
                width: `${(values[k] / total) * 100}%`,
                backgroundColor: INTENSITY_LABELS[k].color,
              }}
            />
          ) : null,
        )}
        {other > 0 && (
          <div
            className="bg-muted/35"
            style={{ width: `${(other / total) * 100}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {INTENSITY_ORDER.map((k) =>
          values[k] > 0 ? (
            <span key={k} className="flex items-center gap-1 text-[11px] text-muted2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: INTENSITY_LABELS[k].color }}
              />
              {INTENSITY_LABELS[k].label} {values[k]}km
            </span>
          ) : null,
        )}
        {other > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted2">
            <span className="h-2 w-2 rounded-full bg-muted/35" />
            {"\u305d\u306e\u4ed6"} {formatKm(other)}km
          </span>
        )}
      </div>
    </div>
  );
}
