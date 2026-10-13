import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScheduleSheetImport } from "./useScheduleSheetImport";

const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, mounting: false,
  effects: [] as (() => unknown)[], fetch: vi.fn(), insert: vi.fn() }));
vi.mock("react", () => ({
  useEffect: (effect: () => unknown) => { if (state.mounting) state.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.slots)) state.slots[index] = initial;
    return [state.slots[index], (next: unknown) => {
      state.slots[index] = typeof next === "function" ? next(state.slots[index]) : next;
    }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/supabase/client-auth", () => ({ getCurrentUserId: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, gte: () => query, lt: () => query,
    insert: (value: unknown) => { state.insert(value); return query; },
    single: async () => ({ data: { id: "synthetic-sheet" }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
  return query;
} }) }));
// eslint-disable-next-line react-hooks/immutability -- Reset the synthetic hook harness, not application state.
function Render() { state.cursor = 0; return useScheduleSheetImport(); }
async function Mount() {
  state.slots = []; state.effects = []; state.mounting = true; Render(); state.mounting = false;
  for (const effect of state.effects) effect();
  await new Promise(resolve => setTimeout(resolve, 0));
  return Render();
}
beforeEach(() => {
  state.insert.mockReset(); state.fetch.mockReset().mockResolvedValue(Response.json({ rows: [], deletions: [] }));
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it("opens manual schedule imports without contacting the retired Drive endpoints", async () => {
  await Mount();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("still registers a selected CSV and sends its unchanged content for preview", async () => {
  const mounted = await Mount();
  mounted.setSource("file");
  const csv = "日付,場所\n2026-10-14,synthetic\n";
  await mounted.selectFile(new File([csv], "schedule.csv", { type: "text/csv" }));
  await Render().previewImport();
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({
    author_id: "11111111-1111-4111-8111-111111111111", sheet_url: "csv-upload://schedule.csv", csv_url: null,
  }));
  expect(state.fetch).toHaveBeenCalledOnce();
  const [path, options] = state.fetch.mock.calls[0];
  expect(path).toBe("/api/schedule-sheets/preview");
  expect(JSON.parse(options.body)).toEqual({ sheetId: "synthetic-sheet", csv });
  expect(Render().error).toBeNull();
});
