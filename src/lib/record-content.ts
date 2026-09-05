/**
 * PostgREST用の「練習記録に表示できる内容がある」OR条件。
 *
 * custom は NOT NULL DEFAULT '{}' のJSONB。固定項目がすべて空でも、
 * 「独り言」など利用者が追加したスプレッドシート列だけに値がある記録を
 * タイムラインとプロフィールから落とさない。
 */
export const RECORD_NONEMPTY_OR = [
  "dist_low.gt.0",
  "dist_mid.gt.0",
  "dist_high.gt.0",
  "dist_speed.gt.0",
  "dist_actual.gt.0",
  "strides.gt.0",
  "result_text.not.is.null",
  "strength_text.not.is.null",
  "memo.not.is.null",
  "menu_text.not.is.null",
  "focus_text.not.is.null",
  "custom.neq.{}",
].join(",");
