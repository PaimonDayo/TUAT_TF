/**
 * PostgREST用の「練習記録に表示できる内容がある」OR条件。
 *
 * custom は NOT NULL DEFAULT '{}' のJSONB。固定項目がすべて空でも、
 * 「独り言」など利用者が追加したスプレッドシート列だけに値がある記録を
 * タイムラインとプロフィールから落とさない。
 */
// Computed in Postgres before LIMIT/cursors so empty rows cannot consume a page.
export const RECORD_NONEMPTY_OR = "record_has_content.eq.true";

/** Zero-only sheet placeholders are not a post; keep all meaningful custom text. */
export function hasCustomRecordContent(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text !== "" && !/^[+-]?0+(?:\.0+)?$/.test(text);
}
