// PCのDB → クラウドSupabase への写し（PCが止まったときの予備構成。2026-09-26 オーナー確定）。
//
// - 表示に必要な小さな表（部員・ロール・予定・お知らせなど）は全部写す。
// - 投稿（練習記録・つぶやき・コメント・いいね）と出欠は直近 WINDOW_DAYS 日分だけ写し、それより古いものはクラウドから消す。
// - PCで消えた行はクラウドからも消す。変わっていない行は書かない。
// - クラウドへの書き込みにはヘッダー x-tuat-mirror: 1 を付ける（通知・プッシュなどのトリガーが動かないように。
//   migration 20260926030000）。
// - 追加の npm パッケージに頼らない（node_modules が消えても動くように）。
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
  const list = async (side) => {
    const users = [];
    for (let page = 1; ; page++) {
      const body = await (await request(side, `/auth/v1/admin/users?page=${page}&per_page=1000`)).json();
      users.push(...(body.users ?? []));
      if ((body.users ?? []).length < 1000) return users;
    }
  };
  const [pcUsers, cloudUsers] = await Promise.all([list(pc), list(cloud)]);
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

async function main() {
  const apply = process.argv.includes("--apply");
  const summary = { apply, windowStartDate, authUsersCreated: await syncAuthUsers(apply), tables: {} };
  const ctx = { ids: {}, recentScheduleIds: [] };
  const plans = [];

  for (const spec of TABLES) {
    const filter = typeof spec.filter === "function" ? spec.filter(ctx) : undefined;
    const pcRows = await readFiltered(pc, spec, filter);
    const cloudRows = await readAll(cloud, spec.table, spec.pk);
    const key = keyOf(spec.pk);
    const pcByKey = new Map(pcRows.map((r) => [key(r), r]));
    const cloudByKey = new Map(cloudRows.map((r) => [key(r), r]));
    const upserts = pcRows.filter((r) => {
      const current = cloudByKey.get(key(r));
      return !current || comparable(current) !== comparable(r);
    });
    const deletes = cloudRows.filter((r) => !pcByKey.has(key(r)));
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
