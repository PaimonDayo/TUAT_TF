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

/** Use the actual distance when it exceeds the classified intensity total. */
export function displayedDistance(record: DistanceRecord): number {
  return Math.max(intensityDistance(record), record.dist_actual ?? 0);
}

/** The part of the actual distance not covered by the four intensity fields. */
export function unclassifiedDistance(record: DistanceRecord): number {
  return Math.max((record.dist_actual ?? 0) - intensityDistance(record), 0);
}
