import type { RecordFieldDef } from "@/types";

export type SheetHeaderColumn = { index: number; label: string };

const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, "").trim();

const MIDDLE_LONG_FIXED_KEYS = new Set([
  "dist_actual",
  "dist_low",
  "dist_mid",
  "dist_high",
  "dist_speed",
  "strides",
  "result_text",
  "strength_text",
]);

const SHORT_DEFAULT_HEADERS = new Set([
  "メニュー",
  "目的・意識すること",
  "考えたこと",
  "コメント",
]);

export function isIgnoredSheetColumn(label: string): boolean {
  const value = normalize(label);
  return ["日付", "曜日"].includes(value) || value.includes("週合計");
}

export function sheetHeaderSignature(columns: SheetHeaderColumn[]): string {
  return JSON.stringify(columns.map((column) => [column.index, column.label.normalize("NFC").trim()]));
}

export function relevantSheetHeaderSignature(
  columns: SheetHeaderColumn[],
  fields: RecordFieldDef[],
  isMiddleLong: boolean,
): string {
  const activeSourceColumns = new Set(fields
    .filter((field) => !field.hidden || field.showInTimeline === true)
    .map((field) => field.sourceColumn)
    .filter((column): column is number => typeof column === "number"));
  const relevant = columns.filter((column) =>
    !isIgnoredSheetColumn(column.label)
    && (activeSourceColumns.has(column.index) || isFixedSheetColumn(column.label, isMiddleLong)));
  return sheetHeaderSignature(relevant);
}

/** Follow a column move only when every confirmed header still has a unique identity. */
export function relocatedSheetFields(
  columns: SheetHeaderColumn[], fields: RecordFieldDef[], signature: string, isMiddleLong: boolean,
): RecordFieldDef[] | null {
  let confirmed: unknown;
  try { confirmed = JSON.parse(signature); } catch { return null; }
  if (!Array.isArray(confirmed) || confirmed.length === 0 || confirmed.some(value =>
    !Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || typeof value[1] !== "string")) return null;
  const entries = confirmed as [number, string][];
  const labels = entries.map(([, label]) => normalize(label));
  if (new Set(labels).size !== labels.length) return null;
  const moved = new Map<number, SheetHeaderColumn>();
  for (const [index, label] of entries) {
    const matches = columns.filter(column => normalize(column.label) === normalize(label));
    if (matches.length !== 1) return null;
    moved.set(index, matches[0]);
  }
  const remapped = fields.map(field => {
    const column = field.sourceColumn === undefined ? undefined : moved.get(field.sourceColumn);
    if (!column || normalize(field.sourceHeader ?? field.label) !== normalize(column.label)) return field;
    return { ...field, sourceColumn: column.index, sourceHeader: column.label };
  });
  const current = JSON.parse(relevantSheetHeaderSignature(columns, remapped, isMiddleLong)) as [number, string][];
  if (current.length !== labels.length || current.some(([, label]) => !labels.includes(normalize(label)))) return null;
  return remapped;
}

export function memoHeaderCandidates(columns: SheetHeaderColumn[]): SheetHeaderColumn[] {
  const firstExact = columns.find((column) => normalize(column.label) === "感想");
  return firstExact ? [firstExact] : [];
}

export function defaultSelectedSheetColumns(
  columns: SheetHeaderColumn[],
  isMiddleLong: boolean,
  memoColumn: number | null,
): number[] {
  return columns
    .filter((column) => !isIgnoredSheetColumn(column.label))
    .filter((column) => !isFixedSheetColumn(column.label, isMiddleLong))
    .filter((column) => {
      if (isMiddleLong) return column.index === memoColumn;
      return SHORT_DEFAULT_HEADERS.has(normalize(column.label));
    })
    .map((column) => column.index);
}

export function sheetBuiltinKey(
  label: string,
  options: { isMiddleLong: boolean; memoColumn?: number | null },
  column: number,
): string | null {
  const value = normalize(label);
  if (isIgnoredSheetColumn(value)) return null;
  if (options.isMiddleLong && options.memoColumn === column) return "memo";
  if (options.isMiddleLong) {
    if (value.includes("低強度")) return "dist_low";
    if (value.includes("中強度")) return "dist_mid";
    if (value.includes("高強度")) return "dist_high";
    if (value.includes("解糖系") || value.includes("スピード")) return "dist_speed";
    if (["実際の距離", "実距離", "走行距離", "総距離"].some((keyword) => value.includes(keyword))) return "dist_actual";
    if (value.includes("流し")) return "strides";
    if (value.includes("補強")) return "strength_text";
    if (["結果", "ペース", "タイム"].some((keyword) => value.includes(keyword))) return "result_text";
    return null;
  }
  if (value === "メニュー") return "menu_text";
  if (value === "目的・意識すること") return "focus_text";
  if (value === "コメント") return "memo";
  return null;
}

export function isFixedSheetColumn(label: string, isMiddleLong: boolean): boolean {
  if (isIgnoredSheetColumn(label)) return true;
  if (!isMiddleLong) return false;
  const key = sheetBuiltinKey(label, { isMiddleLong, memoColumn: null }, -1);
  return key !== null && MIDDLE_LONG_FIXED_KEYS.has(key);
}

export function inferSheetFieldType(label: string): "text" | "number" {
  const value = normalize(label);
  return ["距離", "流し", "本数", "体重", "時間", "回数", "数"].some((keyword) => value.includes(keyword)) ? "number" : "text";
}

export function timelineFieldLimit(isMiddleLong: boolean): number {
  return isMiddleLong ? 2 : 4;
}

export function buildSheetRecordFields(options: {
  columns: SheetHeaderColumn[];
  selectedColumns: number[];
  timelineColumns?: number[];
  types: Record<number, "text" | "number">;
  isMiddleLong: boolean;
  memoColumn: number | null;
}): RecordFieldDef[] {
  const selected = new Set(options.selectedColumns);
  const timeline = new Set(options.timelineColumns ?? options.selectedColumns);
  const usedKeys = new Set<string>();
  return options.columns.flatMap((column) => {
    if (isIgnoredSheetColumn(column.label)) return [];
    const fixed = isFixedSheetColumn(column.label, options.isMiddleLong);
    const builtin = sheetBuiltinKey(column.label, options, column.index);
    if (builtin === "dist_actual") return [];
    const type = builtin?.startsWith("dist_") || builtin === "strides"
      ? "number"
      : (options.types[column.index] ?? "text");
    if (!fixed && !selected.has(column.index)) {
      return builtin ? [{
        key: builtin,
        label: column.label.trim(),
        type,
        hidden: true,
        showInTimeline: false,
        sourceHeader: column.label,
        sourceColumn: column.index,
      } satisfies RecordFieldDef] : [];
    }
    const key = builtin ?? `sheet_${column.index}_${normalize(column.label).slice(0, 20) || "field"}`;
    if (usedKeys.has(key)) return [];
    usedKeys.add(key);
    return [{
      key,
      label: column.label.trim(),
      type,
      showInTimeline: fixed || timeline.has(column.index),
      sourceHeader: column.label,
      sourceColumn: column.index,
    } satisfies RecordFieldDef];
  });
}
