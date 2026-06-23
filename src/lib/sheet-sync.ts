import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordFieldDef } from "@/types";

/**
 * TF構造スプレッドシート（部員別シート）と practice_records の双方向同期。
 * GASブリッジ（TF/gas/Code.gs を Web App 公開）を HTTP で叩く。
 * 詳細・マッピング: docs/SHEETS-SYNC-PLAN.md
 *
 * 見出し名ベースで突合する（中長距離＝低強度等の数値枠／短距離＝メニュー等の自由記述／
 * ユーザー追加のカスタム項目＝指定見出し）。その見出しがシートに在る項目だけ同期する。
 *
 * 競合は last-writer-wins:
 *   updated_at <= synced_at  → スプシ優先（アプリへ取込）
 *   updated_at >  synced_at / synced_at IS NULL → アプリ優先（スプシへ書き戻し）
 */

type RawMember = {
  name: string;
  gid?: string;
  header: string[];
  records: { date: string; cells: Record<string, string> }[];
};

export type SheetMember = { name: string; gid: string };

export type SyncResult = {
  pulled: number;
  pushed: number;
  skippedMembers: string[];
};

// ── アプリの組み込みフィールド ⇔ スプシ見出しのキーワード ───────────────────
type BuiltinKey =
  | "dist_low"
  | "dist_mid"
  | "dist_high"
  | "dist_speed"
  | "strides"
  | "strength_text"
  | "result_text"
  | "memo"
  | "menu_text"
  | "focus_text";

const BUILTINS: { key: BuiltinKey; keywords: string[]; numeric: boolean }[] = [
  { key: "dist_low", keywords: ["低強度"], numeric: true },
  { key: "dist_mid", keywords: ["中強度"], numeric: true },
  { key: "dist_high", keywords: ["高強度"], numeric: true },
  { key: "dist_speed", keywords: ["解糖系"], numeric: true },
  { key: "strides", keywords: ["流し"], numeric: true },
  { key: "strength_text", keywords: ["補強"], numeric: false },
  { key: "result_text", keywords: ["結果", "ペース", "タイム"], numeric: false },
  { key: "memo", keywords: ["感想", "コメント"], numeric: false },
  { key: "menu_text", keywords: ["メニュー"], numeric: false },
  { key: "focus_text", keywords: ["目的", "意識"], numeric: false },
];

const norm = (s: string) => (s ?? "").toString().replace(/\s+/g, "").trim();

