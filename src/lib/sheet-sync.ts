import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordFieldDef } from "@/types";
import { customRecordFields } from "@/lib/record-fields";
import { importedSheetReplies, normalizeSheetReplyText, type RawSheetReply } from "@/lib/sheet-replies";

/**
 * TF構造スプレッドシート（部員別シート）と practice_records の同期。
 * GASブリッジ（TF/gas/Code.gs を Web App 公開）を HTTP で叩く。
 * 詳細・マッピング: docs/SHEETS-SYNC-PLAN.md
 *
 * 見出し名ベースで突合する（中長距離＝低強度等の数値枠／短距離＝メニュー等の自由記述／
 * ユーザー追加のカスタム項目＝アプリ上の項目名）。項目名とシート列名が一致する項目だけ同期する。
 *
 * 同期方向は部員ごとに固定（profiles.record_source）:
 *   'sheet' → pullのみ（シート→アプリ）。シートを正とするが、**空でないシート項目だけ**取り込む
 *             （シートの空欄でアプリの既存内容を消さない。非破壊）。
 *             シートに行が無い日は触らない（安全側）。アプリ→シートの書き戻しはしない。
 *   'app'   → pushのみ（アプリ→シート）。マップ済みセルはアプリの内容で常に上書きする（シート＝写し）。
 *             シート→アプリの取込はしない。
 */

type RawMember = {
  name: string;
  gid?: string;
  header: string[];
  records: { date: string; cells: Record<string, string>; replies?: RawSheetReply[] }[];
};

export type SheetMember = { name: string; gid: string };

export type SyncOptions = {
  dryRun?: boolean;
  onlySheet?: string;
  onlySheets?: string[];
};

export type SyncResult = {
  inserted: number; // スプシ→アプリ 新規取込
  updated: number; // スプシ→アプリ 更新取込
  pushed: number; // アプリ→スプシ 書き戻し
  conflicts: string[]; // 同日に複数記録があり安全のためスキップした "シート名 日付"
  skippedMembers: string[];
  /** 部員ごとの失敗（1人の不調で他の部員の同期を止めないための部分失敗設計） */
  failedMembers: { member: string; reason: string }[];
  sheetReplies: number;
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

/**
 * Sheet-imported records use the practice date, never the time they were imported.
 * Otherwise, importing old records incorrectly moves them to the top of the timeline.
 */
export function sheetRecordCreatedAt(recordedDate: string): string {
  return recordedDate + "T00:00:00+09:00";
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

const BUILTINS: { key: BuiltinKey; keywords: string[]; numeric: boolean; integer?: boolean }[] = [
  { key: "dist_low", keywords: ["低強度"], numeric: true },
  { key: "dist_mid", keywords: ["中強度"], numeric: true },
  { key: "dist_high", keywords: ["高強度"], numeric: true },
  { key: "dist_speed", keywords: ["解糖系"], numeric: true },
  // strides はDBがINT型。シートに小数（例: 0.3）が入っていても丸めて取り込み、
  // insert全体を巻き込んで失敗させない（2026-07-09〜12、この型不一致で毎時同期の
  // 新規取込が3日間全滅した実例あり）。
  { key: "strides", keywords: ["流し"], numeric: true, integer: true },
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

async function gasGet<T>(
  params: Record<string, string>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, secret } = gasConfig();
  const controller = opts.timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ ...params, secret }),
      signal: controller?.signal,
    });
    return await readGasJson<T>(res);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function gasPost<T>(body: Record<string, unknown>): Promise<T> {
  const { url, secret } = gasConfig();
  const res = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json;charset=utf-8" },
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
  sourceId?: string,
): Promise<void> {
  await gasPost({ action: "writeReply", memberName, date, text, sourceId });
}

/** プロフィール選択用：部員シート名一覧 */
export async function fetchSheetMembers(): Promise<SheetMember[]> {
  const data = await gasGet<{ members: SheetMember[] }>({ action: "listMembers" });
  return data.members ?? [];
}

type ProtectedFetchResult = {
  members: RawMember[];
  failedMembers: { member: string; reason: string }[];
};

