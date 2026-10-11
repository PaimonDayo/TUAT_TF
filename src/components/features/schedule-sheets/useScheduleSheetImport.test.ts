import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScheduleSheetImport } from "./useScheduleSheetImport";
import type { CreationReceipt } from "@/lib/google-sheet-creation";

// Execute mount effects and request/state transitions without a DOM test runtime.
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, mounting: false, effects: [] as (() => unknown)[],
  fetch: vi.fn(), post: vi.fn(), loaded: null as CreationReceipt | null, loadFailed: false, loadMalformed: false, insert: vi.fn(),
  popup: { location: { href: "" }, close: vi.fn() } }));
vi.mock("react", () => ({ useEffect: (effect: () => unknown) => { if (state.mounting) state.effects.push(effect); },
  useState: (initial: unknown) => { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = initial;
    return [state.slots[index], (next: unknown) => { state.slots[index] = typeof next === "function" ? next(state.slots[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = { current: initial }; return state.slots[index]; } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/supabase/client-auth", () => ({ getCurrentUserId: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, order: () => q, gte: () => q, lt: () => q, insert: state.insert,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) }; return q;
} }) }));
// eslint-disable-next-line react-hooks/immutability -- Reset this synthetic hook harness, not app state during a render.
function Render() { state.cursor = 0; return useScheduleSheetImport(); }
async function Mount() {
  state.slots = []; state.effects = []; state.mounting = true; Render(); state.mounting = false;
  for (const effect of state.effects) effect();
  await new Promise(resolve => setTimeout(resolve, 0)); return Render();
}
const attemptId = "11111111-1111-4111-8111-111111111111";
const rowId = "22222222-2222-4222-8222-222222222222";
const url = "https://docs.google.com/spreadsheets/d/synthetic/edit";
const spec = { kind: "practice" as const, block: "all" as const, year: 2026, month: 11 };
const known: CreationReceipt = { attempt_id: attemptId, outcome: "held", state: "resource_known", resource: { spreadsheetId: "synthetic", url },
  setup_confirmed: false, sheet_id: null, record_status: "unregistered", spec };
beforeEach(() => {
  state.slots = []; state.loaded = null; state.loadFailed = false; state.loadMalformed = false; state.post.mockReset(); state.insert.mockReset();
  state.fetch.mockReset().mockImplementation(async (path, options) => {
    if (options?.method === "POST") return state.post(path, options);
    if (path === "/api/google/status") return Response.json({ connected: true });
    return state.loadFailed ? Response.json({ error: "synthetic unavailable" }, { status: 503 })
      : Response.json(state.loadMalformed ? {} : { attempt: state.loaded });
  });
  state.popup.location.href = ""; state.popup.close.mockReset();
  vi.stubGlobal("fetch", state.fetch); vi.stubGlobal("window", { open: () => state.popup });
});
afterEach(() => vi.unstubAllGlobals());
it("retains a known partial Sheet URL and blocks duplicate creation in the same mount", async () => {
  state.post.mockResolvedValue(Response.json({ attemptId, outcome: "partial", retryable: false, resource: known.resource, error: "作ったシートを確認してください" }, { status: 503 }));
  await (await Mount()).issueSpreadsheet(); const current = Render();
  expect(current.sheetUrl).toBe(url); expect(current.issueBlocked).toBe(true); expect(current.issuing).toBe(false);
  expect(state.popup.location.href).toBe(url); expect(state.popup.close).not.toHaveBeenCalled();
  await current.issueSpreadsheet(); expect(state.post).toHaveBeenCalledOnce();
});
it.each(["unknown", "lost"])("blocks recreation when the first create result is %s", async outcome => {
  if (outcome === "lost") state.post.mockRejectedValue(new Error("synthetic transport loss"));
  else state.post.mockResolvedValue(Response.json({ outcome: "unknown", retryable: false, resultUnknown: true, error: "作成結果を確認してください" }, { status: 502 }));
  await (await Mount()).issueSpreadsheet(); const current = Render();
  expect(current.issueBlocked).toBe(true); expect(current.issuing).toBe(false); expect(current.sheetUrl).toBe("");
  expect(state.popup.close).toHaveBeenCalledOnce(); await current.issueSpreadsheet(); expect(state.post).toHaveBeenCalledOnce();
});
it("permits a fresh attempt after explicit pre-dispatch protection recovers", async () => {
  state.post.mockResolvedValueOnce(Response.json({ code: "PC_BACKUP_UNAVAILABLE", error: "保存を一時停止しています" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ id: rowId, url }));
  await (await Mount()).issueSpreadsheet(); expect(Render().issueBlocked).toBe(false);
  await Render().issueSpreadsheet(); expect(state.post).toHaveBeenCalledTimes(2); expect(Render().sheetUrl).toBe(url);
});
it("restores a known ID on a new mount, repairs only DB registration, and keeps setup uncertainty held", async () => {
  state.loaded = known;
  const mounted = await Mount(); expect(mounted.sheetUrl).toBe(url); expect(mounted.issueBlocked).toBe(true);
  await mounted.issueSpreadsheet(); expect(state.post).not.toHaveBeenCalled();
  state.post.mockResolvedValue(Response.json({ id: rowId, url, setupConfirmed: false, error: "書式設定は未確認です", outcome: "partial" }));
  await mounted.repairSpreadsheet();
  expect(JSON.parse(state.post.mock.calls[0][1].body)).toEqual({ mode: "repair", attemptId });
  expect(Render().creationAttempt).toMatchObject({ state: "registered", setup_confirmed: false });
  expect(Render().issueBlocked).toBe(true); expect(Render().error).toContain("未確認");
  await Render().issueSpreadsheet(); expect(state.post).toHaveBeenCalledOnce();
  state.loaded = { ...known, state: "registered", record_status: "present", sheet_id: rowId };
  expect((await Mount()).issueBlocked).toBe(true); expect(Render().sheetUrl).toBe(url);
});
it("reloads an unknown reservation without offering create or guessing a resource", async () => {
  state.loaded = { ...known, state: "reserved", resource: null };
  await (await Mount()).issueSpreadsheet(); expect(state.post).not.toHaveBeenCalled(); expect(Render().sheetUrl).toBe(""); expect(Render().issueBlocked).toBe(true);
});
it.each(["failed", "malformed"])("does not treat %s receipt read as unregistered", async kind => {
  state.loadFailed = kind === "failed"; state.loadMalformed = kind === "malformed";
  await (await Mount()).issueSpreadsheet(); expect(Render().creationChecked).toBe(false); expect(Render().issueBlocked).toBe(true); expect(state.post).not.toHaveBeenCalled();
});
it("refuses raw preview registration of the known Google resource through an alias URL", async () => {
  state.loaded = known; await Mount(); Render().setSheetUrl("https://docs.google.com/spreadsheets/u/0/d/synthetic/edit?alias=1");
  await Render().previewImport(); expect(state.insert).not.toHaveBeenCalled(); expect(state.post).not.toHaveBeenCalled(); expect(Render().error).toContain("登録を確認");
});
it.each(["changed", "deleted"] as const)("retains completed %s facts but allows genuinely new conditions on reload", async record_status => {
  state.loaded = { ...known, outcome: "registered", state: "registered", setup_confirmed: true, record_status, sheet_id: null };
  await Mount(); expect(Render().issueBlocked).toBe(false); expect(Render().creationAttempt?.record_status).toBe(record_status); expect(Render().sheetUrl).toBe(url);
  state.post.mockResolvedValueOnce(Response.json({ attempt: state.loaded, outcome: "partial", retryable: false, resource: known.resource }, { status: 502 }));
  await Render().issueSpreadsheet(); expect(Render().issueBlocked).toBe(false); expect(Render().creationAttempt?.setup_confirmed).toBe(true);
  Render().setMonth(12); state.post.mockResolvedValueOnce(Response.json({ id: rowId, url }));
  await Render().issueSpreadsheet(); expect(JSON.parse(state.post.mock.calls[1][1].body).month).toBe(12); expect(state.post).toHaveBeenCalledTimes(2); expect(state.insert).not.toHaveBeenCalled();
});
