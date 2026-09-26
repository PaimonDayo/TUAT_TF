// PCのDB → クラウドSupabase への写し（PCが止まったときの予備構成。2026-09-26 オーナー確定）。
//
// - 表示に必要な小さな表（部員・ロール・予定・お知らせなど）は全部写す。
// - 投稿（練習記録・つぶやき・コメント・いいね）と出欠は直近 WINDOW_DAYS 日分だけ写し、それより古いものはクラウドから消す。
// - PCで消えた行はクラウドからも消す。変わっていない行は書かない。
// - クラウドへの書き込みにはヘッダー x-tuat-mirror: 1 を付ける（通知・プッシュなどのトリガーが動かないように。
//   migration 20260926030000）。
// - 追加の npm パッケージに頼らない（node_modules が消えても動くように）。
// - 写す前に、PCが止まっている間にクラウドへ入った書き込み（failover_changes、migration 20260926050000）を
//   PCへ書き戻す。書き戻せていない行は写しで上書き・削除しない。
//
// 使い方: node ops/laptop/cloud-mirror.mjs          … 差分を数えるだけ（書き込まない）
//         node ops/laptop/cloud-mirror.mjs --apply  … クラウドへ反映する

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WINDOW_DAYS = 3;
const PAGE = 1000;
const BATCH = 500;
const root = resolve(import.meta.dirname, "../../.contingency");

function readEnvFile(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")];
      }),
  );
}

const pcEnv = readEnvFile(resolve(root, "local-app.env"));
const cloudEnv = JSON.parse(readFileSync(resolve(root, "backend/production-rollback-env.json"), "utf8"));
const pc = { url: pcEnv.NEXT_PUBLIC_SUPABASE_URL, key: pcEnv.SUPABASE_SERVICE_ROLE_KEY };
const cloud = { url: cloudEnv.NEXT_PUBLIC_SUPABASE_URL, key: cloudEnv.SUPABASE_SERVICE_ROLE_KEY };
if (!pc.url || !pc.key || !cloud.url || !cloud.key) throw new Error("PCまたはクラウドの接続設定が見つかりません");

const headers = (side, extra = {}) => ({
  apikey: side.key,
  Authorization: `Bearer ${side.key}`,
  ...(side === cloud ? { "x-tuat-mirror": "1" } : {}),
  ...extra,
});