/**
 * GAS の secret 保護された fetchMember を少数並列で呼ぶ。
 * 公開 CSV export はシート自体のリンク共有を必要とするため使用しない。
 * 1回のGAS実行で全タブを直列走査する方式も避け、Vercelの60秒制限内に収める。
 */
async function fetchAllRaw(memberNames: string[]): Promise<ProtectedFetchResult> {
  const wanted = new Set(memberNames.map((name) => name.trim()));
  const sheetMembers = (await fetchSheetMembers()).filter((member) => wanted.has(member.name.trim()));
  const members: RawMember[] = [];
  const failedMembers: { member: string; reason: string }[] = [];
  const configuredConcurrency = Number.parseInt(process.env.SHEET_SYNC_CONCURRENCY ?? "8", 10);
  const concurrency = Number.isFinite(configuredConcurrency)
    ? Math.min(12, Math.max(1, configuredConcurrency))
    : 8;

  for (let index = 0; index < sheetMembers.length; index += concurrency) {
    const batch = sheetMembers.slice(index, index + concurrency);
    const fetched = await Promise.allSettled(
      batch.map(async (member) => {
        const data = await gasGet<{ data: RawMember }>(
          { action: "fetchMember", memberName: member.name },
          { timeoutMs: 20_000 },
        );
        if (!data.data) throw new Error("GASからデータが返りませんでした");
        return data.data;
      }),
    );
    fetched.forEach((item, batchIndex) => {
      if (item.status === "fulfilled") {
        members.push(item.value);
      } else {
        failedMembers.push({
          member: batch[batchIndex].name,
          reason: item.reason instanceof Error ? item.reason.message : "GASから取得できませんでした",
        });
      }
    });
  }

  if (sheetMembers.length > 0 && members.length === 0 && failedMembers.length > 0) {
    throw new Error(`全ての部員シート取得に失敗しました（${failedMembers.length}件）`);
  }
  return {
    members: members.sort((a, b) => a.name.localeCompare(b.name)),
    failedMembers,
  };
}

/** 部員1人だけを軽量取得（write-through保存直後の確認・個人の記録画面用） */
async function fetchMemberRaw(
  memberName: string,
  opts: { timeoutMs?: number } = {},
): Promise<RawMember> {
  const data = await gasGet<{ data: RawMember }>({ action: "fetchMember", memberName }, opts);
  if (!data.data) throw new Error("GASからデータが返りませんでした");
  return data.data;
}

// ── マッピング解決：このシートの見出しから「アプリ項目→実際の見出し名」を作る ──
type FieldMap = {
  builtin: Map<BuiltinKey, { header: string; numeric: boolean; integer?: boolean }>;
  custom: Map<string, { header: string; type: "text" | "number" }>; // key -> header
};

function resolveFieldMap(header: string[], fields: RecordFieldDef[]): FieldMap {
  const normHeaders = header.map((item) => ({ raw: item, n: norm(item) }));
  const builtin = new Map<BuiltinKey, { header: string; numeric: boolean; integer?: boolean }>();
  const usedHeaders = new Set<string>();

  // 名前変更した既定項目を最優先で完全一致させる。
  for (const item of BUILTINS) {
    const configured = fields.find((field) => field.key === item.key);
    if (configured?.hidden) continue;
    const configuredLabel = configured?.label.trim();
    if (!configuredLabel) continue;
    const hit = normHeaders.find((candidate) => candidate.n === norm(configuredLabel) && !usedHeaders.has(candidate.raw));
    if (!hit) continue;
    builtin.set(item.key, { header: hit.raw, numeric: item.numeric, integer: item.integer });
    usedHeaders.add(hit.raw);
  }

  // 未設定・旧設定は従来キーワードへフォールバックする。同じ列を複数項目へ割り当てない。
  for (const item of BUILTINS) {
    if (builtin.has(item.key) || fields.find((field) => field.key === item.key)?.hidden) continue;
    const hit = normHeaders.find((candidate) => !usedHeaders.has(candidate.raw) && item.keywords.some((keyword) => candidate.n.includes(norm(keyword))));
    if (!hit) continue;
    builtin.set(item.key, { header: hit.raw, numeric: item.numeric, integer: item.integer });
    usedHeaders.add(hit.raw);
  }

  const custom = new Map<string, { header: string; type: "text" | "number" }>();
  for (const field of customRecordFields(fields)) {
    const target = field.label.trim();
    if (!target) continue;
    const hit = normHeaders.find((candidate) => candidate.raw.trim() === target && !usedHeaders.has(candidate.raw));
    if (!hit) continue;
    custom.set(field.key, { header: hit.raw, type: field.type });
    usedHeaders.add(hit.raw);
  }
  return { builtin, custom };
}
// ── 値の取り出し（アプリ側 / シート側）と比較 ────────────────────────────────
export type DbRecord = {
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
  /** write-through(保存直後のスプシ反映)が失敗し、毎時同期での再送が必要な状態か */
  pending_sheet_push?: boolean;
};

