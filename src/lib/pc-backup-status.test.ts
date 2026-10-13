import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import vectors from "../../ops/pc-backup/status-vectors.json";
import { backupStatusReady as opsReady } from "../../ops/pc-backup/status.mjs";
import { backupStatusReady, assertPcAppWriteAllowed, pcBackendRequestNeedsProtection, PcBackupProtectionError, type PcBackupStatus } from "./pc-backup-status";
import { pcBackendFetch } from "./pc-backend";
import { sessionClientConfig } from "./supabase/server-client-options";
import { createAdminClient } from "./supabase/admin";
import { uploadImage, removeImages } from "./image-storage";
import { gasPost } from "./sheet-sync/gas-client";
import { createScheduleSpreadsheet } from "./google-drive";

const mocks = vi.hoisted(() => ({ runtime: true, synthetic: false, local: false, status: null as unknown,
  lstat: vi.fn(), realpath: vi.fn(), open: vi.fn(), dispatch: vi.fn(), r2: vi.fn() }));
vi.mock("./pc-app-runtime", () => ({ getPcAppRuntime: () => mocks.runtime ? {
  publicOrigin: "https://pc-app.example.test", internalUrl: "http://127.0.0.1:18180", synthetic: mocks.synthetic,
  cloud: { url: "http://127.0.0.1:18181", anonKey: "synthetic-cloud-key" },
  ...(mocks.local ? { local: { authUrl: "http://127.0.0.1:18001", restUrl: "http://127.0.0.1:18002" } } : {}),
} : undefined }));
vi.mock("node:fs/promises", () => ({ lstat: mocks.lstat, realpath: mocks.realpath, open: mocks.open }));
vi.mock("@aws-sdk/client-s3", async original => {
  const actual = await original<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: class { send = mocks.r2; destroy() {} } };
});
const path = resolve("synthetic-backup-status.json"), golden = vectors[0];
const base = "https://pc-app.example.test/api/pc-supabase", id = "11111111-1111-4111-8111-111111111111";
const request = (api: string, method = "POST", body?: unknown) => new Request(`${base}${api}`, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
});
const snapshot = () => structuredClone(golden.status);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(golden.now);
  mocks.runtime = true; mocks.synthetic = false; mocks.local = false; mocks.status = snapshot();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-data-key"); vi.stubEnv("PC_BACKEND_ENABLED", "true");
  vi.stubEnv("PC_APP_BACKUP_STATUS_PATH", path);
  for (const [name, value] of Object.entries({ PC_APP_BACKUP_INSTANCE_ID: golden.identity.instanceId,
    PC_APP_BACKUP_GENERATION: golden.identity.generation, PC_APP_BACKUP_STARTED_AT: golden.identity.startedAt,
    PC_APP_BACKUP_DATABASE_SYSTEM_IDENTIFIER: golden.identity.databaseSystemIdentifier })) vi.stubEnv(name, value);
  mocks.lstat.mockReset().mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: 2000 });
  mocks.realpath.mockReset().mockResolvedValue(path);
  mocks.open.mockReset().mockImplementation(async () => ({ stat: async () => ({ isFile: () => true }),
    read: async (buffer: Buffer) => { const bytesRead = buffer.write(JSON.stringify(mocks.status)); return { bytesRead, buffer }; }, close: async () => undefined }));
  mocks.dispatch.mockReset().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", mocks.dispatch);
  mocks.r2.mockReset().mockResolvedValue({ Contents: [] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("operational status conformance", () => {
  it("admits only the native database name pinned by the owning host", async () => {
    const status=snapshot() as PcBackupStatus;
    status.target.databaseName="tuat_pc_candidate";
    const identity={...golden.identity,databaseName:"tuat_pc_candidate"};
    expect(opsReady(status,identity,golden.now)).toBe(true);
    expect(backupStatusReady(status,identity,golden.now)).toBe(true);
    expect(backupStatusReady(status,golden.identity,golden.now)).toBe(false);
    mocks.status=status;
    await expect(assertPcAppWriteAllowed()).rejects.toBeInstanceOf(PcBackupProtectionError);
    vi.stubEnv("PC_APP_BACKUP_DATABASE_NAME","tuat_pc_candidate");
    await expect(assertPcAppWriteAllowed()).resolves.toBeUndefined();
  });
  it("holds local writes for DB-only receipts and requires fresh, same-source image restore and off-PC evidence", async () => {
    mocks.local = true;
    const imageRoot = resolve("..", "synthetic-private-images"); vi.stubEnv("LOCAL_IMAGE_STORAGE_ROOT", imageRoot);
    await expect(assertPcAppWriteAllowed()).rejects.toBeInstanceOf(PcBackupProtectionError);
    const status = snapshot() as PcBackupStatus;
    status.backup!.localSnapshot = { format: "tuat-local-db-images-v1", sourceId: golden.identity.instanceId,
      generation: golden.identity.generation, databaseSystemIdentifier: golden.identity.databaseSystemIdentifier, imageRoot,
      archiveKey: `ops/pc-backend/${golden.identity.instanceId}/backups/${golden.identity.startedAt.replace(/[:.]/g,"-")}.local.tar.enc`,
      archiveSha256: "a".repeat(64), archiveBytes: 128, capturedAt: golden.identity.startedAt, restoreVerifiedAt: status.heartbeat.checkedAt, offsiteVerifiedAt: status.heartbeat.checkedAt,
      independentRecoveryCopyChecked: true };
    mocks.status = status; await expect(assertPcAppWriteAllowed()).resolves.toBeUndefined();
    status.backup!.key = status.backup!.localSnapshot.archiveKey;
    status.backup!.sha256 = status.backup!.localSnapshot.archiveSha256;
    status.backup!.bytes = status.backup!.localSnapshot.archiveBytes;
    delete status.backup!.recoveryKey; delete status.backup!.recoverySha256; delete status.backup!.recoveryBytes;
    expect(opsReady(status, golden.identity, golden.now)).toBe(true); expect(backupStatusReady(status, golden.identity, golden.now)).toBe(true);
    await expect(assertPcAppWriteAllowed()).resolves.toBeUndefined();
    for (const changes of [{ generation: "33333333-3333-4333-8333-333333333333" },{ imageRoot: resolve("..","wrong-images") },
      { offsiteVerifiedAt: "2026-10-10T00:00:00.000Z" },{ independentRecoveryCopyChecked: false },{ archiveKey: "https://other.example.invalid/image.enc" }]) {
      mocks.status = { ...status, backup: { ...status.backup, localSnapshot: { ...status.backup!.localSnapshot, ...changes } } };
      await expect(assertPcAppWriteAllowed()).rejects.toBeInstanceOf(PcBackupProtectionError);
    }
  });
  it("mirrors the ordered capture/restore/offsite contract and holds old captures under a fresh host", async () => {
    mocks.local = true;
    const imageRoot=resolve("..","synthetic-private-images");vi.stubEnv("LOCAL_IMAGE_STORAGE_ROOT",imageRoot);
    const status=snapshot() as PcBackupStatus;
    const local={format:"tuat-local-db-images-v1",sourceId:golden.identity.instanceId,generation:golden.identity.generation,
      databaseSystemIdentifier:golden.identity.databaseSystemIdentifier,imageRoot,
      archiveKey:`ops/pc-backend/${golden.identity.instanceId}/backups/${golden.identity.startedAt.replace(/[:.]/g,"-")}.local.tar.enc`,
      archiveSha256:"a".repeat(64),archiveBytes:128,capturedAt:golden.identity.startedAt,restoreVerifiedAt:"2026-10-11T00:29:30.000Z",
      offsiteVerifiedAt:"2026-10-11T00:29:59.000Z",independentRecoveryCopyChecked:true};
    Object.assign(status.backup!,{localSnapshot:local,key:local.archiveKey,sha256:local.archiveSha256,bytes:local.archiveBytes});
    mocks.status=status;expect(opsReady(status,golden.identity,golden.now)).toBe(true);expect(backupStatusReady(status,golden.identity,golden.now)).toBe(true);
    await expect(assertPcAppWriteAllowed()).resolves.toBeUndefined();
    for(const change of [{capturedAt:undefined},{capturedAt:"2026-10-11T00:28:59.999Z"},{capturedAt:"2026-10-11T00:29:31.000Z"},
      {restoreVerifiedAt:"2026-10-11T00:29:59.001Z"},{offsiteVerifiedAt:"2026-10-11T00:30:00.001Z"},{capturedAt:"invalid"}]) {
      const changed={...status,backup:{...status.backup!,localSnapshot:{...local,...change}}};mocks.status=changed;
      expect(opsReady(changed,golden.identity,golden.now)).toBe(false);expect(backupStatusReady(changed,golden.identity,golden.now)).toBe(false);
      const legacyPair={...snapshot(),backup:{...snapshot().backup,localSnapshot:changed.backup.localSnapshot}};
      expect(opsReady(legacyPair,golden.identity,golden.now)).toBe(false);expect(backupStatusReady(legacyPair,golden.identity,golden.now)).toBe(false);
      await expect(assertPcAppWriteAllowed()).rejects.toBeInstanceOf(PcBackupProtectionError);
    }
  });
  it.each(vectors)("agrees with ops for $name", vector => {
    expect(opsReady(vector.status, vector.identity, vector.now)).toBe(vector.ready);
    expect(backupStatusReady(vector.status, vector.identity, vector.now)).toBe(vector.ready);
  });
  it("does not grant a synthetic blanket bypass", async () => {
    mocks.synthetic = true; mocks.status = null;
    await expect(assertPcAppWriteAllowed()).rejects.toBeInstanceOf(PcBackupProtectionError);
    mocks.status = snapshot(); await expect(assertPcAppWriteAllowed()).resolves.toBeUndefined();
  });
  it("rejects unreadable, redirected and malformed status without exposing diagnostics", async () => {
    for (const fail of [() => mocks.lstat.mockRejectedValue(Error("private path and secret")),
      () => mocks.realpath.mockResolvedValue(resolve("other.json")),
      () => mocks.lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => true, size: 1 }),
      () => mocks.lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: 16_385 })]) {
      mocks.lstat.mockReset().mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: 1 });
      mocks.realpath.mockReset().mockResolvedValue(path); fail();
      await expect(assertPcAppWriteAllowed()).rejects.toMatchObject({ status: 503, code: "PC_BACKUP_UNAVAILABLE" });
    }
    mocks.lstat.mockRejectedValue(Error("private path and secret"));
    await expect(assertPcAppWriteAllowed()).rejects.not.toThrow("private path and secret");
  });
  it("rejects missing generation/target and relative path", async () => {
    for (const field of ["PC_APP_BACKUP_INSTANCE_ID", "PC_APP_BACKUP_GENERATION", "PC_APP_BACKUP_STARTED_AT", "PC_APP_BACKUP_DATABASE_SYSTEM_IDENTIFIER", "PC_APP_BACKUP_STATUS_PATH"]) {
      const current = process.env[field]; vi.stubEnv(field, "");
      await expect(assertPcAppWriteAllowed()).rejects.toMatchObject({ status: 503 }); vi.stubEnv(field, current);
    }
    vi.stubEnv("PC_APP_BACKUP_STATUS_PATH", "relative.json"); await expect(assertPcAppWriteAllowed()).rejects.toMatchObject({ status: 503 });
  });
});