async function request(side, path, init = {}) {
  const response = await fetch(`${side.url}${path}`, {
    ...init,
    headers: headers(side, init.headers ?? {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${side === pc ? "PC" : "クラウド"} ${init.method ?? "GET"} ${path.split("?")[0]} ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

/** 条件に合う行を全部読む（1回1,000行の上限があるので、並び順を固定してページに分ける）。 */
async function readAll(side, table, pk, filter = "") {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const order = pk.map((c) => `${c}.asc`).join(",");
    const response = await request(side, `/rest/v1/${table}?select=*${filter ? `&${filter}` : ""}&order=${order}&limit=${PAGE}&offset=${offset}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const keyOf = (pk) => (row) => pk.map((c) => String(row[c])).join("|");
const inList = (values) => `(${values.map((v) => `"${String(v).replaceAll('"', '\\"')}"`).join(",")})`;

// クラウド側のトリガーが値を変える列は、差分の判定に使わない（毎回書き直さないように）。
const VOLATILE = new Set(["updated_at", "synced_at", "pending_sheet_push", "likes_count"]);
const comparable = (row) =>
  JSON.stringify(Object.keys(row).sort().filter((k) => !VOLATILE.has(k)).map((k) => [k, row[k]]));

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // JST
const windowStartDate = new Date(Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
const windowStartTime = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

/**
 * 写す表（親→子の順）。filter は PC から読む条件。window の表は、クラウドもこの範囲だけを持つ。
 * filter を関数にしている表は、先に読んだ親の表の結果で絞る。
 */
const TABLES = [
  { table: "role_categories", pk: ["id"] },
  { table: "roles", pk: ["id"] },
  { table: "profiles", pk: ["id"] },
  { table: "profile_roles", pk: ["profile_id", "role_id"] },
  { table: "venues", pk: ["id"] },
  { table: "competitions", pk: ["id"] },
  { table: "competition_events", pk: ["name"] },
  { table: "schedule_sheets", pk: ["id"] },
  { table: "practice_schedules", pk: ["id"] },
  { table: "practice_menus", pk: ["id"] },
  { table: "practice_menu_targets", pk: ["menu_id", "user_id"] },
  { table: "notices", pk: ["id"] },
  { table: "record_form_config_versions", pk: ["id"] },
  { table: "note_themes", pk: ["id"] },
  { table: "notes", pk: ["id"] },
  { table: "note_editors", pk: ["note_id", "user_id"] },
  { table: "note_articles", pk: ["id"] },
  { table: "note_article_images", pk: ["id"] },
  { table: "note_poll_options", pk: ["id"] },
  { table: "note_poll_votes", pk: ["option_id", "user_id"] },
  { table: "threads", pk: ["id"] },
  { table: "thread_posts", pk: ["id"] },
  { table: "pb_records", pk: ["id"] },
  { table: "competition_goals", pk: ["id"] },
  { table: "competition_entries", pk: ["id"] },
  { table: "competition_program_entries", pk: ["id"] },
  { table: "favorites", pk: ["user_id", "favorite_user_id"] },
  { table: "notice_reactions", pk: ["notice_id", "user_id", "reaction"] },
  { table: "notice_dismissals", pk: ["user_id", "notice_id"] },
  { table: "menu_target_presets", pk: ["id"] },
  { table: "notifications", pk: ["id"], window: true, filter: () => `created_at=gte.${windowStartTime}` },
  {
    table: "attendances", pk: ["id"], window: true,
    filter: (ctx) => ({ schedule_id: ctx.recentScheduleIds }),
  },
  {
    table: "practice_records", pk: ["id"], window: true,
    filter: () => `or=(recorded_date.gte.${windowStartDate},created_at.gte.${windowStartTime})`,
  },
  { table: "tweets", pk: ["id"], window: true, filter: () => `created_at=gte.${windowStartTime}` },
  { table: "tweet_poll_options", pk: ["id"], window: true, filter: (ctx) => ({ tweet_id: ctx.ids.tweets }) },
  { table: "tweet_poll_votes", pk: ["option_id", "user_id"], window: true, filter: (ctx) => ({ option_id: ctx.ids.tweet_poll_options }) },
  { table: "tweet_mentions", pk: ["tweet_id", "profile_id"], window: true, filter: (ctx) => ({ tweet_id: ctx.ids.tweets }) },
  {
    table: "comments", pk: ["id"], window: true,
    filter: (ctx) => ({ target_id: [...ctx.ids.practice_records, ...ctx.ids.tweets] }),
  },
  {
    table: "likes", pk: ["id"], window: true,
    filter: (ctx) => ({ target_id: [...ctx.ids.practice_records, ...ctx.ids.tweets, ...ctx.ids.comments] }),
  },
];

/** filter が「列: 値の一覧」なら、URLが長くなりすぎないよう分けて読む。 */
async function readFiltered(side, spec, filter) {
  if (filter === undefined) return readAll(side, spec.table, spec.pk);
  if (typeof filter === "string") return readAll(side, spec.table, spec.pk, filter);
  const [[column, values]] = Object.entries(filter);
  const rows = [];
  for (let i = 0; i < values.length; i += 100) {
    rows.push(...(await readAll(side, spec.table, spec.pk, `${column}=in.${inList(values.slice(i, i + 100))}`)));
  }
  return rows;
}

/** PCにいてクラウドにいないアカウントを、同じID・メールでクラウドに作る（部員名簿がアカウントを参照するため）。 */
async function syncAuthUsers(apply) {
  const [pcUsers, cloudUsers] = await Promise.all([listUsers(pc), listUsers(cloud)]);
  const known = new Set(cloudUsers.map((u) => u.id));
  const missing = pcUsers.filter((u) => !known.has(u.id) && /@st\.go\.tuat\.ac\.jp$/i.test(u.email ?? ""));
  if (apply) {
    for (const u of missing) {
      await request(cloud, "/auth/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id, email: u.email, email_confirm: true, user_metadata: u.user_metadata, app_metadata: { provider: "google", providers: ["google"] } }),
      });
    }
  }
  return missing.length;
}

// ---- 書き戻し（クラウド → PC） ----

/** 主キー以外で1件に決まる表。クラウドで新しいIDの行ができても、PCの同じ行へ書く。 */
const NATURAL_KEYS = {
  practice_records: ["user_id", "recorded_date"],
  attendances: ["schedule_id", "user_id", "attend_date"],
  likes: ["user_id", "target_type", "target_id"],
  competition_goals: ["competition_id", "user_id", "event"],
};
const MAX_ATTEMPTS = 5;
const eqFilter = (values) => Object.entries(values).map(([c, v]) => `${c}=${v === null ? "is.null" : `eq.${encodeURIComponent(String(v))}`}`).join("&");
const pick = (row, columns) => Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]]));
const omit = (row, columns) => Object.fromEntries(Object.entries(row).filter(([c]) => !columns.includes(c)));

async function pcWrite(path, init) {
  const response = await fetch(`${pc.url}${path}`, { ...init, headers: headers(pc, init.headers ?? {}), signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: response.status, ok: response.ok, body, text };
}

/** 1件の変更をPCへ書く。成功なら true、失敗なら理由の文字列。 */
async function applyChange(change) {
  const table = change.table_name;
  const natural = NATURAL_KEYS[table];
  const json = { "Content-Type": "application/json" };
  const pkCols = Object.keys(change.pk);
  const insertRow = async (row) => {
    const r = await pcWrite(`/rest/v1/${table}?on_conflict=${pkCols.join(",")}`, {
      method: "POST", headers: { ...json, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row),
    });
    if (r.ok) return true;
    // 主キー以外の一意の組（同じ日の記録など）がPCにある → その行を更新する。
    if (r.status === 409 && natural) {
      const u = await pcWrite(`/rest/v1/${table}?${eqFilter(pick(row, natural))}`, {
        method: "PATCH", headers: { ...json, Prefer: "return=minimal" }, body: JSON.stringify(omit(row, pkCols)),
      });
      return u.ok || `${u.status} ${u.text.slice(0, 200)}`;
    }
    return `${r.status} ${r.text.slice(0, 200)}`;
  };
  if (change.op === "INSERT") return insertRow(change.row_data);
  if (change.op === "DELETE") {
    const r = await pcWrite(`/rest/v1/${table}?${eqFilter(change.pk)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return r.ok || `${r.status} ${r.text.slice(0, 200)}`;
  }
  // UPDATE: 変わった列だけ
  const patch = pick(change.row_data, change.changed ?? []);
  const r = await pcWrite(`/rest/v1/${table}?${eqFilter(change.pk)}`, {
    method: "PATCH", headers: { ...json, Prefer: "return=representation" }, body: JSON.stringify(patch),
  });
  if (!r.ok) return `${r.status} ${r.text.slice(0, 200)}`;
  if (Array.isArray(r.body) && r.body.length) return true;
  if (natural) {
    const u = await pcWrite(`/rest/v1/${table}?${eqFilter(pick(change.row_data, natural))}`, {
      method: "PATCH", headers: { ...json, Prefer: "return=representation" }, body: JSON.stringify(omit(patch, pkCols)),
    });
    if (u.ok && Array.isArray(u.body) && u.body.length) return true;
  }
  // PCに無い行（クラウドで作られ、その追加の書き戻しに失敗したなど）は行全体を追加する。
  return insertRow(change.row_data);
}

async function listUsers(side) {
  const users = [];
  for (let page = 1; ; page++) {
    const body = await (await request(side, `/auth/v1/admin/users?page=${page}&per_page=1000`)).json();
    users.push(...(body.users ?? []));
    if ((body.users ?? []).length < 1000) return users;
  }
}

/** クラウドにしかいないアカウントをPCに作る（PCが止まっている間に初めてログインした部員）。 */
async function syncAuthUsersBack(apply) {
  const [pcUsers, cloudUsers] = await Promise.all([listUsers(pc), listUsers(cloud)]);
  const known = new Set(pcUsers.map((u) => u.id));
  const missing = cloudUsers.filter((u) => !known.has(u.id) && /@st\.go\.tuat\.ac\.jp$/i.test(u.email ?? ""));
  if (apply) {
    for (const u of missing) {
      await request(pc, "/auth/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id, email: u.email, email_confirm: true, user_metadata: u.user_metadata, app_metadata: { provider: "google", providers: ["google"] } }),
      });
    }
  }
  return missing.length;
}

async function readChanges() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await (await request(cloud, `/rest/v1/failover_changes?select=*&attempts=lt.${MAX_ATTEMPTS}&order=id.asc&limit=${PAGE}&offset=${offset}`)).json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** クラウドへ入った書き込みを古い順にPCへ書く。成功した記録は消し、失敗は回数と理由を残す。 */
async function writeBack(apply) {
  const result = { authUsersCreated: await syncAuthUsersBack(apply), pending: 0, applied: 0, failed: 0 };
  const changes = await readChanges();
  result.pending = changes.length;
  if (!apply) return result;
  for (const change of changes) {
    let outcome;
    try { outcome = await applyChange(change); } catch (error) { outcome = error instanceof Error ? error.message : String(error); }
    if (outcome === true) {
      await request(cloud, `/rest/v1/failover_changes?id=eq.${change.id}`, { method: "DELETE" });
      result.applied++;
    } else {
      await request(cloud, `/rest/v1/failover_changes?id=eq.${change.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempts: change.attempts + 1, last_error: String(outcome).slice(0, 500) }),
      });
      result.failed++;
    }
  }
  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const writeback = await writeBack(apply);
  // 書き戻しの途中や後にクラウドへ入った書き込みは、次の回に書き戻す。それまで写しで上書き・削除しない。
  const pending = new Map();
  for (const change of await readChanges()) {
    if (!pending.has(change.table_name)) pending.set(change.table_name, new Set());
    pending.get(change.table_name).add(JSON.stringify(change.pk));
  }
  const summary = { apply, windowStartDate, writeback, authUsersCreated: await syncAuthUsers(apply), tables: {} };
  const ctx = { ids: {}, recentScheduleIds: [] };
  const plans = [];

  for (const spec of TABLES) {
    const filter = typeof spec.filter === "function" ? spec.filter(ctx) : undefined;
    const pcRows = await readFiltered(pc, spec, filter);
    const cloudRows = await readAll(cloud, spec.table, spec.pk);
    const key = keyOf(spec.pk);
    const pcByKey = new Map(pcRows.map((r) => [key(r), r]));
    const cloudByKey = new Map(cloudRows.map((r) => [key(r), r]));
    const held = pending.get(spec.table);
    const isHeld = (r) => held?.has(JSON.stringify(Object.fromEntries(spec.pk.map((c) => [c, r[c]])))) ?? false;
    const upserts = pcRows.filter((r) => {
      const current = cloudByKey.get(key(r));
      return !isHeld(r) && (!current || comparable(current) !== comparable(r));
    });
    const deletes = cloudRows.filter((r) => !pcByKey.has(key(r)) && !isHeld(r));
    plans.push({ spec, upserts, deletes });
    ctx.ids[spec.table] = pcRows.map((r) => r.id).filter(Boolean);
    if (spec.table === "practice_schedules") {
      ctx.recentScheduleIds = pcRows
        .filter((r) => (r.end_date ?? r.schedule_date) >= windowStartDate)
        .map((r) => r.id);
    }
    summary.tables[spec.table] = { pc: pcRows.length, cloud: cloudRows.length, upsert: upserts.length, delete: deletes.length };
  }

  if (apply) {
    // 子から先に消す（参照している行が残っていると親を消せない）。
    for (const { spec, deletes } of [...plans].reverse()) {
      for (let i = 0; i < deletes.length; i += 100) {
        const chunk = deletes.slice(i, i + 100);
        if (spec.pk.length === 1) {
          await request(cloud, `/rest/v1/${spec.table}?${spec.pk[0]}=${`in.${inList(chunk.map((r) => r[spec.pk[0]]))}`}`, { method: "DELETE" });
        } else {
          for (const row of chunk) {
            await request(cloud, `/rest/v1/${spec.table}?${spec.pk.map((c) => `${c}=eq.${encodeURIComponent(row[c])}`).join("&")}`, { method: "DELETE" });
          }
        }
      }
    }
    // 親から先に書く。
    for (const { spec, upserts } of plans) {
      for (let i = 0; i < upserts.length; i += BATCH) {
        await request(cloud, `/rest/v1/${spec.table}?on_conflict=${spec.pk.join(",")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(upserts.slice(i, i + BATCH)),
        });
      }
    }
  }
  console.log(JSON.stringify(summary, null, 1));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
