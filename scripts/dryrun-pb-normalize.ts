// 大会・記録会の結果（pb_records）を新しい形へ寄せられるか確認する dry-run。書き込みなし。
// 実行: npx tsx --env-file=.env.local scripts/dryrun-pb-normalize.ts
import { createClient } from "@supabase/supabase-js";
import { parseRecordText, type MeasureType } from "../src/lib/competition-record";

/** 表記ゆれの寄せ先。dry-run の出力を見ながら足していく */
const ALIASES: Record<string, string> = {
  "5000": "5000m",
  "1500": "1500m",
  "800": "800m",
  "110H": "110mH",
  "400H": "400mH",
  "3000SC": "3000mSC",
};

function normalize(name: string): string {
  const value = name.normalize("NFKC").trim().replace(/\s+/g, "");
  return ALIASES[value] ?? value;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const [{ data: events }, { data: records }] = await Promise.all([
    admin.from("competition_events").select("name,measure_type"),
    admin
      .from("pb_records")
      .select("id,user_id,event_name,record,value_cs,value_cm,value_points,is_pb,is_ub"),
  ]);
  if (!events || !records) throw new Error("読み込みに失敗しました");

  const measureOf = new Map<string, MeasureType>(
    events.map((e) => [e.name, e.measure_type as MeasureType]),
  );
  const exact: typeof records = [];
  const normalized: { id: string; from: string; to: string }[] = [];
  const unknown = new Map<string, number>();
  const parsed: { id: string; event: string; record: string; value: unknown }[] = [];
  const unparsed: { id: string; event: string; record: string }[] = [];
  const duplicateFlags = new Map<string, number>();

  for (const row of records) {
    const target = measureOf.has(row.event_name)
      ? row.event_name
      : measureOf.has(normalize(row.event_name))
        ? normalize(row.event_name)
        : null;
    if (target === row.event_name) exact.push(row);
    else if (target) normalized.push({ id: row.id, from: row.event_name, to: target });
    else unknown.set(row.event_name, (unknown.get(row.event_name) ?? 0) + 1);

    if (row.value_cs === null && row.value_cm === null && row.value_points === null) {
      const value = target ? parseRecordText(row.record, measureOf.get(target)!) : null;
      if (value) parsed.push({ id: row.id, event: row.event_name, record: row.record, value });
      else unparsed.push({ id: row.id, event: row.event_name, record: row.record });
    }

    for (const flag of ["is_pb", "is_ub"] as const) {
      if (!row[flag]) continue;
      const key = `${flag} ${row.user_id} ${row.event_name}`;
      duplicateFlags.set(key, (duplicateFlags.get(key) ?? 0) + 1);
    }
  }

  console.log(
    JSON.stringify(
      {
        total: records.length,
        eventNames: {
          exact: exact.length,
          normalizable: normalized.length,
          unknown: [...unknown.entries()].map(([name, count]) => ({ name, count })),
        },
        recordValues: { parsed: parsed.length, unparsed: unparsed.length },
        duplicateFlags: [...duplicateFlags.entries()]
          .filter(([, count]) => count > 1)
          .map(([key, count]) => ({ key, count })),
        samples: {
          normalized: normalized.slice(0, 20),
          parsed: parsed.slice(0, 20),
          unparsed: unparsed.slice(0, 40),
        },
      },
      null,
      2,
    ),
  );
  console.log("書き込みはしていません（dry-run）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