function appBuiltin(rec: DbRecord, key: BuiltinKey): number | string | null {
  return rec[key] ?? null;
}

function appIsNewer(rec: DbRecord): boolean {
  if (!rec.synced_at) return true;
  if (!rec.updated_at) return false;
  return new Date(rec.updated_at).getTime() > new Date(rec.synced_at).getTime();
}

/** シートのセルから、アプリへ書き込む値（マップされた項目のみ）を作る */
function sheetToAppValues(map: FieldMap, cells: Record<string, string>) {
  const builtin: Record<string, number | string | null> = {};
  for (const [key, m] of map.builtin) {
    builtin[key] = m.numeric
      ? m.integer
        ? Math.round(parseSheetNum(cells[m.header]))
        : Math.round(parseSheetNum(cells[m.header]) * 10) / 10
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

/** アプリのレコードから、スプシへ送る cells（マップされた項目を全て。シート＝アプリの写しにする） */
function appToCellsFull(map: FieldMap, rec: DbRecord): Record<string, string | number> {
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

const BUILTIN_LABELS: Record<BuiltinKey, string> = {
  dist_low: "低強度",
  dist_mid: "中強度",
  dist_high: "高強度",
  dist_speed: "解糖系",
  strides: "流し",
  strength_text: "補強",
  result_text: "結果",
  memo: "感想",
  menu_text: "メニュー",
  focus_text: "目的・意識すること",
};

export type PushRecordResult = {
  /** シートにその項目の列が無い等で書き込めなかった項目（アプリ側の表示ラベル）。黙って落とさず可視化するため */
  unmapped: string[];
  action: "created" | "updated";
};

/**
 * write-through: アプリで保存した1件をその場でスプシへ書き込む（タスク16）。
 * 非破壊（appToCellsNonEmptyを使用。空項目でシートの既存セルを消さない）。
 * シートに列が無い項目は書き込まず unmapped に集めて呼び出し側へ返す（黙って落とさない）。
 */
export async function pushRecordToSheet(
  sheetName: string,
  recordFields: RecordFieldDef[],
  rec: DbRecord,
): Promise<PushRecordResult> {
  const member = await fetchMemberRaw(sheetName);
  const map = resolveFieldMap(member.header, recordFields);
  const cells = appToCellsNonEmpty(map, rec);

  // シートに列自体が無く、送信すらされなかった項目（可視化用）
  const unmapped: string[] = [];
  for (const b of BUILTINS) {
    if (map.builtin.has(b.key) || recordFields.find((field) => field.key === b.key)?.hidden) continue;
    const v = appBuiltin(rec, b.key);
    const nonEmpty = b.numeric ? Number(v) > 0 : (v ?? "").toString().trim() !== "";
    if (nonEmpty) unmapped.push(recordFields.find((field) => field.key === b.key)?.label.trim() || BUILTIN_LABELS[b.key]);
  }
  for (const f of customRecordFields(recordFields)) {
    if (map.custom.has(f.key)) continue;
    const v = rec.custom?.[f.key];
    if ((v ?? "").toString().trim() !== "") unmapped.push(f.label);
  }

  if (Object.keys(cells).length === 0) {
    return { unmapped, action: "updated" };
  }

  const res = await gasPost<{
    success: boolean;
    action: "created" | "updated";
    unmapped?: string[];
  }>({
    action: "writeCells",
    memberName: sheetName,
    date: rec.recorded_date,
    cells,
  });

  // GAS側でも書けなかった見出しがあれば統合（マッピング取得後にシート列が変わった等のズレ対策）
  if (res.unmapped && res.unmapped.length > 0) unmapped.push(...res.unmapped);
  return { unmapped, action: res.action };
}

export type ReconcileResult = {
  direction: "to_sheet" | "to_app";
  pushed: number;
  pulled: number;
  skipped: string[]; // "日付" 単位でスキップした理由
  dryRun: boolean;
};

/**
 * 入力元(record_source)を切り替える直前に、その部員だけを対象に一度だけ
 * 両側を揃える（オーナー確定 2026-07-04・2026-07-03インシデントの再発防止）。
 *   to_sheet（app→sheet切替）: アプリの中身のある項目をシートへ書き出す（アプリが正＝勝つ）。
 *   to_app（sheet→app切替）: シートの中身のある項目をアプリへ取り込む（シートが正＝勝つ）。
 * いずれも非破壊（空で相手を消さない）。同日複数記録など曖昧な日はスキップして報告する。
 */
export async function reconcileOnSwitch(
  admin: SupabaseClient,
  profileId: string,
  direction: "to_sheet" | "to_app",
  options: { dryRun?: boolean } = {},
): Promise<ReconcileResult> {
  const dryRun = !!options.dryRun;
  const result: ReconcileResult = { direction, pushed: 0, pulled: 0, skipped: [], dryRun };
  const today = todayJST();

  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields")
    .eq("id", profileId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile?.sheet_name) return result; // 連携していなければ何もしない

  let member: RawMember;
  try {
    member = await fetchMemberRaw(profile.sheet_name);
  } catch {
    result.skipped.push(`シート「${profile.sheet_name}」が見つかりません`);
    return result;
  }
  const map = resolveFieldMap(member.header, (profile.record_fields as RecordFieldDef[]) ?? []);

  const { data: existing, error: rErr } = await admin
    .from("practice_records")
    .select(
      "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at, pending_sheet_push",
    )
    .eq("user_id", profileId)
    .gte("recorded_date", SYNC_CUTOFF);
  if (rErr) throw rErr;

  const byDate = new Map<string, DbRecord[]>();
  for (const r of (existing ?? []) as DbRecord[]) {
    const arr = byDate.get(r.recorded_date) ?? [];
    arr.push(r);
    byDate.set(r.recorded_date, arr);
  }

  const nowIso = new Date().toISOString();

  if (direction === "to_sheet") {
    // アプリが正: 中身のある項目だけシートへ書き出す
    for (const [date, list] of byDate) {
      if (date > today) continue;
      if (list.length > 1) {
        result.skipped.push(`${date}（同日に複数記録）`);
        continue;
      }
      const cells = appToCellsNonEmpty(map, list[0]);
      if (Object.keys(cells).length === 0) continue;
      result.pushed++;
      if (!dryRun) {
        await gasPost({ action: "writeCells", memberName: profile.sheet_name, date, cells });
        await admin
          .from("practice_records")
          .update({ synced_at: nowIso })
          .eq("id", list[0].id);
      }
    }
  } else {
    // シートが正: 中身のある項目だけアプリへ取り込む
    for (const sr of member.records) {
      if (!sr.date || sr.date < SYNC_CUTOFF || sr.date > today) continue;
      const appList = byDate.get(sr.date) ?? [];
      if (appList.length > 1) {
        result.skipped.push(`${sr.date}（同日に複数記録）`);
        continue;
      }
      const { builtin, custom } = sheetToAppValues(map, sr.cells);
      if (valuesEmpty(builtin, custom)) continue;
      const app = appList[0];

      if (!app) {
        result.pulled++;
        if (!dryRun) {
          const { error } = await admin.from("practice_records").insert({
            user_id: profileId,
            recorded_date: sr.date,
            created_at: sheetRecordCreatedAt(sr.date),
            synced_at: nowIso,
            updated_at: nowIso,
            from_sheet: true,
            custom,
            ...builtin,
          });
          if (error) throw error;
        }
        continue;
      }

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
        result.pulled++;
        if (!dryRun) {
          if (customChanged) patch.custom = customPatch;
          patch.synced_at = nowIso;
          const { error } = await admin.from("practice_records").update(patch).eq("id", app.id);
          if (error) throw error;
        }
      }
    }
  }

  return result;
}

type MemberPullComputation = {
  inserts: Record<string, unknown>[];
  updates: { id: string; patch: Record<string, unknown> }[];
  /** 同日に複数記録がある曖昧な日付（呼び出し側でシート名等を付与して報告する） */
  conflicts: string[];
};

/**
 * 1部員分の「シート→アプリ」非破壊pullを計算する（runSheetSyncのpull-onlyブランチと
 * refreshMemberFromSheetLive の共通ロジック）。副作用なし（DB書き込みは呼び出し側が行う）。
 */
function computeMemberPull(
  profileId: string,
  map: FieldMap,
  sheetRecords: RawMember["records"],
  appByDate: Map<string, DbRecord[]>,
  inRangeForProfile: (date: string) => boolean,
  nowIso: string,
): MemberPullComputation {
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const conflicts: string[] = [];

  for (const sr of sheetRecords) {
    if (!sr.date || !inRangeForProfile(sr.date)) continue; // カットオフ前・未来日は無視

    const appList = appByDate.get(sr.date) ?? [];
    if (appList.length > 1) {
      conflicts.push(sr.date); // 複数/日は触らない
      continue;
    }
    const { builtin, custom } = sheetToAppValues(map, sr.cells);
    const app = appList[0];

    if (!app) {
      if (valuesEmpty(builtin, custom)) continue; // 空の行は新規に取り込まない
      inserts.push({
        user_id: profileId,
        recorded_date: sr.date,
        // タイムラインでは「練習日の0時(JST)に投稿された」扱いで並べる
        // (オーナー確定 2026-07-12。取込時刻だとまとめ取込のたびに先頭で団子になる)
        created_at: sheetRecordCreatedAt(sr.date),
        synced_at: nowIso,
        updated_at: nowIso,
        from_sheet: true,
        custom,
        ...builtin,
      });
      continue;
    }

    // 既存行はシートが正。ただし**空でないシート項目だけ**取り込む
    // （シートの空欄でアプリに直接入力された内容を消さないため。実際に
    // シートの空欄で既存の記録内容が消える事故が発生したため非破壊に戻した）。
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
    }
  }

  return { inserts, updates, conflicts };
}

type ReplySyncProfile = {
  id: string;
  sheet_name: string;
};

async function reconcileSheetReplies(
  supabase: SupabaseClient,
  profiles: ReplySyncProfile[],
  members: RawMember[],
  fromDate: string,
  throughDate: string,
): Promise<{
  synced: number;
  failedMembers: { member: string; reason: string }[];
}> {
  const memberByName = new Map(members.map((member) => [member.name.trim(), member]));
  const supportedProfiles = profiles.filter((profile) => {
    const member = memberByName.get(profile.sheet_name.trim());
    return member?.records.some((record) => Array.isArray(record.replies)) === true;
  });
  if (supportedProfiles.length === 0) return { synced: 0, failedMembers: [] };

  const profileIds = supportedProfiles.map((profile) => profile.id);
  const { data: records, error: recordError } = await supabase
    .from("practice_records")
    .select("id, user_id, recorded_date")
    .in("user_id", profileIds)
    .gte("recorded_date", fromDate)
    .lte("recorded_date", throughDate);
  if (recordError) throw recordError;

  const recordsByOwnerDate = new Map<string, { id: string }[]>();
  for (const record of records ?? []) {
    const key = record.user_id + ":" + record.recorded_date;
    const rows = recordsByOwnerDate.get(key) ?? [];
    rows.push({ id: record.id });
    recordsByOwnerDate.set(key, rows);
  }

  const rawRepliesByRecord = new Map<string, RawSheetReply[]>();
  const sheetNameByRecord = new Map<string, string>();
  for (const profile of supportedProfiles) {
    const member = memberByName.get(profile.sheet_name.trim());
    if (!member) continue;
    for (const sheetRecord of member.records) {
      if (sheetRecord.date < fromDate || sheetRecord.date > throughDate) continue;
      const matching = recordsByOwnerDate.get(profile.id + ":" + sheetRecord.date) ?? [];
      if (matching.length !== 1) continue;
      rawRepliesByRecord.set(matching[0].id, sheetRecord.replies ?? []);
      sheetNameByRecord.set(matching[0].id, profile.sheet_name);
    }
  }

  const { data: existingReplies, error: existingError } = await supabase
    .from("sheet_record_replies")
    .select("record_id")
    .in("owner_id", profileIds)
    .gte("recorded_date", fromDate)
    .lte("recorded_date", throughDate);
  if (existingError) throw existingError;

  const targetIds = new Set(rawRepliesByRecord.keys());
  for (const reply of existingReplies ?? []) targetIds.add(reply.record_id);
  if (targetIds.size === 0) return { synced: 0, failedMembers: [] };

  const { data: appComments, error: commentError } = await supabase
    .from("comments")
    .select("target_id, content, author:profiles!user_id(display_name)")
    .eq("target_type", "record")
    .in("target_id", [...targetIds]);
  if (commentError) throw commentError;

  const exportedByRecord = new Map<string, Set<string>>();
  for (const comment of appComments ?? []) {
    const author = Array.isArray(comment.author) ? comment.author[0] : comment.author;
    const displayName = author?.display_name?.trim() ?? "";
    if (!displayName) continue;
    const values = exportedByRecord.get(comment.target_id) ?? new Set<string>();
    values.add(normalizeSheetReplyText(comment.content + "　" + displayName));
    exportedByRecord.set(comment.target_id, values);
  }

  let synced = 0;
  const failedMembers: { member: string; reason: string }[] = [];
  for (const recordId of targetIds) {
    const rows = importedSheetReplies(
      rawRepliesByRecord.get(recordId) ?? [],
      exportedByRecord.get(recordId) ?? [],
    );
    const { error } = await supabase.rpc("replace_sheet_record_replies", {
      target_record_id: recordId,
      reply_rows: rows,
    });
    if (error) {
      failedMembers.push({
        member: sheetNameByRecord.get(recordId) ?? "(スプシ返信)",
        reason: "返信の同期: " + error.message,
      });
    } else {
      synced += rows.length;
    }
  }

  return { synced, failedMembers };
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
    failedMembers: [],
    sheetReplies: 0,
    dryRun,
  };
  const today = todayJST();
  const inRange = (d: string) => d >= SYNC_CUTOFF && d <= today;

  const { data: profiles, error: pErr } = await admin
    .from("profiles")
    .select("id, sheet_name, record_fields, record_source, sheet_linked_at")
    .not("sheet_name", "is", null);
  if (pErr) throw pErr;

  let linked = (profiles ?? []).filter((p) => p.sheet_name) as {
    id: string;
    sheet_name: string;
    record_fields: RecordFieldDef[] | null;
    record_source: "app" | "sheet";
    sheet_linked_at: string | null;
  }[];
  if (options.onlySheet) {
    linked = linked.filter((p) => p.sheet_name.trim() === options.onlySheet!.trim());
  }
  if (options.onlySheets) {
    const allowed = new Set(options.onlySheets.map((name) => name.trim()));
    linked = linked.filter((profile) => allowed.has(profile.sheet_name.trim()));
  }
  if (linked.length === 0) return result;

  const sheetToProfile = new Map(linked.map((p) => [p.sheet_name.trim(), p]));
  const nameById = new Map(linked.map((p) => [p.id, p.sheet_name.trim()]));
  const fetched = await fetchAllRaw(linked.map((profile) => profile.sheet_name));
  result.failedMembers.push(...fetched.failedMembers);
  const members = fetched.members;
  const memberByName = new Map(members.map((m) => [m.name.trim(), m]));

  const userIds = linked.map((p) => p.id);
  const { data: existing, error: rErr } = await admin
    .from("practice_records")
    .select(
      "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at, pending_sheet_push",
    )
    .in("user_id", userIds)
    .gte("recorded_date", SYNC_CUTOFF);
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
  const pushes: {
    id: string;
    memberName: string;
    date: string;
    cells: Record<string, string | number>;
    /** write-through再送分か（成功時にpending_sheet_pushをfalseへ戻す対象） */
    clearsPending?: boolean;
  }[] = [];

  for (const [sheetName, profile] of sheetToProfile) {
    const member = memberByName.get(sheetName);
    if (!member) {
      result.skippedMembers.push(sheetName);
      continue;
    }
    const map = resolveFieldMap(member.header, profile.record_fields ?? []);
    const appByDate = byUser.get(profile.id)!;

    if (profile.record_source === "sheet") {
      // write-through保存がGAS側の一時失敗等で未反映のまま残っている記録があれば、
      // pullで（古いシート値により）巻き戻される前に非破壊で再送する（タスク16の安全網）。
      // 判定は専用フラグ pending_sheet_push のみを見る（updated_at/synced_atの大小比較=appIsNewer
      // は使わない。write-through導入前からの無関係な時刻ズレまで再送対象と誤検知し、
      // 部員がスプシへ直接入力した内容を古いアプリ値で上書きしかねないことがdry-runで判明したため）。
      for (const [date, list] of appByDate) {
        if (!inRange(date) || list.length !== 1) continue;
        const app = list[0];
        if (!app.pending_sheet_push) continue;
        const cells = appToCellsNonEmpty(map, app);
        if (Object.keys(cells).length > 0) {
          pushes.push({ id: app.id, memberName: sheetName, date, cells, clearsPending: true });
        }
      }

      // pullのみ: シートを正としてアプリへ反映。シートに行が無い日は触らない。
      // 新規に連携した部員は連携日より前の履歴を一気に取り込まない（sheet_linked_atが個別カットオフ）。
      const cutoff =
        profile.sheet_linked_at && profile.sheet_linked_at > SYNC_CUTOFF
          ? profile.sheet_linked_at
          : SYNC_CUTOFF;
      const inRangeForProfile = (d: string) => d >= cutoff && d <= today;
      const pulled = computeMemberPull(
        profile.id,
        map,
        member.records,
        appByDate,
        inRangeForProfile,
        nowIso,
      );
      inserts.push(...pulled.inserts);
      updates.push(...pulled.updates);
      result.inserted += pulled.inserts.length;
      result.updated += pulled.updates.length;
      for (const d of pulled.conflicts) result.conflicts.push(`${sheetName} ${d}`); // 複数/日は触らない
    } else {
      // pushのみ: 前回同期以降にアプリ側が変更された記録を、マップ済み項目まるごとシートへ書き戻す。
      for (const [date, list] of appByDate) {
        if (!inRange(date) || list.length !== 1) continue; // 複数/日は触らない
        const app = list[0];
        if (!appIsNewer(app)) continue;
        const cells = appToCellsFull(map, app);
        if (Object.keys(cells).length > 0) {
          pushes.push({ id: app.id, memberName: sheetName, date, cells });
        }
      }
    }
  }

  if (dryRun) {
    result.inserted = inserts.length;
    result.updated = updates.length;
    result.pushed = pushes.length;
    return result;
  }

  // 部分失敗設計: 1件（1部員）の失敗で他の部員の同期を止めない
  // （2026-07-02〜03、1人のシート不調で28時間全滅した事故の再発防止）。
  if (inserts.length > 0) {
    const { error } = await admin.from("practice_records").insert(inserts);
    if (error) {
      // 一括insertが失敗したら1件ずつ入れ直し、不正な行（型不一致等）だけを
      // スキップして残りを取り込む。失敗行は部員名・日付つきで記録する
      // （2026-07-09〜12、「流し」列の小数1セルで全部員の新規取込が3日間
      // 全滅・status=successのため誰も気づけなかった事故の再発防止）。
      result.inserted = 0;
      for (const row of inserts) {
        const { error: rowErr } = await admin.from("practice_records").insert(row);
        if (rowErr) {
          result.failedMembers.push({
            member: nameById.get(row.user_id as string) ?? String(row.user_id),
            reason: `${row.recorded_date}: ${rowErr.message}`,
          });
        } else {
          result.inserted++;
        }
      }
    }
  }
  for (const u of updates) {
    try {
      const { error } = await admin.from("practice_records").update(u.patch).eq("id", u.id);
      if (error) throw error;
    } catch (err) {
      result.updated--;
      result.failedMembers.push({
        member: "(取込更新)",
        reason: err instanceof Error ? err.message : "更新に失敗しました",
      });
    }
  }
  try {
    const replySync = await reconcileSheetReplies(
      admin,
      linked.map((profile) => ({ id: profile.id, sheet_name: profile.sheet_name })),
      members,
      SYNC_CUTOFF,
      today,
    );
    result.sheetReplies = replySync.synced;
    result.failedMembers.push(...replySync.failedMembers);
  } catch (error) {
    result.failedMembers.push({
      member: "(スプシ返信)",
      reason: error instanceof Error ? error.message : "返信の同期に失敗しました",
    });
  }

  for (const p of pushes) {
    try {
      await gasPost({ action: "writeCells", memberName: p.memberName, date: p.date, cells: p.cells });
      const { error } = await admin
        .from("practice_records")
        .update({
          synced_at: new Date().toISOString(),
          ...(p.clearsPending ? { pending_sheet_push: false } : {}),
        })
        .eq("id", p.id);
      if (error) throw error;
      result.pushed++;
    } catch (err) {
      result.failedMembers.push({
        member: p.memberName,
        reason: err instanceof Error ? err.message : "書き戻しに失敗しました",
      });
    }
  }

  return result;
}

