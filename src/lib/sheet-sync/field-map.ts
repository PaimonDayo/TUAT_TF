// アプリの項目 ⇔ シートの見出しの対応づけと、値の変換。
// ネットワークもDBも触らない純粋な処理。

import type { RecordFieldDef } from "@/types";
import { customRecordFields } from "@/lib/record-fields";
import { roundKm } from "@/lib/utils";
import { hasCustomRecordContent } from "@/lib/record-content";
import { type RawMember } from "@/lib/sheet-public-csv";

// ── アプリの組み込みフィールド ⇔ スプシ見出しのキーワード ───────────────────
export type BuiltinKey =
  | "dist_low"
  | "dist_mid"
  | "dist_high"
  | "dist_speed"
  | "dist_actual"
  | "strides"
  | "strength_text"
  | "result_text"
  | "memo"
  | "menu_text"
  | "focus_text";

export const BUILTINS: { key: BuiltinKey; keywords: string[]; numeric: boolean; integer?: boolean }[] = [
  { key: "dist_low", keywords: ["低強度"], numeric: true },
  { key: "dist_mid", keywords: ["中強度"], numeric: true },
  { key: "dist_high", keywords: ["高強度"], numeric: true },
  { key: "dist_speed", keywords: ["解糖系"], numeric: true },
  { key: "dist_actual", keywords: ["実際の距離", "実距離", "走行距離", "総距離"], numeric: true },
  // strides はDBがINT型。シートに小数（例: 0.3）が入っていても丸めて取り込み、
  // insert全体を巻き込んで失敗させない（2026-07-09〜12、この型不一致で定期連携の
  // 新規取込が3日間全滅した実例あり）。
  { key: "strides", keywords: ["流し"], numeric: true, integer: true },
  { key: "strength_text", keywords: ["補強"], numeric: false },
  { key: "result_text", keywords: ["結果", "ペース", "タイム"], numeric: false },
  { key: "memo", keywords: ["感想"], numeric: false },
  { key: "menu_text", keywords: ["メニュー"], numeric: false },
  { key: "focus_text", keywords: ["目的", "意識"], numeric: false },
];

export const DISTANCE_KEYS = new Set<BuiltinKey>(["dist_low", "dist_mid", "dist_high", "dist_speed", "dist_actual"]);

export const norm = (s: string) => (s ?? "").toString().replace(/\s+/g, "").trim();

