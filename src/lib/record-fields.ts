import type { RecordFieldDef } from "@/types";

export type BuiltinRecordFieldKey =
  | "strides"
  | "result_text"
  | "strength_text"
  | "menu_text"
  | "focus_text"
  | "memo"
  | "condition";

export const BUILTIN_RECORD_FIELD_KEYS: BuiltinRecordFieldKey[] = [
  "strides",
  "result_text",
  "strength_text",
  "menu_text",
  "focus_text",
  "memo",
  "condition",
];

const BUILTIN_KEY_SET = new Set<string>(BUILTIN_RECORD_FIELD_KEYS);

export function isBuiltinRecordField(field: RecordFieldDef): field is RecordFieldDef & { key: BuiltinRecordFieldKey } {
  return BUILTIN_KEY_SET.has(field.key);
}

export function customRecordFields(fields: RecordFieldDef[] | null | undefined): RecordFieldDef[] {
  return (fields ?? []).filter((field) => !isBuiltinRecordField(field));
}

export function recordFieldHidden(
  fields: RecordFieldDef[] | null | undefined,
  key: BuiltinRecordFieldKey,
): boolean {
  return (fields ?? []).find((field) => field.key === key)?.hidden === true;
}
export function recordFieldLabel(
  fields: RecordFieldDef[] | null | undefined,
  key: BuiltinRecordFieldKey,
  fallback: string,
): string {
  return (fields ?? []).find((field) => field.key === key)?.label?.trim() || fallback;
}

export function editableBuiltinRecordFields(isMiddleLong: boolean): { key: BuiltinRecordFieldKey; label: string; type: "text" | "number" }[] {
  return isMiddleLong
    ? [
        { key: "strides", label: "流し", type: "number" },
        { key: "result_text", label: "結果", type: "text" },
        { key: "strength_text", label: "補強", type: "text" },
        { key: "memo", label: "感想・振り返り", type: "text" },
        { key: "condition", label: "コンディション", type: "text" },
      ]
    : [
        { key: "menu_text", label: "メニュー", type: "text" },
        { key: "focus_text", label: "目的・意識すること", type: "text" },
        { key: "result_text", label: "タイム", type: "text" },
        { key: "memo", label: "感想・振り返り", type: "text" },
        { key: "condition", label: "コンディション", type: "text" },
      ];
}