export type LiveRefreshResult = { inserted: number; updated: number; sheetReplies: number };

/**
 * 個人の記録画面（マイページ等）を表示する直前に、スプシメイン(record_source='sheet')の
 * 本人の記録を毎時同期を待たずその場でDB(Supabaseミラー)へ非破壊で反映する（タスク16残作業）。
 * fetchMember 1回＋既存ロジック(computeMemberPull)の使い回しで、100人規模でもfetchAllRawを
 * 引かずに済む。GAS不調・タイムアウト時はDBの現状のまま表示させるため例外を投げず null を返す
 * （呼び出し側＝Server Componentのレンダリングを絶対に壊さないため）。
 */
export async function refreshMemberFromSheetLive(
  supabase: SupabaseClient,
  profile: {
    id: string;
    sheet_name: string | null;
    record_source: "app" | "sheet";
    record_fields: RecordFieldDef[] | null;
    sheet_linked_at: string | null;
  },
): Promise<LiveRefreshResult | null> {
  if (profile.record_source !== "sheet" || !profile.sheet_name) return null;

  try {
    const member = await fetchMemberRaw(profile.sheet_name, { timeoutMs: 5000 });
    const map = resolveFieldMap(member.header, profile.record_fields ?? []);
    const today = todayJST();
    const cutoff =
      profile.sheet_linked_at && profile.sheet_linked_at > SYNC_CUTOFF
        ? profile.sheet_linked_at
        : SYNC_CUTOFF;

    const { data: existing, error } = await supabase
      .from("practice_records")
      .select(
        "id, user_id, recorded_date, dist_low, dist_mid, dist_high, dist_speed, strides, strength_text, result_text, memo, menu_text, focus_text, custom, updated_at, synced_at, pending_sheet_push",
      )
      .eq("user_id", profile.id)
      .gte("recorded_date", cutoff);
    if (error || !existing) return null;

    const byDate = new Map<string, DbRecord[]>();
    for (const r of existing as DbRecord[]) {
      const arr = byDate.get(r.recorded_date) ?? [];
      arr.push(r);
      byDate.set(r.recorded_date, arr);
    }

    const nowIso = new Date().toISOString();
    const { inserts, updates } = computeMemberPull(
      profile.id,
      map,
      member.records,
      byDate,
      (d) => d >= cutoff && d <= today,
      nowIso,
    );
    let inserted = 0;
    let updated = 0;
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from("practice_records").insert(inserts);
      if (!insErr) inserted = inserts.length;
    }
    for (const u of updates) {
      const { error: updErr } = await supabase
        .from("practice_records")
        .update(u.patch)
        .eq("id", u.id);
      if (!updErr) updated++;
    }
    let sheetReplies = 0;
    try {
      const replySync = await reconcileSheetReplies(
        supabase,
        [{ id: profile.id, sheet_name: profile.sheet_name }],
        [member],
        cutoff,
        today,
      );
      sheetReplies = replySync.synced;
    } catch {
      // Reply synchronization must not prevent the record page from loading.
    }
    return { inserted, updated, sheetReplies };
  } catch {
    return null; // GAS不調・タイムアウト等はDBの現状のまま表示（ページを壊さない）
  }
}
