import { parseRecordText, type MeasureType } from "./competition-record";

export type LegacyPb = {
  id: string; user_id: string; event_name: string; record: string;
  is_pb: boolean; is_ub: boolean; result_status: string;
  value_cs: number | null; value_cm: number | null; value_points: number | null;
};
const aliases: Record<string, string> = {
  "5000": "5000m", "1500": "1500m", "800": "800m",
  "110H": "110mH", "400H": "400mH", "3000SC": "3000mSC",
};
const normalizedName = (name: string) => {
  const clean = name.normalize("NFKC").trim().replace(/\s+/g, "");
  return aliases[clean] ?? clean;
};

/** Conservative plan only: no I/O, no flag/stage decisions, no legacy text replacement. */
export function planPbNormalization(rows: LegacyPb[], events: {name: string; measure_type: MeasureType}[]) {
  const catalog = new Map(events.map(e => [e.name, e.measure_type]));
  const target = (row: LegacyPb) => catalog.has(row.event_name) ? row.event_name : normalizedName(row.event_name);
  const patches: {id: string; changes: Partial<Pick<LegacyPb, "event_name" | "value_cs" | "value_cm" | "value_points">>}[] = [];
  const review: {id: string; reason: string}[] = [];
  for (const row of rows) {
    const name = target(row);
    const measure = catalog.get(name);
    if (!measure) { review.push({id: row.id, reason: "unknown_event"}); continue; }
    const changes: (typeof patches)[number]["changes"] = {};
    if (name !== row.event_name) {
      // Renaming a flagged row fires the exclusivity trigger. Never pick a winner implicitly.
      const collision = rows.some(other => other.id !== row.id && other.user_id === row.user_id && target(other) === name &&
        ((row.is_pb && other.is_pb) || (row.is_ub && other.is_ub)));
      if (collision) { review.push({id: row.id, reason: "flag_collision_on_rename"}); continue; }
      changes.event_name = name;
    }
    if (row.result_status === "ok" && row.value_cs == null && row.value_cm == null && row.value_points == null) {
      const raw = row.record.normalize("NFKC").trim().replace(/\s+/g, "");
      // 6m5 is ambiguous (5 cm or .5 m); leave it for the owner even if the form parser accepts it.
      const ambiguousDistance = measure === "distance" && /^\d+m\d$/i.test(raw);
      const value = ambiguousDistance ? null : parseRecordText(row.record, measure);
      if (value && Object.values(value).every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647)) Object.assign(changes, value);
      else review.push({id: row.id, reason: "unparsed_or_ambiguous_record"});
    }
    if (Object.keys(changes).length) patches.push({id: row.id, changes});
  }
  const duplicateGroups = ["is_pb", "is_ub"].flatMap(flag => {
    const counts = new Map<string, number>();
    for (const row of rows) if (row[flag as "is_pb" | "is_ub"]) {
      const key = `${row.user_id} ${row.event_name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].filter(([,n]) => n > 1).map(([key,count]) => ({flag,key,count}));
  });
  return {patches, review, duplicateGroups};
}
