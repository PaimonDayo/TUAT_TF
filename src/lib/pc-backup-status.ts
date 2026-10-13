// Server-only child configuration. No public environment settings or provider IO.
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { getPcAppRuntime } from "./pc-app-runtime";
import { isSafeAvatarStoragePath } from "./avatar-image";

export type PcBackupIdentity = { instanceId: string; generation: string; startedAt: string; databaseSystemIdentifier: string; databaseName?: string };
export type PcBackupStatus = {
  version: 1; instanceId: string; generation: string; startedAt: string;
  heartbeat: { checkedAt: string; healthy: boolean; maintenance: boolean };
  target: { checkedAt: string; healthy: boolean; databaseSystemIdentifier: string; databaseName: string; containerId: string; containerImageId: string };
  backup: null | { generation: string; verifiedAt: string; key: string; recoveryKey?: string; sha256: string; recoverySha256?: string; bytes: number; recoveryBytes?: number; databaseSystemIdentifier: string;
    localSnapshot?: { format: string; sourceId: string; generation: string; databaseSystemIdentifier: string; imageRoot: string;
      archiveKey: string; archiveSha256: string; archiveBytes: number; restoreVerifiedAt: string; offsiteVerifiedAt: string; independentRecoveryCopyChecked: boolean } };
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const utcTime = (value: unknown) => {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
};

/** Mirrored operational contract; conformance uses the same synthetic vectors. */
export function backupStatusReady(value: unknown, expected: unknown, now = Date.now()): boolean {
  try {
    const status = value as PcBackupStatus | null, identity = expected as PcBackupIdentity | null;
    if (!Number.isFinite(now) || status?.version !== 1 || !uuid(identity?.instanceId) || !uuid(identity?.generation)
      || typeof identity.databaseSystemIdentifier !== "string" || !/^\d{10,20}$/.test(identity.databaseSystemIdentifier)
      || status.instanceId !== identity.instanceId || status.generation !== identity.generation || status.startedAt !== identity.startedAt) return false;
    const heartbeat = status.heartbeat, target = status.target, backup = status.backup;
    if (!heartbeat || !target || !backup) return false;
    const started = utcTime(status.startedAt), checked = utcTime(heartbeat.checkedAt), targetAt = utcTime(target.checkedAt), verified = utcTime(backup.verifiedAt);
    if (![started, checked, targetAt, verified].every(Number.isFinite) || started > now
      || checked < started || checked > now || now - checked >= 120_000
      || targetAt < started || targetAt > now || now - targetAt >= 120_000
      || verified < started || verified > now || now - verified >= 35 * 60_000) return false;
    if (heartbeat.healthy !== true || heartbeat.maintenance !== false || target.healthy !== true
      || backup.generation !== identity.generation || target.databaseSystemIdentifier !== identity.databaseSystemIdentifier
      || backup.databaseSystemIdentifier !== identity.databaseSystemIdentifier || !/^[a-z_][a-z0-9_]{0,62}$/.test(identity.databaseName ?? "postgres") || target.databaseName !== (identity.databaseName ?? "postgres")
      || !/^[a-f0-9]{64}$/.test(target.containerId ?? "") || !/^sha256:[a-f0-9]{64}$/.test(target.containerImageId ?? "")) return false;
    if (backup.localSnapshot && backup.key === backup.localSnapshot.archiveKey) {
      return localSnapshotReady(status, identity, backup.localSnapshot.imageRoot, now) && backup.sha256 === backup.localSnapshot.archiveSha256 && backup.bytes === backup.localSnapshot.archiveBytes;
    }
    const prefix = `ops/pc-backend/${identity.instanceId}/backups/`, name = backup.key?.slice(prefix.length);
    if (typeof backup.key !== "string" || !backup.key.startsWith(prefix)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump\.enc$/.test(name ?? "")
      || backup.recoveryKey !== backup.key.replace(/\.dump\.enc$/, ".recovery.json.enc")
      || ![backup.sha256, backup.recoverySha256].every(hash => /^[a-f0-9]{64}$/.test(hash ?? ""))
      || ![backup.bytes, backup.recoveryBytes].every(bytes => typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 36)) return false;
    return true;
  } catch { return false; }
}

export class PcBackupProtectionError extends Error {
  readonly status = 503;
  readonly code = "PC_BACKUP_UNAVAILABLE";
  constructor() { super("データの保存を一時停止しています。バックアップの状態を確認できるまでお待ちください。"); }
}

/** A legacy DB-only R2 receipt cannot admit writes with new local image storage. */
export function localSnapshotReady(status: PcBackupStatus, identity: PcBackupIdentity, imageRoot: string | undefined, now = Date.now()): boolean {
  const snapshot = status.backup?.localSnapshot;
  if (!snapshot || !imageRoot || snapshot.format !== "tuat-local-db-images-v1" || snapshot.sourceId !== identity.instanceId ||
      snapshot.generation !== identity.generation || snapshot.databaseSystemIdentifier !== identity.databaseSystemIdentifier || snapshot.imageRoot !== imageRoot ||
      snapshot.independentRecoveryCopyChecked !== true || !/^[a-f0-9]{64}$/.test(snapshot.archiveSha256 ?? "") ||
      !Number.isSafeInteger(snapshot.archiveBytes) || snapshot.archiveBytes < 36 || snapshot.archiveBytes > 16 * 1024 ** 3) return false;
  const prefix = `ops/pc-backend/${identity.instanceId}/backups/`;
  if (!snapshot.archiveKey?.startsWith(prefix) || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.local\.tar\.enc$/.test(snapshot.archiveKey.slice(prefix.length))) return false;
  const started = utcTime(identity.startedAt);
  return [snapshot.restoreVerifiedAt, snapshot.offsiteVerifiedAt].every(value => {
    const time = utcTime(value); return Number.isFinite(time) && time >= started && time <= now && now - time < 35 * 60_000;
  });
}

/** No cached approval: each dispatch observes this host generation's latest state. */
export async function assertPcAppWriteAllowed(): Promise<void> {
  try {
    const app = getPcAppRuntime();
    if (!app) return;
    const path = process.env.PC_APP_BACKUP_STATUS_PATH;
    if (!path || !isAbsolute(path) || resolve(path) !== path) throw new PcBackupProtectionError();
    const info = await lstat(path), actual = await realpath(path);
    const same = process.platform === "win32" ? actual.toLowerCase() === path.toLowerCase() : actual === path;
    if (!same || info.isSymbolicLink() || !info.isFile() || info.size > 16_384) throw new PcBackupProtectionError();
    const file = await open(path, "r");
    let status: unknown;
    try {
      if (!(await file.stat()).isFile()) throw new PcBackupProtectionError();
      const bytes = Buffer.alloc(16_385), read = await file.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead > 16_384) throw new PcBackupProtectionError();
      status = JSON.parse(bytes.subarray(0, read.bytesRead).toString("utf8"));
    } finally { await file.close(); }
    const identity = { instanceId: process.env.PC_APP_BACKUP_INSTANCE_ID, generation: process.env.PC_APP_BACKUP_GENERATION,
      startedAt: process.env.PC_APP_BACKUP_STARTED_AT, databaseSystemIdentifier: process.env.PC_APP_BACKUP_DATABASE_SYSTEM_IDENTIFIER, databaseName: process.env.PC_APP_BACKUP_DATABASE_NAME };
    if (!backupStatusReady(status, identity) || (app.local && !localSnapshotReady(status as PcBackupStatus, identity as PcBackupIdentity, process.env.LOCAL_IMAGE_STORAGE_ROOT))) throw new PcBackupProtectionError();
  } catch { throw new PcBackupProtectionError(); }
}