describe("all PC business transports fail closed once, then recover", () => {
  it.each([
    ["/rest/v1/practice_records", "PATCH", { memo: "synthetic" }], ["/rest/v1/rpc/save_practice_menu", "POST", {}],
    ["/storage/v1/object/avatars/synthetic.webp", "POST", {}], ["/auth/v1/admin/users", "POST", { id }],
    ["/functions/v1/unknown", "GET", undefined], ["/rest/v1/rpc/unknown", "GET", undefined],
  ])("protects %s %s without dispatch", async (api, method, body) => {
    mocks.status = null;
    const response = await pcBackendFetch(request(api, method, body));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "PC_BACKUP_UNAVAILABLE" });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("allows normal REST/RPC/storage writes, stops during maintenance, and recovers", async () => {
    for (const api of ["/rest/v1/practice_records", "/rest/v1/rpc/save_practice_menu", "/storage/v1/object/avatars/synthetic.webp"]) {
      expect((await pcBackendFetch(request(api, "POST", {}))).status).toBe(200);
    }
    mocks.status = { ...snapshot(), heartbeat: { ...snapshot().heartbeat, maintenance: true } };
    expect((await pcBackendFetch(request("/rest/v1/practice_records", "POST", {}))).status).toBe(503);
    expect(mocks.dispatch).toHaveBeenCalledTimes(3);
    mocks.status = snapshot(); expect((await pcBackendFetch(request("/rest/v1/practice_records", "POST", {}))).status).toBe(200);
    expect(mocks.dispatch).toHaveBeenCalledTimes(4);
    expect(mocks.dispatch.mock.calls.every(([target]) => String(target).startsWith("http://127.0.0.1:18180/"))).toBe(true);
  });
  it("guards session Actions and service-role operations at their shared fetch", async () => {
    mocks.status = null;
    const options = sessionClientConfig().options as { global: { fetch: typeof fetch } };
    const response = await options.global.fetch("http://127.0.0.1:18181/rest/v1/practice_records", { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
    const admin = createAdminClient();
    expect((await admin.from("profiles").update({ approved: true }).eq("id", id)).error?.code).toBe("PC_BACKUP_UNAVAILABLE");
    expect((await admin.auth.admin.createUser({ id, email: "synthetic@example.invalid" })).error?.status).toBe(503);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("keeps REST reads, exact read RPC and cloud Auth dispatch available while protected", async () => {
    mocks.status = null;
    for (const req of [request("/rest/v1/profiles", "GET"), request("/rest/v1/rpc/login_access_allowed", "POST", {}),
      request("/rest/v1/rpc/get_feed_social_state", "POST", { record_ids: [id], tweet_ids: [] }),
      request("/rest/v1/rpc/google_sheet_creation_status", "POST", {}),
      request("/storage/v1/object/sign/avatars/synthetic.webp", "POST", { expiresIn: 300 })]) expect((await pcBackendFetch(req)).status).toBe(200);
    const options = sessionClientConfig().options as { global: { fetch: typeof fetch } };
    expect((await options.global.fetch("http://127.0.0.1:18181/auth/v1/token?grant_type=refresh_token", { method: "POST", body: "{}" })).status).toBe(200);
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.dispatch).toHaveBeenCalledTimes(6);
  });
  it("does not accept extra/malformed RPC arguments, alternate schemas or unknown paths as reads", async () => {
    for (const [api, body] of [["login_access_allowed", { surprise: true }], ["get_feed_social_state", { record_ids: ["invalid"], tweet_ids: [] }],
      ["can_edit_note", { target_note_id: id, extra: true }], ["google_sheet_creation_status", { attempt_id: id }],
      ["google_sheet_creation_register", { p_attempt_id: id }], ["unknown", {}]] as const) expect(await pcBackendRequestNeedsProtection(request(`/rest/v1/rpc/${api}`, "POST", body), `/rest/v1/rpc/${api}`)).toBe(true);
    const alternate = request("/rest/v1/rpc/is_member", "POST", {}); alternate.headers.set("content-profile", "other");
    expect(await pcBackendRequestNeedsProtection(alternate, "/rest/v1/rpc/is_member")).toBe(true);
  });
  it("keeps competition viewing available while its mutations remain protected", async () => {
    mocks.status = null;
    for (const [api, body] of [["get_competition_meet", { p_competition_id: "ob-2026" }], ["get_competition_meet_backend", {}]] as const) {
      expect((await pcBackendFetch(request(`/rest/v1/rpc/${api}`, "POST", body))).status).toBe(200);
    }
    expect(mocks.open).not.toHaveBeenCalled();
    mocks.dispatch.mockClear();
    for (const [api, body] of [["get_competition_meet", { p_competition_id: 2026 }],
      ["get_competition_meet", { p_competition_id: "ob-2026", extra: true }],
      ["get_competition_meet_backend", { extra: true }], ["competition_meet_apply", {}]] as const) {
      expect((await pcBackendFetch(request(`/rest/v1/rpc/${api}`, "POST", body))).status).toBe(503);
    }
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe("direct provider mutation boundaries", () => {
  const storage = { storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) } } as unknown as Parameters<typeof uploadImage>[0];
  const sheet = { accessToken: "synthetic-token", title: "Synthetic", kind: "practice" as const, year: 2026, month: 10, block: "all" as const, venues: [], schedules: [], weekdayDefaults: [], onCreated: async () => undefined };
  beforeEach(() => {
    for (const [name, value] of Object.entries({ R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "synthetic", R2_SECRET_ACCESS_KEY: "synthetic", R2_BUCKET_NAME: "synthetic", R2_READ_ENABLED: "true", R2_WRITE_ENABLED: "true", IMAGE_STORAGE_READ_ONLY: "false", SHEET_SYNC_GAS_URL: "https://gas.example.test" })) vi.stubEnv(name, value);
  });
  it("dispatches no R2/GAS/Sheets request while protected", async () => {
    mocks.status = null;
    for (const operation of [() => uploadImage(storage, "avatars", "synthetic/avatar.webp", Buffer.from("synthetic")),
      () => removeImages(storage, "avatars", ["synthetic/avatar.webp"]), () => gasPost({ action: "writeCells" }),
      () => createScheduleSpreadsheet(sheet)]) await expect(operation()).rejects.toMatchObject({ status: 503, code: "PC_BACKUP_UNAVAILABLE" });
    expect(mocks.r2).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("permits provider writes with a fresh pair and recovery after a protection interval", async () => {
    mocks.dispatch.mockImplementation(async (target: string) => target.includes("/v4/spreadsheets") && !target.includes(":batchUpdate")
      ? Response.json({ spreadsheetId: "synthetic", spreadsheetUrl: "https://sheets.example.test/synthetic", sheets: [{ properties: { sheetId: 1 } }] }) : Response.json({ success: true }));
    await uploadImage(storage, "avatars", "synthetic/avatar.webp", Buffer.from("synthetic"));
    await removeImages(storage, "note-images", [`${id}/22222222-2222-4222-8222-222222222222.webp`]);
    await gasPost({ action: "writeCells" }); await createScheduleSpreadsheet(sheet);
    expect(mocks.r2.mock.calls.map(([command]) => command.constructor.name)).toEqual(["ListObjectsV2Command", "PutObjectCommand", "DeleteObjectsCommand"]);
    expect(mocks.dispatch).toHaveBeenCalledTimes(3);
    mocks.status = null; await expect(gasPost({ action: "writeCells" })).rejects.toMatchObject({ status: 503 });
    mocks.status = snapshot(); await gasPost({ action: "writeCells" }); expect(mocks.dispatch).toHaveBeenCalledTimes(4);
  });
  it("rechecks immediately before R2 PUT after capacity/auth work changes protection", async () => {
    mocks.r2.mockImplementation(async () => { mocks.status = null; return { Contents: [] }; });
    await expect(uploadImage(storage, "avatars", "synthetic/avatar.webp", Buffer.from("synthetic"))).rejects.toMatchObject({ status: 503 });
    expect(mocks.r2.mock.calls.map(([command]) => command.constructor.name)).toEqual(["ListObjectsV2Command"]);
  });
  it("does not send a second Sheets mutation after protection changes during creation", async () => {
    mocks.dispatch.mockImplementation(async () => { mocks.status = null; return Response.json({ spreadsheetId: "synthetic", spreadsheetUrl: "https://sheets.example.test", sheets: [{ properties: { sheetId: 1 } }] }); });
    await expect(createScheduleSpreadsheet(sheet)).rejects.toMatchObject({ outcome: "partial", phase: "setup", protection: true,
      resource: { spreadsheetId: "synthetic", url: "https://docs.google.com/spreadsheets/d/synthetic/edit" }, retryable: false });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });
  it("reports unknown first Sheets create results without another dispatch", async () => {
    mocks.dispatch.mockRejectedValue(new Error("synthetic response lost"));
    await expect(createScheduleSpreadsheet(sheet)).rejects.toMatchObject({ outcome: "unknown", phase: "create", resource: null, retryable: false });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });
  it("keeps the pure GAS fetch read available and never retries a failed mutation", async () => {
    mocks.status = null; mocks.dispatch.mockResolvedValueOnce(Response.json({ data: {} })); await gasPost({ action: "fetchMember" });
    mocks.status = snapshot(); mocks.dispatch.mockResolvedValueOnce(Response.json({ error: "synthetic failure" }, { status: 503 }));
    await expect(gasPost({ action: "writeCells" })).rejects.toThrow(); expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });
});
