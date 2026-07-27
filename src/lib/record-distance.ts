import type { PracticeRecord } from "@/types";

type DistanceRecord = Pick<
  PracticeRecord,
  "dist_low" | "dist_mid" | "dist_high" | "dist_speed"
>;

export function intensityDistance(record: DistanceRecord): number {
  return (
    (record.dist_low ?? 0) +
    (record.dist_mid ?? 0) +
    (record.dist_high ?? 0) +
    (record.dist_speed ?? 0)
  );
}

/** Distance is always the sum of the four intensity fields. */
export function displayedDistance(record: DistanceRecord): number {
  return intensityDistance(record);
}

export function unclassifiedDistance(): number {
  return 0;
}
