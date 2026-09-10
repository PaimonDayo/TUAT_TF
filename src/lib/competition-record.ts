/**
 * 大会・記録会の結果の「記録」を、種目ごとに決まった形で持つためのユーティリティ。
 * DB は数値（時間=1/100秒, 跳躍投擲=cm, 混成=点）で持ち、表示文字列はここで組み立てる。
 * 旧データは自由入力の文字列しか持たないため、値が無いときは元の文字列をそのまま見せる。
 */
export type MeasureType = "time" | "distance" | "points";
/** 時間の書き方。短距離は 61.85 のように秒だけ、長距離は 15分32.40 と分けて書く。 */
export type TimeFormat = "minutes" | "seconds";
export type ResultStatus = "ok" | "DNS" | "DNF" | "DQ" | "NM";
export type RecordStage = "university" | "pre_university";
export type DatePrecision = "day" | "month" | "year";

/** 種目マスタで選ぶ「記録の書き方」。測り方と時間の書き方をひとつの選択にまとめる。 */
export type RecordFormat = "minutes" | "seconds" | "meters" | "points";

export const RECORD_FORMAT_LABEL: Record<RecordFormat, string> = {
  minutes: "分と秒（例 15分32.40）",
  seconds: "秒（例 61.85）",
  meters: "メートル（例 6.85）",
  points: "得点（例 5432）",
};

export function isTimeFormat(value: string): value is TimeFormat {
  return value === "minutes" || value === "seconds";
}

export function isRecordFormat(value: string): value is RecordFormat {
  return value === "minutes" || value === "seconds" || value === "meters" || value === "points";
}

/** 種目マスタの2列（測り方・時間の書き方）と、画面で選ぶ1つの書き方を行き来する。 */
export function toRecordFormat(measure: MeasureType, timeFormat: TimeFormat): RecordFormat {
  if (measure === "distance") return "meters";
  if (measure === "points") return "points";
  return timeFormat;
}

export function fromRecordFormat(format: RecordFormat): {
  measure_type: MeasureType;
  time_format: TimeFormat;
} {
  if (format === "meters") return { measure_type: "distance", time_format: "minutes" };
  if (format === "points") return { measure_type: "points", time_format: "minutes" };
  return { measure_type: "time", time_format: format };
}

/** 種目名から、その種目の書き方を引く。登録が無ければ分と秒として扱う。 */
export function recordFormatOf(
  events: { name: string; measure_type: string; time_format?: string | null }[],
  eventName: string,
): RecordFormat {
  const found = events.find((e) => e.name === eventName);
  if (!found) return "minutes";
  const measure = isMeasureType(found.measure_type) ? found.measure_type : "time";
  const timeFormat =
    found.time_format && isTimeFormat(found.time_format) ? found.time_format : "minutes";
  return toRecordFormat(measure, timeFormat);
}

export const RESULT_STATUS_LABEL: Record<ResultStatus, string> = {
  ok: "記録あり",
  DNS: "欠場（DNS）",
  DNF: "途中棄権（DNF）",
  DQ: "失格（DQ）",
  NM: "記録なし（NM）",
};

export const STAGE_LABEL: Record<RecordStage, string> = {
  university: "大学",
  pre_university: "高校以前",
};

export function isMeasureType(value: string): value is MeasureType {
  return value === "time" || value === "distance" || value === "points";
}

export function measureTypeOf(
  events: { name: string; measure_type: string }[],
  eventName: string,
): MeasureType {
  const found = events.find((e) => e.name === eventName)?.measure_type;
  return found && isMeasureType(found) ? found : "time";
}

/** 時・分・秒・1/100秒 → 1/100秒。負の値と非数は 0 として扱う。 */
export function toCentiseconds(parts: {
  hours?: number | null;
  minutes?: number | null;
  seconds?: number | null;
  centis?: number | null;
}): number {
  const n = (v: number | null | undefined) =>
    Number.isFinite(v) && (v as number) > 0 ? Math.floor(v as number) : 0;
  return (
    n(parts.hours) * 360_000 +
    n(parts.minutes) * 6_000 +
    n(parts.seconds) * 100 +
    n(parts.centis)
  );
}