export function pcBackupUnavailableResponse(): Response {
  const error = new PcBackupProtectionError();
  return Response.json({ error: error.message, message: error.message, code: error.code, details: null, hint: null }, {
    status: error.status, headers: { "cache-control": "private, no-store", "retry-after": "30" },
  });
}

export function pcBackupProtectionResponse(error: unknown): Response | null {
  return error instanceof PcBackupProtectionError || (typeof error === "object" && error !== null && "code" in error && error.code === "PC_BACKUP_UNAVAILABLE")
    ? pcBackupUnavailableResponse() : null;
}

export async function pcAppWriteProtectionResponse(): Promise<Response | null> {
  try { await assertPcAppWriteAllowed(); return null; } catch { return pcBackupUnavailableResponse(); }
}

const uuidArg = (value: unknown) => typeof value === "string" && uuid(value.toLowerCase());
const uuidArray = (value: unknown) => Array.isArray(value) && value.every(uuidArg);
const rpcReads: Record<string, Record<string, (value: unknown) => boolean>> = {
  login_access_allowed: {}, is_member: {}, can_create_schedule: {}, google_sheet_creation_status: {},
  get_competition_meet: { p_competition_id: value => typeof value === "string" },
  get_competition_meet_backend: {},
  can_edit_note: { target_note_id: uuidArg },
  avatar_image_is_retired: { p_path: value => typeof value === "string" && isSafeAvatarStoragePath(value) },
  get_ob_registration_details_snapshot: { p_entry_id: uuidArg },
  get_record_field_groups: { requested_record_ids: uuidArray }, get_tweet_feed_extras: { tweet_ids: uuidArray },
  get_feed_social_state: { record_ids: uuidArray, tweet_ids: uuidArray },
  get_note_poll_options: { article_ids: uuidArray }, get_comment_like_state: { comment_ids: uuidArray },
};

/** Only reviewed pure reads can bypass protection; an unknown RPC is a write. */
export async function pcBackendRequestNeedsProtection(request: Request, path: string): Promise<boolean> {
  if (path.startsWith("/functions/v1")) return true;
  const rpc = /^\/rest\/v1\/rpc\/([a-z][a-z0-9_]*)$/.exec(path);
  if (!rpc && ["GET", "HEAD"].includes(request.method)) return false;
  const signing = /^\/storage\/v1\/object\/sign\/(avatars|tweet-images|note-images)\/.+$/.test(path);
  if (request.method !== "POST" || (!signing && (!rpc || !Object.hasOwn(rpcReads, rpc[1])))) return true;
  if (["accept-profile", "content-profile"].some(name => request.headers.has(name) && request.headers.get(name) !== "public")) return true;
  const query = new URL(request.url).searchParams;
  if (Array.from(query.keys()).some(key => !["select", "limit", "offset"].includes(key))) return true;
  try {
    const text = await request.clone().text();
    if (text.length > 65_536) return true;
    const args = text ? JSON.parse(text) : {};
    if (!args || typeof args !== "object" || Array.isArray(args)) return true;
    if (signing) return Object.keys(args).length !== 1 || !Number.isSafeInteger(args.expiresIn) || args.expiresIn < 1 || args.expiresIn > 31_536_000;
    const expected = rpcReads[rpc![1]];
    return Object.keys(args).length !== Object.keys(expected).length
      || Object.entries(expected).some(([key, valid]) => !Object.hasOwn(args, key) || !valid(args[key]));
  } catch { return true; }
}