/** GAS parseDistance の移植: 全角・(),＋ を処理して + や , で合算 */
export function parseSheetNum(val: string | number | null | undefined): number {
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

export const txt = (v: string | null | undefined) => {
  const s = (v ?? "").toString().trim();
  return s.length > 0 ? s : null;
};
// ── マッピング解決：このシートの見出しから「アプリ項目→実際の見出し名」を作る ──
export type FieldMap = {
  builtin: Map<BuiltinKey, { header: string; column: number; numeric: boolean; integer?: boolean }>;
  custom: Map<string, { header: string; column: number; type: "text" | "number" }>;
};

export type HeaderCandidate = { raw: string; n: string; column: number };

export function resolveFieldMap(
  member: Pick<RawMember, "header" | "columns">,
  fields: RecordFieldDef[],
): FieldMap {
  const sourceColumns = member.columns?.length ? member.columns : member.header.map((label, index) => ({ index, label }));
  const headers: HeaderCandidate[] = sourceColumns.map((item) => ({ raw: item.label, n: norm(item.label), column: item.index }));
  const builtin: FieldMap["builtin"] = new Map();
  const usedColumns = new Set<number>();
  // Reserve explicitly configured custom columns before builtin keyword fallbacks.
  // Otherwise a custom label containing the builtin keyword is consumed by that fallback.
  const customSourceColumns = new Set(customRecordFields(fields)
    .filter((field) => !field.hidden && field.sourceColumn != null)
    .filter((field) => headers.some((candidate) => candidate.column === field.sourceColumn && (
      !field.sourceHeader || norm(field.sourceHeader) === candidate.n
    )))
    .map((field) => field.sourceColumn as number));


  for (const item of BUILTINS) {
    const configured = fields.find((field) => field.key === item.key);
    if (configured?.hidden) continue;
    const hit = headers.find((candidate) => !usedColumns.has(candidate.column)
      && (item.key !== "memo" || candidate.n === "感想")
      && (
      (configured?.sourceColumn === candidate.column && norm(configured.sourceHeader ?? candidate.raw) === candidate.n) ||
      (configured?.sourceHeader && norm(configured.sourceHeader) === candidate.n) ||
      (configured?.label && norm(configured.label) === candidate.n)
    ));
    if (!hit) continue;
    builtin.set(item.key, { header: hit.raw, column: hit.column, numeric: item.numeric, integer: item.integer });
    usedColumns.add(hit.column);
  }

  for (const item of BUILTINS) {
    const configured = fields.find((field) => field.key === item.key);
    if (builtin.has(item.key) || configured?.hidden) continue;
    const available = headers.filter((candidate) => !usedColumns.has(candidate.column) && !customSourceColumns.has(candidate.column));
    let hit: HeaderCandidate | undefined;
    if (item.key === "memo") {
      hit = available.find((candidate) => candidate.n === "感想");
    } else {
      hit = available.find((candidate) => item.keywords.some((keyword) => candidate.n.includes(norm(keyword))));
    }
    if (!hit) continue;
    builtin.set(item.key, { header: hit.raw, column: hit.column, numeric: item.numeric, integer: item.integer });
    usedColumns.add(hit.column);
  }

  const custom: FieldMap["custom"] = new Map();
  for (const field of customRecordFields(fields)) {
    const hit = headers.find((candidate) => !usedColumns.has(candidate.column) && (
      (field.sourceColumn === candidate.column && norm(field.sourceHeader ?? candidate.raw) === candidate.n) ||
      (field.sourceHeader && norm(field.sourceHeader) === candidate.n) ||
      norm(field.label) === candidate.n
    ));
    if (!hit) continue;
    custom.set(field.key, { header: hit.raw, column: hit.column, type: field.type });
    usedColumns.add(hit.column);
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
  dist_actual: number;
  strides: number;
  strength_text: string | null;
  result_text: string | null;
  memo: string | null;
  menu_text: string | null;
  focus_text: string | null;
  custom: Record<string, string | number | null> | null;
  updated_at: string | null;
  synced_at: string | null;
  /** write-through(保存直後のスプシ反映)が失敗し、毎日0時の連携で再送が必要な状態か */
  pending_sheet_push?: boolean;
};

export function appBuiltin(rec: DbRecord, key: BuiltinKey): number | string | null {
  return rec[key] ?? null;
}


/** シートのセルから、アプリへ書き込む値（マップされた項目のみ）を作る */
export function sheetToAppValues(map: FieldMap, record: RawMember["records"][number]) {
  const valueAt = (header: string, column: number) => record.values?.[column] ?? record.cells[header] ?? "";
  const builtin: Record<string, number | string | null> = {};
  for (const [key, m] of map.builtin) {
    const value = valueAt(m.header, m.column);
    builtin[key] = m.numeric
      ? m.integer
        ? Math.round(parseSheetNum(value))
        : DISTANCE_KEYS.has(key)
          ? roundKm(parseSheetNum(value))
          : Math.round(parseSheetNum(value) * 10) / 10
      : txt(value);
  }
  const custom: Record<string, string | number | null> = {};
  for (const [key, m] of map.custom) {
    const value = valueAt(m.header, m.column);
    const textValue = txt(value);
    custom[key] = m.type === "number"
      ? textValue === null
        ? null
        : Math.round(parseSheetNum(value) * 10) / 10
      : textValue;
  }
  return { builtin, custom };
}

/** マップされた値がすべて空か（数値0・テキストnull） */
export function valuesEmpty(
  builtin: Record<string, number | string | null>,
  custom: Record<string, string | number | null>,
): boolean {
  for (const v of Object.values(builtin)) {
    if (typeof v === "number" ? v !== 0 : (v ?? "").toString().trim() !== "") return false;
  }
  for (const v of Object.values(custom)) {
    if (hasCustomRecordContent(v)) return false;
  }
  return true;
}

/** アプリのレコードから、スプシへ送る cells（マップされた項目を全て。シート＝アプリの写しにする） */
export function appToCellsFull(map: FieldMap, rec: DbRecord): Record<string, string | number> {
  const cells: Record<string, string | number> = {};
  for (const [key, m] of map.builtin) {
    const v = appBuiltin(rec, key);
    // DB distances use 0 for both blank and zero km. Match sheet entry by
    // clearing that cell; sending "" also clears an old nonzero value on edit.
    cells[m.header] = m.numeric ? Number(v) || "" : (v ?? "").toString();
  }
  for (const [key, m] of map.custom) {
    const v = rec.custom?.[key];
    // Unlike builtin distance defaults, an explicit custom numeric 0 is data.
    cells[m.header] = m.type === "number"
      ? v == null || String(v).trim() === "" ? "" : parseSheetNum(v as string)
      : (v ?? "").toString();
  }
  return cells;
}

/** アプリのレコードから、スプシへ送る cells（**中身のある項目だけ**。空でシートを潰さない） */
export function appToCellsNonEmpty(map: FieldMap, rec: DbRecord): Record<string, string | number> {
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

export const BUILTIN_LABELS: Record<BuiltinKey, string> = {
  dist_low: "低強度",
  dist_mid: "中強度",
  dist_high: "高強度",
  dist_speed: "解糖系",
  dist_actual: "実際の距離",
  strides: "流し",
  strength_text: "補強",
  result_text: "結果",
  memo: "感想",
  menu_text: "メニュー",
  focus_text: "目的・意識すること",
};