export function fromCentiseconds(value: number) {
  return {
    hours: Math.floor(value / 360_000),
    minutes: Math.floor(value / 6_000) % 60,
    seconds: Math.floor(value / 100) % 60,
    centis: value % 100,
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/**
 * 時間の表示。
 * 分と秒で書く種目は 1:02:33.45 / 15'32"40 / 11"32。
 * 秒で書く種目は 61.85 のように、分へ繰り上げずそのまま秒で見せる。
 */
export function formatCentiseconds(value: number, format: TimeFormat = "minutes"): string {
  const { hours, minutes, seconds, centis } = fromCentiseconds(value);
  if (format === "seconds")
    return `${hours * 3600 + minutes * 60 + seconds}.${pad(centis)}`;
  if (hours > 0)
    return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
  if (minutes > 0) return `${minutes}'${pad(seconds)}"${pad(centis)}`;
  return `${seconds}"${pad(centis)}`;
}

/** 「32.40」「61.85」のような秒の入力 → 1/100秒。小数は2桁までで丸める。 */
export function parseDecimalSeconds(text: string): number | null {
  const value = text.normalize("NFKC").trim().replace(/[秒"”]/g, "");
  if (!value) return null;
  const m = /^(\d{1,5})(?:[.．](\d{1,2}))?$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

/** 「6.85」のようなメートルの入力 → cm。小数は2桁までで丸める。 */
export function parseDecimalMetres(text: string): number | null {
  const value = text.normalize("NFKC").trim().replace(/[mｍ]/gi, "");
  if (!value) return null;
  const m = /^(\d{1,3})(?:[.．](\d{1,2}))?$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

/** 1/100秒 → 入力欄に戻す「32.40」形式（分は別欄なので秒の端数だけ） */
export function decimalSecondsInput(value: number, format: TimeFormat): string {
  const { hours, minutes, seconds, centis } = fromCentiseconds(value);
  const whole = format === "seconds" ? hours * 3600 + minutes * 60 + seconds : seconds;
  return centis > 0 ? `${whole}.${pad(centis)}` : String(whole);
}

/** cm → 入力欄に戻す「6.85」形式 */
export function decimalMetresInput(value: number): string {
  const centimetres = value % 100;
  const metres = Math.floor(value / 100);
  return centimetres > 0 ? `${metres}.${pad(centimetres)}` : String(metres);
}

/** cm → 6m85 */
export function formatCentimeters(value: number): string {
  return `${Math.floor(value / 100)}m${pad(value % 100)}`;
}

export function formatPoints(value: number): string {
  return `${value}点`;
}

/** 風速 → +1.2 / -0.3 / ±0.0 */
export function formatWind(value: number): string {
  const fixed = value.toFixed(1);
  if (Number(fixed) === 0) return "±0.0";
  return Number(fixed) > 0 ? `+${fixed}` : fixed;
}

export type RecordValues = {
  measure_type?: MeasureType;
  result_status?: string | null;
  value_cs?: number | null;
  value_cm?: number | null;
  value_points?: number | null;
  record?: string | null;
};

/** 一覧・カードに出す記録の文字列。構造化された値が無ければ旧テキストを返す。 */
export function formatRecord(
  row: RecordValues,
  measure?: MeasureType,
  timeFormat: TimeFormat = "minutes",
): string {
  const status = row.result_status ?? "ok";
  if (status !== "ok")
    return RESULT_STATUS_LABEL[status as ResultStatus]?.replace(/（.+）/, "") ?? status;
  const type = measure ?? row.measure_type;
  if (type === "distance" && row.value_cm != null)
    return formatCentimeters(row.value_cm);
  if (type === "points" && row.value_points != null)
    return formatPoints(row.value_points);
  if ((type === "time" || type == null) && row.value_cs != null)
    return formatCentiseconds(row.value_cs, timeFormat);
  if (row.value_cs != null) return formatCentiseconds(row.value_cs, timeFormat);
  if (row.value_cm != null) return formatCentimeters(row.value_cm);
  if (row.value_points != null) return formatPoints(row.value_points);
  return row.record ?? "";
}

/** 記録日の表示。粒度に応じて 2026/9/21・2026年9月・2026年 に丸める。 */
export function formatRecordedOn(
  recordedOn: string | null,
  precision: string | null | undefined,
): string {
  if (!recordedOn) return "";
  const [year, month, day] = recordedOn.split("-");
  if (precision === "year") return `${Number(year)}年`;
  if (precision === "month") return `${Number(year)}年${Number(month)}月`;
  return `${Number(year)}/${Number(month)}/${Number(day)}`;
}

/** 年でまとめるときの見出し。高校以前は年をまたいで1つにまとめる。 */
export function recordGroupKey(row: {
  stage?: string | null;
  recorded_on: string | null;
}): string {
  if (row.stage === "pre_university") return "高校以前";
  return row.recorded_on ? `${row.recorded_on.slice(0, 4)}年` : "日付未設定";
}

/**
 * 旧データ（自由入力の文字列）を数値へ読み替える。移行の dry-run と入力補助に使う。
 * 読めなければ null を返し、呼び出し側は元の文字列を保持する。
 */
export function parseRecordText(
  text: string,
  measure: MeasureType,
): { value_cs?: number; value_cm?: number; value_points?: number } | null {
  const value = text.normalize("NFKC").trim().replace(/\s+/g, "");
  if (!value) return null;

  if (measure === "points") {
    const m = /^(\d{1,5})点?$/.exec(value);
    return m ? { value_points: Number(m[1]) } : null;
  }

  if (measure === "distance") {
    const meterCm = /^(\d{1,2})m(\d{1,2})$/i.exec(value);
    if (meterCm)
      return {
        value_cm:
          Number(meterCm[1]) * 100 + Number(meterCm[2].padEnd(2, "0")),
      };
    const decimal = /^(\d{1,2})[.．](\d{1,2})m?$/i.exec(value);
    if (decimal)
      return {
        value_cm: Number(decimal[1]) * 100 + Number(decimal[2].padEnd(2, "0")),
      };
    return null;
  }

  // 時間: 1:02:33.45 / 15:32.40 / 15'32"40 / 15分32秒4 / 11.32
  const normalized = value
    .replace(/時間|時/g, ":")
    .replace(/分/g, ":")
    .replace(/['’]/g, ":")
    .replace(/秒/g, ".")
    .replace(/["”]/g, ".");
  const m = /^(?:(\d{1,2}):)?(?:(\d{1,3}):)?(\d{1,2})(?:[.](\d{1,2}))?$/.exec(
    normalized.replace(/\.$/, ""),
  );
  if (!m) return null;
  const [, a, b, seconds, fraction] = m;
  const hours = b ? Number(a) : 0;
  const minutes = b ? Number(b) : a ? Number(a) : 0;
  return {
    value_cs: toCentiseconds({
      hours,
      minutes,
      seconds: Number(seconds),
      centis: fraction ? Number(fraction.padEnd(2, "0")) : 0,
    }),
  };
}

/** 種目名から時間の書き方だけを引く（表示側で使う） */
export function timeFormatOf(
  events: { name: string; measure_type: string; time_format?: string | null }[],
  eventName: string,
): TimeFormat {
  return recordFormatOf(events, eventName) === "seconds" ? "seconds" : "minutes";
}
