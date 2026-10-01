import {
  decimalSecondsInput,
  fromCentiseconds,
  parseDecimalMetres,
  parseDecimalSeconds,
  parseRecordText,
  recordFormatOf,
  type MeasureType,
} from "./competition-record";

/** 入力欄の単位。保存する数値の単位は従来の 1/100秒・cm・点を使う。 */
export type ResultInputFormat = "seconds" | "minutes" | "hours" | "meters" | "points";

export type ResultInputPreset = {
  format: ResultInputFormat;
  wind: boolean;
  distanceLabel: "距離（m）" | "高さ（m）";
};

type EventCatalog = readonly {
  name: string;
  measure_type: string;
  time_format?: string | null;
}[];

type InitialResult = {
  event_name: string;
  record?: string | null;
  wind?: number | null;
  value_cs?: number | null;
  value_cm?: number | null;
  value_points?: number | null;
};

export type InitialResultValues = {
  value_cs: number | null;
  value_cm: number | null;
  value_points: number | null;
};

const distanceLabel = "距離（m）";

// 部の標準種目。分/時の区分は入力補助で、競技の計時精度を変えない。
const PRESETS: Record<string, ResultInputPreset> = {
  "100m": { format: "seconds", wind: true, distanceLabel },
  "200m": { format: "seconds", wind: true, distanceLabel },
  "400m": { format: "seconds", wind: false, distanceLabel },
  "800m": { format: "minutes", wind: false, distanceLabel },
  "1500m": { format: "minutes", wind: false, distanceLabel },
  "3000m": { format: "minutes", wind: false, distanceLabel },
  "5000m": { format: "minutes", wind: false, distanceLabel },
  "10000m": { format: "minutes", wind: false, distanceLabel },
  "100mh": { format: "seconds", wind: true, distanceLabel },
  "110mh": { format: "seconds", wind: true, distanceLabel },
  "400mh": { format: "seconds", wind: false, distanceLabel },
  "3000msc": { format: "minutes", wind: false, distanceLabel },
  "5000mw": { format: "minutes", wind: false, distanceLabel },
  "10000mw": { format: "minutes", wind: false, distanceLabel },
  "4×100mr": { format: "seconds", wind: false, distanceLabel },
  "4×400mr": { format: "minutes", wind: false, distanceLabel },
  "走高跳": { format: "meters", wind: false, distanceLabel: "高さ（m）" },
  "棒高跳": { format: "meters", wind: false, distanceLabel: "高さ（m）" },
  "走幅跳": { format: "meters", wind: true, distanceLabel },
  "三段跳": { format: "meters", wind: true, distanceLabel },
  "砲丸投": { format: "meters", wind: false, distanceLabel },
  "円盤投": { format: "meters", wind: false, distanceLabel },
  "ハンマー投": { format: "meters", wind: false, distanceLabel },
  "やり投": { format: "meters", wind: false, distanceLabel },
  "七種競技": { format: "points", wind: false, distanceLabel },
  "十種競技": { format: "points", wind: false, distanceLabel },
  "ハーフ": { format: "hours", wind: false, distanceLabel },
  "マラソン": { format: "hours", wind: false, distanceLabel },
  "駅伝": { format: "hours", wind: false, distanceLabel },
};

const ALIASES: Record<string, string> = {
  "走り幅跳び": "走幅跳", "走幅跳び": "走幅跳", "走り幅跳": "走幅跳",
  "三段跳び": "三段跳",
  "走り高跳び": "走高跳", "走高跳び": "走高跳", "走り高跳": "走高跳",
  "棒高跳び": "棒高跳",
  "砲丸投げ": "砲丸投", "円盤投げ": "円盤投", "ハンマー投げ": "ハンマー投",
  "やり投げ": "やり投", "槍投げ": "やり投", "槍投": "やり投",
  "7種競技": "七種競技", "10種競技": "十種競技",
  "ハーフマラソン": "ハーフ", "フルマラソン": "マラソン",
};

function normalizedEventName(name: string): string {
  const value = name.normalize("NFKC").toLowerCase().replace(/\s+/g, "")
    .replace(/^(?:u(?:18|20|23))?(?:男子|女子|男女混合|混合)/, "")
    .replace(/ハードル$/, "h")
    .replace(/(?:障害物競走|障害)$/, "sc")
    .replace(/競歩$/, "w")
    .replace(/リレー$/, "r")
    .replace(/[x✕]/g, "×");
  // リレーの R を省略した表記だけを補う。100m を部分一致で拾わない。
  const relay = /^4×(?:100|400)m$/.test(value) ? `${value}r` : value;
  return Object.hasOwn(ALIASES, relay) ? ALIASES[relay] : relay;
}

