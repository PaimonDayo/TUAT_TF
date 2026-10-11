import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { CreationReceipt } from "@/lib/google-sheet-creation";
const state = vi.hoisted(() => ({ actor: "11111111-1111-4111-8111-111111111111", allowed: true, readError: "",
  connection: { refresh_token_encrypted: "synthetic-ciphertext", connected_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z" },
  attempts: [] as Record<string, unknown>[], rows: [] as Record<string, unknown>[], provider: vi.fn(), userRpc: vi.fn(), adminRpc: vi.fn(),
  venues: [] as { id: string; name: string; sort: number }[], venueOrders: [] as { column: string; ascending: boolean }[],
  readsByAttempt: 0, beginUnknown: false, persistUnknown: false, setupUnknown: false, registerUnknown: false, resourceConflict: false, refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));
vi.mock("@/lib/pc-backup-status", async original => ({ ...await original<typeof import("@/lib/pc-backup-status")>(),
  assertPcAppWriteAllowed: async () => undefined, pcAppWriteProtectionResponse: async () => null }));
vi.mock("@/lib/google-drive", async original => ({ ...await original<typeof import("@/lib/google-drive")>(),
  decryptGoogleToken: () => "synthetic-refresh-token", refreshGoogleAccessToken: state.refresh }));
import { GET, POST } from "./route";
const spec = { kind: "practice", block: "all", year: 2026, month: 11 };
const rowId = "22222222-2222-4222-8222-222222222222";
const otherActor = "33333333-3333-4333-8333-333333333333";
function result(a: Record<string, unknown>, outcome: string) {
  const row = state.rows.find(row => row.id === a.rowId);
  const recordStatus = a.state !== "registered" ? "unregistered" : !row ? "deleted" : row.changed ? "changed" : "present";
  return { outcome, attempt_id: a.id, state: a.state, spec: a.spec, setup_confirmed: a.setup,
    record_status: recordStatus, sheet_id: recordStatus === "present" ? a.rowId : null, resource: a.resource ?? null };
}
const userClient = { auth: { getUser: async () => ({ data: { user: { id: state.actor } }, error: null }) }, rpc: state.userRpc,
  from(table: string) {
    const orderColumns: string[] = [];
    const q = { select: () => q, eq: () => q, in: () => q, order: (column: string, options: { ascending: boolean }) => {
        orderColumns.push(column); if (table === "venues") state.venueOrders.push({ column, ascending: options.ascending }); return q;
      },
      maybeSingle: async () => { state.readsByAttempt++; return { data: state.attempts.at(-1) ?? null, error: null }; },
      then: (resolve: (result: unknown) => unknown) => {
        const rows = table === "venues" ? [...state.venues] : [];
        if (table === "venues" && orderColumns.includes("id")) rows.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
        return Promise.resolve({ data: rows, error: state.readError === table ? { message: "synthetic read failed" } : null }).then(resolve);
      } };
    return q;
  } };
const adminClient = { rpc: state.adminRpc, from() {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.connection, error: state.readError === "connection" ? { message: "synthetic read failed" } : null }) }; return q;
} };
const request = (body: unknown = spec) => new Request("https://app.example.test/api/google/sheets/create", { method: "POST", body: JSON.stringify(body) });
const createCalls = () => state.provider.mock.calls.filter(([url]) => url === "https://sheets.googleapis.com/v4/spreadsheets");
const setupCalls = () => state.provider.mock.calls.filter(([url]) => String(url).endsWith(":batchUpdate"));
beforeEach(() => {
  state.actor = "11111111-1111-4111-8111-111111111111"; state.allowed = true; state.readError = ""; state.attempts = []; state.rows = [];
  state.venues = []; state.venueOrders = [];
  state.connection = { refresh_token_encrypted: "synthetic-ciphertext", connected_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z" };
  state.readsByAttempt = 0; state.beginUnknown = false; state.persistUnknown = false; state.setupUnknown = false; state.registerUnknown = false; state.resourceConflict = false;
  state.refresh.mockReset().mockResolvedValue({ access_token: "synthetic-access-token" });
  state.provider.mockReset().mockImplementation(async url => String(url).endsWith(":batchUpdate") ? Response.json({ replies: [] })
    : Response.json({ spreadsheetId: "synthetic-book", sheets: [{ properties: { sheetId: 7 } }] }));
  vi.stubGlobal("fetch", state.provider);
  // Scripted durable transport, not a substitute for the independent real SQL/RLS proof.
  state.userRpc.mockReset().mockImplementation(async (name, args) => {
    if (state.readError === name) return { data: null, error: { message: "synthetic read failed" } };
    if (name === "can_create_schedule") return { data: state.allowed, error: null };
    if (name === "google_sheet_creation_status") { const a = state.attempts.find(a => a.actor === state.actor); return { data: a ? result(a, a.state === "registered" && a.setup ? "registered" : "held") : null, error: null }; }
    if (name === "google_sheet_creation_begin") {
      const existing = state.attempts.find(a => a.actor === state.actor && (a.state !== "registered" || !a.setup || a.fingerprint === args.p_creation_fingerprint));
      if (existing) return { data: result(existing, existing.state === "registered" && existing.setup ? "registered" : "held"), error: null };
      const a = { id: args.p_attempt_id, actor: state.actor, state: "reserved", setup: false, spec: args.p_spec,
        fingerprint: args.p_creation_fingerprint, rowId }; state.attempts.push(a);
      return state.beginUnknown ? { data: null, error: { message: "synthetic begin response lost" } } : { data: result(a, "send"), error: null };
    }
    const a = state.attempts.find(a => a.id === args.p_attempt_id && a.actor === state.actor);
    if (!a || !a.resource) return { data: null, error: { message: "synthetic no owned resource" } };
    if (a.state === "registered" && a.setup) return { data: result(a, "registered"), error: null };
    if (state.resourceConflict) return { data: null, error: { code: "23514" } };
    if (state.registerUnknown) return { data: null, error: { code: "PC_BACKUP_UNAVAILABLE" } };
    if (!state.rows.some(row => row.id === a.rowId)) state.rows.push({ id: a.rowId, actor: a.actor, spec: a.spec, resource: a.resource });
    a.state = "registered";
    return { data: result(a, a.setup ? "registered" : "held"), error: null };
  });
  state.adminRpc.mockReset().mockImplementation(async (name, args) => {
    const a = state.attempts.find(a => a.id === args.p_attempt_id && a.actor === args.p_profile_id)!;
    if (name === "google_sheet_creation_resource") {
      if (state.persistUnknown) return { data: null, error: { code: "PC_BACKUP_UNAVAILABLE" } };
      a.state = "resource_known"; a.resource = { spreadsheetId: args.p_spreadsheet_id, url: `https://docs.google.com/spreadsheets/d/${args.p_spreadsheet_id}/edit` };
      return { data: result(a, state.resourceConflict ? "conflict" : "known"), error: null };
    }
    if (state.setupUnknown) return { data: null, error: { code: "PC_BACKUP_UNAVAILABLE" } };
    a.setup = true; return { data: result(a, "known"), error: null };
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("durable workbook creation across callers and reload", () => {
  it("orders tied venues by ID so unchanged input keeps its fingerprint and cannot recreate", async () => {
    state.venues = [{ id: "77777777-7777-4777-8777-777777777777", name: "Synthetic B", sort: 1 },
      { id: "66666666-6666-4666-8666-666666666666", name: "Synthetic A", sort: 1 }];
    expect((await POST(request())).status).toBe(200);
    state.venues.reverse(); // The backing fixture returns the same tied rows in the opposite physical order.
    expect((await POST(request())).status).toBe(200);
    expect(state.venueOrders).toEqual(Array.from({ length: 2 }, () => [{ column: "sort", ascending: true }, { column: "id", ascending: true }]).flat());
    const begins = state.userRpc.mock.calls.filter(([name]) => name === "google_sheet_creation_begin");
    expect(begins).toHaveLength(2); expect(begins[1][1].p_creation_fingerprint).toBe(begins[0][1].p_creation_fingerprint);
    const formatting = JSON.parse(setupCalls()[0][1].body);
    const validation = formatting.requests.find((value: { setDataValidation?: unknown }) => value.setDataValidation).setDataValidation;
    expect(validation.rule.condition.values.map((value: { userEnteredValue: string }) => value.userEnteredValue)).toEqual(["Synthetic A", "Synthetic B"]);
    expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(1); expect(state.rows).toHaveLength(1);
  });
  it("keeps a confirmed pre-create refresh failure outside the durable reservation", async () => {
    state.refresh.mockRejectedValueOnce(new Error("synthetic refresh refused"));
    expect((await POST(request())).status).toBe(500);
    expect(state.attempts).toHaveLength(0); expect(state.provider).not.toHaveBeenCalled();
    expect(state.userRpc.mock.calls.filter(([name]) => name === "google_sheet_creation_begin")).toHaveLength(0);
    expect((await POST(request())).status).toBe(200); expect(createCalls()).toHaveLength(1);
  });
  it("reserves before create, persists ID before format, registers once, and returns the known result after reload", async () => {
    state.provider.mockImplementation(async url => {
      expect(state.attempts).toHaveLength(1);
      if (String(url).endsWith(":batchUpdate")) { expect(state.attempts[0].state).toBe("resource_known"); return Response.json({ replies: [] }); }
      expect(state.attempts[0].state).toBe("reserved"); return Response.json({ spreadsheetId: "synthetic-book", sheets: [{ properties: { sheetId: 7 } }] });
    });
    expect((await POST(request())).status).toBe(200); expect(state.rows).toHaveLength(1);
    expect(await (await GET()).json()).toMatchObject({ attempt: { state: "registered", setup_confirmed: true, sheet_id: rowId } });
    expect((await POST(request())).status).toBe(200); expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(1); expect(state.rows).toHaveLength(1);
    const begin = state.userRpc.mock.calls.find(([name]) => name === "google_sheet_creation_begin")![1];
    expect(begin.p_token_sha256).toBe(createHash("sha256").update("synthetic-ciphertext").digest("hex"));
    expect(JSON.stringify(state.attempts)).not.toContain("synthetic-ciphertext");
  });
  it("permits only one concurrent create and holds the losing caller", async () => {
    const responses = await Promise.all([POST(request()), POST(request())]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 502]); expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(1);
  });
  it("unknown begin performs one read and permits no provider dispatch", async () => {
    state.beginUnknown = true; const response = await POST(request()); expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ resultUnknown: true, retryable: false }); expect(state.readsByAttempt).toBe(1); expect(state.provider).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(502); expect(state.provider).not.toHaveBeenCalled();
  });
  it.each(["network", "5xx", "malformed"])("holds first create %s and never recreates after reload/config/relink", async failure => {
    if (failure === "network") state.provider.mockRejectedValueOnce(new Error("synthetic response lost"));
    if (failure === "5xx") state.provider.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    if (failure === "malformed") state.provider.mockResolvedValueOnce(Response.json({ spreadsheetId: null }));
    expect((await POST(request())).status).toBe(502);
    expect(await (await GET()).json()).toMatchObject({ attempt: { state: "reserved", resource: null } });
    state.connection.connected_at = "2026-10-12T00:00:00Z";
    expect((await POST(request({ ...spec, month: 12 }))).status).toBe(502); expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(0);
  });
  it("resource persistence failure keeps the returned ID in the response and formatting dispatch zero", async () => {
    state.persistUnknown = true; const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ phase: "record", resource: { spreadsheetId: "synthetic-book" }, retryable: false });
    expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(0);
    expect((await POST(request())).status).toBe(502); expect(createCalls()).toHaveLength(1);
  });
  it("resource conflict persists ID but performs no formatting, row update, or row deletion", async () => {
    state.resourceConflict = true; expect((await POST(request())).status).toBe(502);
    expect(state.attempts[0]).toMatchObject({ state: "resource_known", resource: { spreadsheetId: "synthetic-book" } });
    expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(0); expect(state.rows).toHaveLength(0);
    expect((await POST(request({ mode: "repair", attemptId: state.attempts[0].id }))).status).toBe(503);
    expect(state.rows).toHaveLength(0); expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(0);
  });
  it.each(["setup", "setup-marker", "registration"])("reload repairs known %s result using DB only", async failure => {
    if (failure === "setup") state.provider.mockImplementation(async url => String(url).endsWith(":batchUpdate") ? Response.json({}, { status: 503 })
      : Response.json({ spreadsheetId: "synthetic-book", sheets: [{ properties: { sheetId: 7 } }] }));
    if (failure === "setup-marker") state.setupUnknown = true;
    if (failure === "registration") state.registerUnknown = true;
    const response = await POST(request()); expect(response.status).toBe(failure === "setup" ? 502 : 503);
    const loaded = (await (await GET()).json()).attempt as CreationReceipt;
    expect(loaded.resource?.spreadsheetId).toBe("synthetic-book"); expect(loaded.setup_confirmed).toBe(failure === "registration");
    state.registerUnknown = false; state.setupUnknown = false;
    const repaired = await POST(request({ mode: "repair", attemptId: loaded.attempt_id })); expect(repaired.status).toBe(200);
    expect(await repaired.json()).toMatchObject({ id: rowId, setupConfirmed: failure === "registration", outcome: failure === "registration" ? "completed" : "partial" });
    expect(state.rows).toHaveLength(1); expect(createCalls()).toHaveLength(1); expect(setupCalls()).toHaveLength(1);
    expect((await POST(request())).status).toBe(failure === "registration" ? 200 : 502); expect(state.provider).toHaveBeenCalledTimes(2);
  });
  it.each(["changed", "deleted"])("does not restore completed %s registration or send Google again", async change => {
    await POST(request()); if (change === "deleted") state.rows = []; else state.rows[0].changed = true;
    expect(await (await GET()).json()).toMatchObject({ attempt: { record_status: change, sheet_id: null } });
    expect((await POST(request())).status).toBe(502);
    expect((await POST(request({ mode: "repair", attemptId: state.attempts[0].id }))).status).toBe(502);
    expect(state.rows).toHaveLength(change === "deleted" ? 0 : 1); expect(createCalls()).toHaveLength(1);
  });
  it.each(["can_create_schedule", "connection", "venues", "google_sheet_creation_status"])("does not convert %s read failure to unregistered/empty", async failingRead => {
    state.readError = failingRead;
    const response = failingRead === "google_sheet_creation_status" ? await GET() : await POST(request());
    expect(response.status).toBe(503); expect(state.provider).not.toHaveBeenCalled(); expect(state.attempts).toHaveLength(0);
  });
  it("keeps creation refused for denied permission and rejects another actor's repair", async () => {
    state.allowed = false; expect((await POST(request())).status).toBe(403); expect(state.provider).not.toHaveBeenCalled();
    state.allowed = true; state.registerUnknown = true; await POST(request()); const attemptId = state.attempts[0].id;
    state.actor = otherActor; state.registerUnknown = false;
    expect((await POST(request({ mode: "repair", attemptId }))).status).toBe(503); expect(createCalls()).toHaveLength(1); expect(state.rows).toHaveLength(0);
  });
});