/** GAS parseDistance の移植: 全角・(),＋ を処理して + や , で合算 */
function parseSheetNum(val: string | number | null | undefined): number {
  if (val == null || val === "") return 0;
  let s = val
    .toString()
    .trim()
    .replace(/[０-９．＋，、（）]/g, (c) => {
      if (c === "．") return ".";
      if (c === "＋") return "+";
      if (c === "，" || c === "、") return ",";
      if (c === "（") return "(";
      if (c === "）") return ")";
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
  while (s.indexOf("(") !== -1) {
    const a = s.indexOf("(");
    const b = s.indexOf(")", a);
    s = b !== -1 ? s.slice(0, a) + s.slice(b + 1) : s.slice(0, a);
  }
  return s.split(/[+,]/).reduce((sum, part) => {
    const n = parseFloat(part.trim().replace(/[^\d.]/g, ""));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
}

const txt = (v: string | null | undefined) => {
  const s = (v ?? "").toString().trim();
  return s.length > 0 ? s : null;
};

// ── 設定 / GAS 呼び出し ──────────────────────────────────────────────────────
function gasConfig() {
  const url = process.env.SHEET_SYNC_GAS_URL;
  const secret = process.env.SHEET_SYNC_SECRET ?? "";
  if (!url) throw new Error("SHEET_SYNC_GAS_URL is not configured");
  return { url, secret };
}

async function gasGet<T>(params: Record<string, string>): Promise<T> {
  const { url, secret } = gasConfig();
  const qs = new URLSearchParams({ ...params, secret });
  const res = await fetch(`${url}?${qs}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`GAS GET ${params.action} failed: ${res.status}`);
  const json = (await res.json()) as T & { error?: string };
  if (json && (json as { error?: string }).error) {
    throw new Error(`GAS error: ${(json as { error?: string }).error}`);
  }
  return json;
}

async function gasPost<T>(body: Record<string, unknown>): Promise<T> {
  const { url, secret } = gasConfig();
  const res = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, secret }),
  });
  if (!res.ok) throw new Error(`GAS POST failed: ${res.status}`);
  const json = (await res.json()) as T & { error?: string };
  if (json && (json as { error?: string }).error) {
    throw new Error(`GAS error: ${(json as { error?: string }).error}`);
  }
  return json;
}

/** プロフィール選択用：部員シート名一覧 */
export async function fetchSheetMembers(): Promise<SheetMember[]> {
  const data = await gasGet<{ members: SheetMember[] }>({ action: "listMembers" });
  return data.members ?? [];
}

async function fetchAllRaw(): Promise<RawMember[]> {
  const data = await gasGet<{ data: RawMember[] }>({ action: "fetchAllRaw" });
  return data.data ?? [];
}

// ── マッピング解決：このシートの見出しから「アプリ項目→実際の見出し名」を作る ──
type FieldMap = {
  builtin: Map<BuiltinKey, { header: string; numeric: boolean }>;
  custom: Map<string, { header: string; type: "text" | "number" }>; // key -> header
};

function resolveFieldMap(header: string[], fields: RecordFieldDef[]): FieldMap {
  const normHeaders = header.map((h) => ({ raw: h, n: norm(h) }));
  const builtin = new Map<BuiltinKey, { header: string; numeric: boolean }>();
  for (const b of BUILTINS) {
    const hit = normHeaders.find((h) => b.keywords.some((k) => h.n.includes(norm(k))));
    if (hit) builtin.set(b.key, { header: hit.raw, numeric: b.numeric });
  }
  const custom = new Map<string, { header: string; type: "text" | "number" }>();
  for (const f of fields) {
    if (!f.sheetColumn) continue;
    const target = norm(f.sheetColumn);
    const hit =
      normHeaders.find((h) => h.n === target) ??
      normHeaders.find((h) => h.n.includes(target));
    if (hit) custom.set(f.key, { header: hit.raw, type: f.type });
  }
  return { builtin, custom };
}

// ── 値の取り出し（アプリ側 / シート側）と比較 ────────────────────────────────
type DbRecord = {
  id: string;
  user_id: string;
  recorded_date: string;
  dist_low: number;
  dist_mid: number;
  dist_high: number;
  dist_speed: number;
  strides: number;
  strength_text: string | null;
  result_text: string | null;
  memo: string | null;
  menu_text: string | null;
  focus_text: string | null;
  custom: Record<string, string | number | null> | null;
  updated_at: string | null;
  synced_at: string | null;
};

function appBuiltin(rec: DbRecord, key: BuiltinKey): number | string | null {
  return (rec as unknown as Record<string, number | string | null>)[key] ?? null;
}

function appIsNewer(rec: DbRecord): boolean {
  if (!rec.synced_at) return true;
  if (!rec.updated_at) return false;
  return new Date(rec.updated_at).getTime() > new Date(rec.synced_at).getTime();
}

const numEq = (a: number, b: number) => Math.round(a * 10) / 10 === Math.round(b * 10) / 10;

/** マップされた項目だけ比較して、シートとアプリで差があるか */
function differs(map: FieldMap, cells: Record<string, string>, rec: DbRecord): boolean {
  for (const [key, m] of map.builtin) {
    const sheet = cells[m.header];
    if (m.numeric) {
      if (!numEq(parseSheetNum(sheet), Number(appBuiltin(rec, key)) || 0)) return true;
    } else {
      if ((txt(sheet) ?? "") !== (appBuiltin(rec, key) ?? "")) return true;
    }
  }
  for (const [key, m] of map.custom) {
    const sheet = cells[m.header];
    const app = rec.custom?.[key];
    if (m.type === "number") {
      if (!numEq(parseSheetNum(sheet), parseSheetNum(app as string))) return true;
    } else {
      if ((txt(sheet) ?? "") !== ((app ?? "").toString().trim())) return true;
    }
  }
  return false;
}

/** シートのセルから、アプリへ書き込む値（マップされた項目のみ）を作る */
function sheetToAppValues(map: FieldMap, cells: Record<string, string>) {
  const builtin: Record<string, number | string | null> = {};
  for (const [key, m] of map.builtin) {
    builtin[key] = m.numeric
      ? Math.round(parseSheetNum(cells[m.header]) * 10) / 10
      : txt(cells[m.header]);
  }
  const custom: Record<string, string | number | null> = {};
  for (const [key, m] of map.custom) {
    custom[key] =
      m.type === "number"
        ? Math.round(parseSheetNum(cells[m.header]) * 10) / 10
        : txt(cells[m.header]);
  }
  return { builtin, custom };
}

/** アプリのレコードから、スプシへ送る cells（見出し名→値、マップされた項目のみ）を作る */
function appToCells(map: FieldMap, rec: DbRecord): Record<string, string | number> {
  const cells: Record<string, string | number> = {};
  for (const [key, m] of map.builtin) {
    const v = appBuiltin(rec, key);
    cells[m.header] = m.numeric ? Number(v) || 0 : (v ?? "").toString();
  }
  for (const [key, m] of map.custom) {
    const v = rec.custom?.[key];
    cells[m.header] = m.type === "number" ? parseSheetNum(v as string) : (v ?? "").toString();
  }
  return cells;
}

// ── 同期本体 ─────────────────────────────────────────────────────────────────
export async function runSheetSync(admin: SupabaseClient): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, skippedMembers: [] };

  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields")
    .not("sheet_name", "is", null);
  if (pErr) throw pErr;

  const linked = (profiles ?? []).filter((p) => p.sheet_name) as {
    id: string;
    sheet_name: string;
    record_fields: RecordFieldDef[] | null;
  }[];
  if (linked.length === 0) return result;

  const sheetToProfile = new Map(linked.map((p) => [p.sheet_name.trim(), p]));

  const members = await fetchAllRaw();
  const memberByName = new Map(members.map((m) => [m.name.trim(), m]));

  const userIds = linked.map((p) => p.id);
  const { data: existing, error: rErr } = await admin
    .from("practice_records")
    .select(
      "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at",
    )
    .in("user_id", userIds);
  if (rErr) throw rErr;

  const byUser = new Map<string, Map<string, DbRecord>>();
  for (const uid of userIds) byUser.set(uid, new Map());
  for (const r of (existing ?? []) as DbRecord[]) {
    byUser.get(r.user_id)?.set(r.recorded_date, r);
  }

  const nowIso = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const pushes: { id: string; memberName: string; date: string; cells: Record<string, string | number> }[] = [];

  for (const [sheetName, profile] of sheetToProfile) {
    const member = memberByName.get(sheetName);
    if (!member) {
      result.skippedMembers.push(sheetName);
      continue;
    }
    const map = resolveFieldMap(member.header, profile.record_fields ?? []);
    const appRecs = byUser.get(profile.id)!;
    const seen = new Set<string>();

    for (const sr of member.records) {
      if (!sr.date) continue;
      seen.add(sr.date);
      const app = appRecs.get(sr.date);
      if (!app) {
        const { builtin, custom } = sheetToAppValues(map, sr.cells);
        inserts.push({
          user_id: profile.id,
          recorded_date: sr.date,
          synced_at: nowIso,
          updated_at: nowIso,
          custom,
          ...builtin,
        });
        result.pulled++;
        continue;
      }
      if (!differs(map, sr.cells, app)) continue;
      if (appIsNewer(app)) {
        pushes.push({ id: app.id, memberName: sheetName, date: sr.date, cells: appToCells(map, app) });
      } else {
        const { builtin, custom } = sheetToAppValues(map, sr.cells);
        updates.push({
          id: app.id,
          patch: { ...builtin, custom: { ...(app.custom ?? {}), ...custom }, synced_at: nowIso },
        });
        result.pulled++;
      }
    }

    // アプリにあってシートに無い日付 → アプリで作られた記録なら書き戻し
    for (const [date, app] of appRecs) {
      if (seen.has(date)) continue;
      if (appIsNewer(app)) {
        pushes.push({ id: app.id, memberName: sheetName, date, cells: appToCells(map, app) });
      }
    }
  }

  if (inserts.length > 0) {
    const { error } = await admin.from("practice_records").insert(inserts);
    if (error) throw error;
  }
  for (const u of updates) {
    const { error } = await admin.from("practice_records").update(u.patch).eq("id", u.id);
    if (error) throw error;
  }
  for (const p of pushes) {
    await gasPost({ action: "writeCells", memberName: p.memberName, date: p.date, cells: p.cells });
    const { error } = await admin
      .from("practice_records")
      .update({ synced_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) throw error;
    result.pushed++;
  }

  return result;
}
