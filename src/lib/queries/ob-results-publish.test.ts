import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getObPublishedResults } from "./ob-results-publish";

type Result = { data: unknown[] | null; error: unknown; count: number | null };
function setup(results: Record<string, Result | Result[]>) {
  const calls: { table: string; selection: string; filters: string[]; range?: number[] }[] = [];
  const client = { from(table: string) {
    const call = { table, selection: "", filters: [] as string[], range: undefined as number[] | undefined };
    calls.push(call);
    const query = { select: (selection: string) => { call.selection = selection; return query; },
      eq: (column: string, value: string) => { call.filters.push(`${column}:${value}`); return query; }, order: () => query,
      range: (start: number, end: number) => { call.range = [start, end]; return query; },
      then: (resolve: (value: Result) => unknown) => { const value = results[table]; return Promise.resolve(Array.isArray(value) ? value[(call.range?.[0] ?? 0) / 1000] : value).then(resolve); } };
    return query;
  } } as unknown as SupabaseClient<Database>;
  return { client, calls };
}
const emptyOperations = { data: [], error: null, count: 0 };
const entry = (index: number) => ({ id: `${index}`.padStart(4, "0"), meet_key: "ob-2026", submitted_name: "合成", grade: "B1", events: ["男子100m"], absent: false });

it("includes registrations beyond the Supabase response limit and only queries public export fields", async () => {
  const state = setup({ ob_meet_entries: [{ data: Array.from({ length: 1000 }, (_, i) => entry(i)), error: null, count: 1001 }, { data: [entry(1000)], error: null, count: 1001 }], ob_event_operations: emptyOperations });
  const result = await getObPublishedResults(state.client);
  expect(result.entries).toHaveLength(1001);
  expect(state.calls.filter(call => call.table === "ob_meet_entries").map(call => call.range)).toEqual([[0, 999], [1000, 1999]]);
  for (const call of state.calls) {
    expect(call.filters).toEqual(["meet_key:ob-2026"]);
    expect(call.selection).not.toMatch(/\*|profile_id|qualification_marks/);
  }
});
it.each([
  { data: null, error: { message: "offline" }, count: null },
  { data: [], error: null, count: null },
  { data: [], error: null, count: 1 },
])("never converts failed or incomplete entry reads to zero rows: %j", async result => {
  await expect(getObPublishedResults(setup({ ob_meet_entries: result, ob_event_operations: emptyOperations }).client)).rejects.toThrow("取得できませんでした");
});
it("rejects a partial operations response", async () => {
  await expect(getObPublishedResults(setup({ ob_meet_entries: { data: [], error: null, count: 0 }, ob_event_operations: { data: [], error: null, count: 1 } }).client)).rejects.toThrow("組・記録");
});
it("rejects a count changed during pagination instead of publishing a mixed roster", async () => {
  const state = setup({ ob_meet_entries: [{ data: Array.from({ length: 1000 }, (_, i) => entry(i)), error: null, count: 1001 }, { data: [entry(1000)], error: null, count: 1002 }], ob_event_operations: emptyOperations });
  await expect(getObPublishedResults(state.client)).rejects.toThrow("取得できませんでした");
});
