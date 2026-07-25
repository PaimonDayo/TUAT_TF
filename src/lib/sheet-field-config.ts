import type { RecordFieldDef } from "@/types";

export type SheetHeaderColumn = { index: number; label: string };

const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, "").trim();

export function sheetHeaderSignature(columns: SheetHeaderColumn[]): string {
  return JSON.stringify(columns.map((column) => [column.index, column.label.normalize("NFC").trim()]));
}

export function memoHeaderCandidates(columns: SheetHeaderColumn[]): SheetHeaderColumn[] {
  const groups = [
    (label: string) => label === "感想",
    (label: string) => label.includes("感想"),
    (label: string) => ["コメント", "反省", "状態"].includes(label),
    (label: string) => ["コメント", "反省", "状態"].some((keyword) => label.includes(keyword)),
  ];
  const seen = new Set<number>();
  const result: SheetHeaderColumn[] = [];
  for (const matches of groups) {
    for (const column of columns) {
      if (!seen.has(column.index) && matches(normalize(column.label))) {
        seen.add(column.index);
        result.push(column);
      }
    }
  }
  return result;
}

export function sheetBuiltinKey(
  label: string,
  options: { isMiddleLong: boolean; memoColumn?: number | null },
  column: number,
): string | null {
  const value = normalize(label);
  if (value === "日付") return null;
  if (options.memoColumn === column) return "memo";
  if (options.isMiddleLong) {
    if (value.includes("低強度")) return "dist_low";
    if (value.includes("中強度")) return "dist_mid";
    if (value.includes("高強度")) return "dist_high";
    if (value.includes("解糖系") || value.includes("スピード")) return "dist_speed";
    if (["実際の距離", "実距離", "走行距離", "総距離"].some((keyword) => value.includes(keyword))) return "dist_actual";
  }
  if (value.includes("流し")) return "strides";
  if (value.includes("補強")) return "strength_text";
  if (["結果", "ペース", "タイム"].some((keyword) => value.includes(keyword))) return "result_text";
  if (value.includes("メニュー")) return "menu_text";
  if (value.includes("目的") || value.includes("意識")) return "focus_text";
  return null;
}

export function isFixedSheetColumn(label: string, isMiddleLong: boolean): boolean {
  const value = normalize(label);
  if (value === "日付") return true;
  if (!isMiddleLong) return false;
  return value.includes("低強度") || value.includes("中強度") || value.includes("高強度") || value.includes("解糖系") || value.includes("スピード") || ["実際の距離", "実距離", "走行距離", "総距離"].some((keyword) => value.includes(keyword));
}

export function inferSheetFieldType(label: string): "text" | "number" {
  const value = normalize(label);
  return ["距離", "流し", "本数", "体重", "時間", "回数", "数"].some((keyword) => value.includes(keyword)) ? "number" : "text";
}

export function buildSheetRecordFields(options: {
  columns: SheetHeaderColumn[];
  selectedColumns: number[];
  types: Record<number, "text" | "number">;
  isMiddleLong: boolean;
  memoColumn: number | null;
}): RecordFieldDef[] {
  const selected = new Set(options.selectedColumns);
  const usedKeys = new Set<string>();
  return options.columns.flatMap((column) => {
    const fixed = isFixedSheetColumn(column.label, options.isMiddleLong);
    const builtin = sheetBuiltinKey(column.label, options, column.index);
    if (normalize(column.label) === "日付") return [];
    const type = builtin?.startsWith("dist_") || builtin === "strides" ? "number" : (options.types[column.index] ?? "text");
    if (!fixed && !selected.has(column.index)) {
      return builtin ? [{ key: builtin, label: column.label.trim(), type, hidden: true, sourceHeader: column.label, sourceColumn: column.index } satisfies RecordFieldDef] : [];
    }
    const key = builtin ?? `sheet_${column.index}_${normalize(column.label).slice(0, 20) || "field"}`;
    if (usedKeys.has(key)) return [];
    usedKeys.add(key);
    return [{
      key,
      label: column.label.trim(),
      type,
      sourceHeader: column.label,
      sourceColumn: column.index,
    } satisfies RecordFieldDef];
  });
}