function knownPreset(name: string): ResultInputPreset | undefined {
  const normalized = normalizedEventName(name);
  return Object.hasOwn(PRESETS, normalized) ? PRESETS[normalized] : undefined;
}

export function resultInputPreset(eventName: string, events: EventCatalog): ResultInputPreset {
  const known = knownPreset(eventName);
  if (known) return { ...known };
  return {
    format: recordFormatOf([...events], eventName),
    wind: false,
    distanceLabel,
  };
}

export function measureForResultInput(format: ResultInputFormat): MeasureType {
  return format === "meters" ? "distance" : format === "points" ? "points" : "time";
}

/** 分だけのフォームでも、既存の時を総分へ繰り込んで失わない。 */
export function resultTimeFields(totalCs: number | null, format: ResultInputFormat): {
  hours: string;
  minutes: string;
  seconds: string;
} {
  if (totalCs === null || !Number.isFinite(totalCs))
    return { hours: "", minutes: "", seconds: "" };
  const { hours, minutes } = fromCentiseconds(totalCs);
  if (format === "seconds")
    return { hours: "", minutes: "", seconds: decimalSecondsInput(totalCs, "seconds") };
  const inputMinutes = format === "hours" ? minutes : hours * 60 + minutes;
  return {
    hours: format === "hours" && hours ? String(hours) : "",
    minutes: inputMinutes || hours ? String(inputMinutes) : "",
    seconds: decimalSecondsInput(totalCs, "minutes"),
  };
}

function recordText(initial: InitialResult): string {
  return (initial.record ?? "").normalize("NFKC").trim().replace(/\s+/g, "");
}

function isPlainSeconds(text: string): boolean {
  return /^\d{1,8}(?:\.\d{1,2})?(?:秒)?$/.test(text);
}

function inferredTimeFormat(initial: InitialResult): ResultInputFormat {
  const text = recordText(initial);
  if (isPlainSeconds(text)) return "seconds";
  if ((initial.value_cs ?? 0) >= 360_000 || /^\d+:\d+:/.test(text) || /時間|時/.test(text))
    return "hours";
  return "minutes";
}

/** 編集時は種目名より保存された数値の型を優先し、削除済み種目も復元する。 */
export function initialResultInput(
  initial: InitialResult | undefined,
  events: EventCatalog,
): ResultInputPreset {
  const preset = resultInputPreset(initial?.event_name ?? "", events);
  if (!initial) return preset;
  const recognized = !!knownPreset(initial.event_name) || events.some((event) => event.name === initial.event_name);
  const text = recordText(initial);
  let format = preset.format;
  if (initial.value_cm != null) format = "meters";
  else if (initial.value_points != null) format = "points";
  else if (initial.value_cs != null) {
    if (!recognized || measureForResultInput(format) !== "time") format = inferredTimeFormat(initial);
  } else if (!recognized) {
    // 曖昧な小数だけを距離/得点と推測しない。単位があれば旧記録も復元できる。
    if (/^(?:\d+(?:\.\d+)?m|\d+m\d+)$/.test(text)) format = "meters";
    else if (/^\d+点$/.test(text)) format = "points";
    else format = inferredTimeFormat(initial);
  }
  return {
    ...preset,
    format,
    wind: format !== "points" && (preset.wind || initial.wind != null),
    distanceLabel: format === "meters" ? preset.distanceLabel : distanceLabel,
  };
}

/** 構造化済みの値を優先し、旧自由入力だけを選択した単位で読み替える。 */
export function initialResultValues(
  initial: InitialResult | undefined,
  format: ResultInputFormat,
): InitialResultValues {
  const empty: InitialResultValues = { value_cs: null, value_cm: null, value_points: null };
  if (!initial) return empty;
  if (initial.value_cs != null || initial.value_cm != null || initial.value_points != null)
    return {
      value_cs: initial.value_cs ?? null,
      value_cm: initial.value_cm ?? null,
      value_points: initial.value_points ?? null,
    };
  const text = recordText(initial);
  if (format === "meters")
    return { ...empty, value_cm: /^\d+m\d+$/i.test(text)
      ? parseRecordText(text, "distance")?.value_cm ?? null
      : parseDecimalMetres(text) };
  if (format === "points")
    return { ...empty, value_points: parseRecordText(text, "points")?.value_points ?? null };
  // parseRecordText は秒の整数部が2桁まで。旧 61.85/200.15 等も読めるようにする。
  return {
    ...empty,
    value_cs: isPlainSeconds(text)
      ? parseDecimalSeconds(text)
      : parseRecordText(text, "time")?.value_cs ?? null,
  };
}
