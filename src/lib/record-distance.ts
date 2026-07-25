import type { PracticeRecord } from "@/types";

type DistanceRecord = Pick<
  PracticeRecord,
  "dist_low" | "dist_mid" | "dist_high" | "dist_speed" | "dist_actual"
>;

export function intensityDistance(record: DistanceRecord): number {
  return (
    (record.dist_low ?? 0) +
    (record.dist_mid ?? 0) +
    (record.dist_high ?? 0) +
    (record.dist_speed ?? 0)
  );
}

/** 強度別がある日はその合計を優先し、全て0の日だけ実距離へフォールバックする。 */
export function displayedDistance(record: DistanceRecord): number {
  const intensity = intensityDistance(record);
  return intensity > 0 ? intensity : (record.dist_actual ?? 0);
}

export function unclassifiedDistance(record: DistanceRecord): number {
  return intensityDistance(record) > 0 ? 0 : (record.dist_actual ?? 0);
}
