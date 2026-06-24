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

export type SyncOptions = { dryRun?: boolean; onlySheet?: string };

export type SyncResult = {
  inserted: number; // スプシ→アプリ 新規取込
  updated: number; // スプシ→アプリ 更新取込
  pushed: number; // アプリ→スプシ 書き戻し
  conflicts: string[]; // 同日に複数記録があり安全のためスキップした "シート名 日付"
  skippedMembers: string[];
  dryRun: boolean;
};

// これ以前の日付・未来日・空の行は同期しない（事故対策）
const SYNC_CUTOFF = "2026-06-22";
function todayJST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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
  return readGasJson<T>(res);
}

async function gasPost<T>(body: Record<string, unknown>): Promise<T> {
  const { url, secret } = gasConfig();
  const res = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, secret }),
  });
  return readGasJson<T>(res);
}

// GAS はエラー時に HTML ページ(<!DOCTYPE...)を返すことがある。JSONで読めない時は分かりやすく案内。
async function readGasJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: T & { error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      "スプレッドシート連携(GAS)に接続できません。GASの公開設定を確認してください（アクセス=全員／新バージョンでデプロイ／プロジェクトは sync-api のみ）。",
    );
  }
  if (json && json.error) throw new Error(`GASエラー: ${json.error}`);
  return json;
}

/** アプリのコメントを、その人のスプシ当日行の右側（列名なし列）にリプライとして書く */
export async function writeSheetReply(
  memberName: string,
  date: string,
  text: string,
): Promise<void> {
  await gasPost({ action: "writeReply", memberName, date, text });
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

/** マップされた値がすべて空か（数値0・テキストnull） */
function valuesEmpty(
  builtin: Record<string, number | string | null>,
  custom: Record<string, string | number | null>,
): boolean {
  for (const v of Object.values(builtin)) {
    if (typeof v === "number" ? v !== 0 : (v ?? "").toString().trim() !== "") return false;
  }
  for (const v of Object.values(custom)) {
    if ((v ?? "").toString().trim() !== "") return false;
  }
  return true;
}

/** アプリのレコードから、スプシへ送る cells（**中身のある項目だけ**。空でシートを潰さない） */
function appToCellsNonEmpty(map: FieldMap, rec: DbRecord): Record<string, string | number> {
  const cells: Record<string, string | number> = {};
  for (const [key, m] of map.builtin) {
    const v = appBuiltin(rec, key);
    if (m.numeric) {
      if (Number(v) > 0) cells[m.header] = Number(v);
    } else if ((v ?? "").toString().trim() !== "") {
      cells[m.header] = (v as string).toString();
    }
  }
  for (const [key, m] of map.custom) {
    const v = rec.custom?.[key];
    if ((v ?? "").toString().trim() === "") continue;
    cells[m.header] = m.type === "number" ? parseSheetNum(v as string) : v!.toString();
  }
  return cells;
}

// ── 同期本体 ─────────────────────────────────────────────────────────────────
// 安全方針(docs/SHEETS-SYNC-PLAN.md・事故対策):
//  - カットオフ(2026-06-22)以前・未来日・空の行は同期しない
//  - 非破壊: シートが空の項目でアプリを空にしない／空のアプリ値でシートを潰さない
//  - 同日に複数記録がある日付は曖昧なのでスキップ（conflictとして報告）
//  - dryRun で「何が起きるか」だけ確認できる
export async function runSheetSync(
  admin: SupabaseClient,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const dryRun = !!options.dryRun;
  const result: SyncResult = {
    inserted: 0,
    updated: 0,
    pushed: 0,
    conflicts: [],
    skippedMembers: [],
    dryRun,
  };
  const today = todayJST();
  const inRange = (d: string) => d >= SYNC_CUTOFF && d <= today;

  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields")
    .not("sheet_name", "is", null);
  if (pErr) throw pErr;

  let linked = (profiles ?? []).filter((p) => p.sheet_name) as {
    id: string;
    sheet_name: string;
    record_fields: RecordFieldDef[] | null;
  }[];
  if (options.onlySheet) {
    linked = linked.filter((p) => p.sheet_name.trim() === options.onlySheet!.trim());
  }
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

  // user_id -> date -> 記録の配列（複数/日を検出するため配列で持つ）
  const byUser = new Map<string, Map<string, DbRecord[]>>();
  for (const uid of userIds) byUser.set(uid, new Map());
  for (const r of (existing ?? []) as DbRecord[]) {
    const m = byUser.get(r.user_id)!;
    const arr = m.get(r.recorded_date) ?? [];
    arr.push(r);
    m.set(r.recorded_date, arr);
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
    const appByDate = byUser.get(profile.id)!;
    const seen = new Set<string>();

    for (const sr of member.records) {
      if (!sr.date || !inRange(sr.date)) continue; // カットオフ前・未来日は無視
      seen.add(sr.date);

      const appList = appByDate.get(sr.date) ?? [];
      if (appList.length > 1) {
        result.conflicts.push(`${sheetName} ${sr.date}`); // 複数/日は触らない
        continue;
      }
      const { builtin, custom } = sheetToAppValues(map, sr.cells);
      const sheetEmpty = valuesEmpty(builtin, custom);
      const app = appList[0];

      if (!app) {
        if (sheetEmpty) continue; // 空の行は取り込まない
        inserts.push({
          user_id: profile.id,
          recorded_date: sr.date,
          synced_at: nowIso,
          updated_at: nowIso,
          from_sheet: true, // シート由来＝タイムラインには出さない
          custom,
          ...builtin,
        });
        result.inserted++;
        continue;
      }

      if (appIsNewer(app)) {
        // アプリ優先: 中身のある項目だけ書き戻し（差分があれば）
        const cells = appToCellsNonEmpty(map, app);
        if (Object.keys(cells).length > 0 && differs(map, sr.cells, app)) {
          pushes.push({ id: app.id, memberName: sheetName, date: sr.date, cells });
        }
      } else {
        // スプシ優先: **空でない**シート項目だけ取り込む（アプリを空にしない）
        const patch: Record<string, unknown> = {};
        for (const [key, m] of map.builtin) {
          const v = builtin[key];
          const nonEmpty = m.numeric ? Number(v) > 0 : (v ?? "").toString().trim() !== "";
          if (nonEmpty && v !== appBuiltin(app, key as BuiltinKey)) patch[key] = v;
        }
        const customPatch: Record<string, string | number | null> = { ...(app.custom ?? {}) };
        let customChanged = false;
        for (const [key] of map.custom) {
          const v = custom[key];
          if ((v ?? "").toString().trim() !== "" && v !== (app.custom?.[key] ?? null)) {
            customPatch[key] = v;
            customChanged = true;
          }
        }
        if (Object.keys(patch).length > 0 || customChanged) {
          if (customChanged) patch.custom = customPatch;
          patch.synced_at = nowIso;
          updates.push({ id: app.id, patch });
          result.updated++;
        }
      }
    }

    // シートに行が無い日付で、アプリに中身がある記録 → 書き戻し（1件/日のみ）
    for (const [date, list] of appByDate) {
      if (seen.has(date) || !inRange(date) || list.length !== 1) continue;
      const app = list[0];
      if (!appIsNewer(app)) continue;
      const cells = appToCellsNonEmpty(map, app);
      if (Object.keys(cells).length > 0) {
        pushes.push({ id: app.id, memberName: sheetName, date, cells });
      }
    }
  }

  if (dryRun) {
    result.inserted = inserts.length;
    result.updated = updates.length;
    result.pushed = pushes.length;
    return result;
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
