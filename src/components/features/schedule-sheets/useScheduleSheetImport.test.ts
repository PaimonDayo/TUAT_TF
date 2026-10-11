import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScheduleSheetImport } from "./useScheduleSheetImport";

// Exercise the hook's request/state transitions without adding a DOM test runtime.
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, fetch: vi.fn(), popup: { location: { href: "" }, close: vi.fn() } }));
vi.mock("react", () => ({ useEffect: () => undefined,
  useState: (initial: unknown) => { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = initial;
    return [state.slots[index], (next: unknown) => { state.slots[index] = typeof next === "function" ? next(state.slots[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = { current: initial }; return state.slots[index]; } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
// eslint-disable-next-line react-hooks/immutability -- Reset this synthetic hook harness, not application state during a React render.
function Render() { state.cursor = 0; return useScheduleSheetImport(); }
beforeEach(() => { state.slots = []; state.fetch.mockReset(); state.popup.location.href = ""; state.popup.close.mockReset();
  vi.stubGlobal("fetch", state.fetch); vi.stubGlobal("window", { open: () => state.popup }); });
afterEach(() => vi.unstubAllGlobals());
it("retains a known partial Sheet URL and blocks a duplicate creation in the same mount", async () => {
  const url = "https://docs.google.com/spreadsheets/d/synthetic/edit";
  state.fetch.mockResolvedValue(Response.json({ outcome: "partial", retryable: false, resource: { spreadsheetId: "synthetic", url }, error: "作ったシートを確認してください" }, { status: 503 }));
  await Render().issueSpreadsheet(); const current = Render();
  expect(current.sheetUrl).toBe(url); expect(current.issueBlocked).toBe(true); expect(current.issuing).toBe(false);
  expect(state.popup.location.href).toBe(url); expect(state.popup.close).not.toHaveBeenCalled();
  await current.issueSpreadsheet(); expect(state.fetch).toHaveBeenCalledOnce();
});
it.each(["unknown", "lost"])("blocks recreation when the first create result is %s", async outcome => {
  if (outcome === "lost") state.fetch.mockRejectedValue(new Error("synthetic transport loss"));
  else state.fetch.mockResolvedValue(Response.json({ outcome: "unknown", retryable: false, resultUnknown: true, error: "作成結果を確認してください" }, { status: 502 }));
  await Render().issueSpreadsheet(); const current = Render();
  expect(current.issueBlocked).toBe(true); expect(current.issuing).toBe(false); expect(current.sheetUrl).toBe("");
  expect(state.popup.close).toHaveBeenCalledOnce(); await current.issueSpreadsheet(); expect(state.fetch).toHaveBeenCalledOnce();
});
it("permits a fresh attempt after explicit pre-dispatch protection recovers", async () => {
  state.fetch.mockResolvedValueOnce(Response.json({ code: "PC_BACKUP_UNAVAILABLE", error: "保存を一時停止しています" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ id: "synthetic-record", url: "https://docs.google.com/spreadsheets/d/synthetic/edit" }));
  await Render().issueSpreadsheet(); expect(Render().issueBlocked).toBe(false);
  await Render().issueSpreadsheet(); expect(state.fetch).toHaveBeenCalledTimes(2); expect(Render().sheetUrl).toContain("/synthetic/");
});
