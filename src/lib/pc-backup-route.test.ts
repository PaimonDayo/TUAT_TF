import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PcBackupProtectionError, pcBackupUnavailableResponse } from "./pc-backup-status";
import { POST as createSheet } from "../app/api/google/sheets/create/route";
import { POST as syncSheets } from "../app/api/sheets/sync/route";
import { POST as deleteComment } from "../app/api/comments/delete/route";
import { GET as cleanupStories } from "../app/api/cron/cleanup-stories/route";
import { SpreadsheetCreationError } from "./google-drive";
import { POST as pushRecord } from "../app/api/sheets/push-record/route";
import { gasPost } from "./sheet-sync/gas-client";
import { SheetPushReceiptError } from "./sheet-sync/push-receipt";

const mocks = vi.hoisted(() => ({ protect: vi.fn(), create: vi.fn(), sync: vi.fn(), cleanup: vi.fn(), rpc: vi.fn(), from: vi.fn(), refresh: vi.fn(), push: vi.fn(), clears: vi.fn(), creationRegister: vi.fn() }));
vi.mock("./pc-backup-status", async original => ({ ...await original<typeof import("./pc-backup-status")>(), pcAppWriteProtectionResponse: mocks.protect }));
vi.mock("./supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "synthetic" } } }) }, rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("./supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("./google-drive", async original => ({ ...await original<typeof import("./google-drive")>(), decryptGoogleToken: () => "synthetic", refreshGoogleAccessToken: mocks.refresh, createScheduleSpreadsheet: mocks.create }));
// These fixtures cover protection mapping; real durable transitions are covered by create/route.test.ts.
vi.mock("./google-sheet-creation", async original => ({ ...await original<typeof import("./google-sheet-creation")>(),
  readGoogleSheetCreation: async () => null,
  beginGoogleSheetCreation: async () => ({ outcome: "send", attempt_id: "11111111-1111-4111-8111-111111111111", state: "reserved" }),
  rememberGoogleSheetSetup: async (_admin: unknown, receipt: unknown) => receipt,
  registerGoogleSheetResource: mocks.creationRegister }));
vi.mock("./sheet-sync", () => ({ runSheetSync: mocks.sync, pushRecordToSheet: mocks.push, processPendingClears: mocks.clears }));
vi.mock("./sheet-sync/period-routing", () => ({ sheetForRecord: async () => ({ sheetName: "synthetic", fields: [], spreadsheetId: "synthetic" }) }));
vi.mock("./note-image-cleanup", () => ({ cleanupNoteImages: mocks.cleanup }));
vi.mock("./supabase/auth", () => ({ isMemberPreviewActive: async () => false, fetchRolesByProfileIds: async () => new Map() }));
const req = (body: unknown, authorization?: string) => new Request("https://pc-app.example.test/api/synthetic", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
});
beforeEach(() => {
  vi.stubEnv("SHEET_SYNC_SECRET", "synthetic-sync"); vi.stubEnv("SHEET_SYNC_ENABLED", "true"); vi.stubEnv("CRON_SECRET", "synthetic-cron");
  mocks.protect.mockReset().mockImplementation(async () => pcBackupUnavailableResponse());
  mocks.rpc.mockReset().mockResolvedValue({ data: true }); mocks.from.mockReset(); mocks.create.mockReset(); mocks.sync.mockReset(); mocks.cleanup.mockReset();
  mocks.refresh.mockReset().mockResolvedValue({ access_token: "synthetic-token" });
  mocks.creationRegister.mockReset().mockRejectedValue({ code: "PC_BACKUP_UNAVAILABLE" });
  mocks.push.mockReset().mockResolvedValue({ action: "updated", unmapped: [], receipt: { outcome: "completed", marker_status: "applied" } }); mocks.clears.mockReset().mockResolvedValue({});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("returns explicit503 before Sheets creation or synchronization dispatch", async () => {
  const response = await createSheet(req({ kind: "practice", year: 2026, month: 10, block: "all" }));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "PC_BACKUP_UNAVAILABLE" });
  expect((await syncSheets(req({}, "Bearer synthetic-sync"))).status).toBe(503);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
});
it("returns explicit503 for authenticated GET cleanup and comment mutation without side effects", async () => {
  expect((await cleanupStories(new Request("https://pc-app.example.test/api/cron/cleanup-stories", { headers: { authorization: "Bearer synthetic-cron" } }))).status).toBe(503);
  expect((await deleteComment(req({ id: "11111111-1111-4111-8111-111111111111", kind: "app" }))).status).toBe(503);
  expect(mocks.cleanup).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("maps protection that changes after authorization and body parsing to503", async () => {
  mocks.protect.mockResolvedValue(null);
  const result = { data: { refresh_token_encrypted: "synthetic" }, error: null };
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result, order: () => ({ order: async () => ({ data: [] }) }) };
  mocks.from.mockReturnValue(chain); mocks.create.mockRejectedValue(new PcBackupProtectionError());
  const response = await createSheet(req({ kind: "practice", year: 2026, month: 10, block: "all" }));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "PC_BACKUP_UNAVAILABLE" }); expect(mocks.create).toHaveBeenCalledOnce();
});
it.each(["setup", "record"] as const)("preserves a created sheet after %s protection without recreating it", async phase => {
  mocks.protect.mockResolvedValue(null);
  const resource = { spreadsheetId: "synthetic", url: "https://docs.google.com/spreadsheets/d/synthetic/edit" };
  const result = { data: { refresh_token_encrypted: "synthetic" }, error: null };
  const chain = { select: () => chain, insert: () => chain, eq: () => chain, maybeSingle: async () => result,
    order: () => ({ order: async () => ({ data: [] }) }), single: async () => ({ data: null, error: { code: "PC_BACKUP_UNAVAILABLE" } }) };
  mocks.from.mockReturnValue(chain);
  if (phase === "setup") mocks.create.mockRejectedValue(new SpreadsheetCreationError("partial", phase, resource, true));
  else mocks.create.mockResolvedValue(resource);
  const response = await createSheet(req({ kind: "practice", year: 2026, month: 10, block: "all" }));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "PC_BACKUP_UNAVAILABLE", outcome: "partial", phase, resource, retryable: false });
  expect(mocks.create).toHaveBeenCalledOnce();
});
it("reports an unknown first creation without an unconditional recreate instruction", async () => {
  mocks.protect.mockResolvedValue(null);
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { refresh_token_encrypted: "synthetic" } }), order: () => ({ order: async () => ({ data: [] }) }) };
  mocks.from.mockReturnValue(chain); mocks.create.mockRejectedValue(new SpreadsheetCreationError("unknown", "create", null, false));
  const response = await createSheet(req({ kind: "practice", year: 2026, month: 10, block: "all" }));
  expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ outcome: "unknown", resultUnknown: true, retryable: false, resource: null });
  expect(mocks.create).toHaveBeenCalledOnce();
});
it.each([true, false])("preserves known GAS delivery when its marker is %s protected rather than requeueing", async protectedMarker => {
  mocks.protect.mockResolvedValue(null);
  const updates: unknown[] = [];
  mocks.from.mockImplementation((table: string) => {
    const chain = { select: () => chain, eq: () => chain, update: (value: unknown) => { updates.push(value); return chain; },
      maybeSingle: async () => ({ data: table === "profiles" ? { id: "synthetic", sheet_name: "synthetic", record_fields: [] }
        : { id: "record", user_id: "synthetic", recorded_date: "2026-10-11", updated_at: "synthetic", record_fields_snapshot: [] } }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: protectedMarker ? { code: "PC_BACKUP_UNAVAILABLE" } : null }).then(resolve) };
    return chain;
  });
  mocks.push.mockRejectedValueOnce(new SheetPushReceiptError("SHEET_SENT_MARKER_UNCONFIRMED", "送信済み状態を確認できませんでした。再送せず、送信先を確認してください。",
    "11111111-1111-4111-8111-111111111111", true, false, protectedMarker ? { code: "PC_BACKUP_UNAVAILABLE" } : undefined));
  const response = await pushRecord(req({ recordId: "record" }));
  expect(response.status).toBe(protectedMarker ? 503 : 502);
  expect(await response.json()).toMatchObject({ ok: false, outcome: "partial", externallySent: true, markerConfirmed: false, retryable: false });
  expect(mocks.push).toHaveBeenCalledOnce(); expect(mocks.clears).not.toHaveBeenCalled(); expect(updates).toHaveLength(0);
});
it.each(["network", "malformed"])("reports an unknown GAS %s result after one actual adapter dispatch without another marker or send", async failure => {
  mocks.protect.mockResolvedValue(null); vi.stubEnv("SHEET_SYNC_GAS_URL", "https://gas.example.test/synthetic");
  const provider = vi.fn<typeof fetch>();
  if (failure === "network") provider.mockRejectedValue(new Error("synthetic response unavailable"));
  else provider.mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", provider); mocks.push.mockImplementation(() => gasPost({ action: "writeCells" }));
  const update = vi.fn();
  mocks.from.mockImplementation((table: string) => {
    const chain = { select: () => chain, eq: () => chain, update,
      maybeSingle: async () => ({ data: table === "profiles" ? { id: "synthetic", sheet_name: "synthetic", record_fields: [] }
        : { id: "record", user_id: "synthetic", recorded_date: "2026-10-11", updated_at: "synthetic", pending_sheet_push: true, record_fields_snapshot: [] } }) };
    return chain;
  });
  const response = await pushRecord(req({ recordId: "record" }));
  expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ outcome: "unknown", resultUnknown: true, externallySent: "unknown", retryable: false });
  expect(mocks.push).toHaveBeenCalledOnce(); expect(provider).toHaveBeenCalledOnce(); expect(update).not.toHaveBeenCalled(); expect(mocks.clears).not.toHaveBeenCalled();
});
it("preserves completed sync results when its durable receipt is protected", async () => {
  mocks.protect.mockResolvedValue(null);
  const result = { inserted: 0, updated: 0, pushed: 1, failedMembers: [], unchangedMembers: [], sheetWritesSkipped: false };
  mocks.sync.mockResolvedValue(result);
  mocks.from.mockImplementation(() => {
    let terminal = false;
    const chain = { select: () => chain, eq: () => chain, lt: () => chain, insert: () => chain,
      update: (value: { status: string }) => { terminal = value.status === "success"; return chain; }, single: async () => ({ data: { id: "synthetic-run" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: terminal ? { code: "PC_BACKUP_UNAVAILABLE" } : null }).then(resolve) };
    return chain;
  });
  const response = await syncSheets(req({ onlySheet: "synthetic" }, "Bearer synthetic-sync"));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "PC_BACKUP_UNAVAILABLE", ok: false, outcome: "partial", retryable: false, result });
  expect(mocks.sync).toHaveBeenCalledOnce();
});
it("keeps cleanup's protected DB error as503 after earlier cleanup work", async () => {
  mocks.protect.mockResolvedValue(null); mocks.cleanup.mockResolvedValue(undefined);
  mocks.from.mockImplementation((table: string) => {
    const result = table === "tweets" ? { data: [{ id: "synthetic", image_path: null }], error: null }
      : { data: null, error: { code: "PC_BACKUP_UNAVAILABLE", message: "synthetic protection" } };
    const chain = { select: () => chain, not: () => chain, lte: () => chain, limit: () => chain, delete: () => chain, eq: () => chain, in: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return chain;
  });
  const response = await cleanupStories(new Request("https://pc-app.example.test/api/cron/cleanup-stories", { headers: { authorization: "Bearer synthetic-cron" } }));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "PC_BACKUP_UNAVAILABLE", outcome: "partial", deletionConfirmed: false, retryable: false });
});
