// 大会プログラム（速報サイトのタイムテーブルから、農工大の出場種目・出場選手を抽出する）。
// 対象サイトはShift_JISで配信されるため、フェッチ側でArrayBufferのまま渡してもらい、
// ここでデコードしてから解析する。

export type ProgramBlock = "track" | "field";

export interface ProgramAthlete {
  heat: number | null;
  lane: number;
  bib: string | null;
  name: string;
  grade: string;
}

export interface ParsedProgramRow {
  eventDate: string; // yyyy-mm-dd
  block: ProgramBlock;
  sortOrder: number;
  timeLabel: string | null; // "09:00" 形式
  roundKey: string;
  eventLabel: string;
  status: string | null;
  tuatEntries: ProgramAthlete[];
}

const TUAT_ABBREVIATION = "農工大";

export function decodeShiftJisHtml(buffer: ArrayBuffer): string {
  return new TextDecoder("shift_jis").decode(buffer);
}

function gradeShortFromRaw(raw: string): string {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? `B${trimmed}` : trimmed;
}

function parseIndividualRows(segment: string): Omit<ProgramAthlete, "heat">[] {
  const re = /<tr><td>(\d+)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g;
  const out: Omit<ProgramAthlete, "heat">[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) {
    const [, lane, bib, name, grade, univ] = m;
    if (!bib.trim() || bib.includes("&nbsp;")) continue;
    if (!univ.startsWith(TUAT_ABBREVIATION)) continue;
    out.push({ lane: Number(lane), bib: bib.trim(), name: name.trim(), grade: gradeShortFromRaw(grade) });
  }
  return out;
}

function parseRelayRows(segment: string): Omit<ProgramAthlete, "heat">[] {
  const re = /<tr><td>(\d+)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g;
  const out: Omit<ProgramAthlete, "heat">[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) {
    const lane = Number(m[1]);
    const univ = m[2].trim();
    if (univ !== TUAT_ABBREVIATION) continue;
    for (let i = 3; i <= 8; i++) {
      const cell = m[i].trim();
      if (!cell || cell.includes("&nbsp;")) continue;
      const nm = cell.match(/^(.+?)\s?((?:[BMD])?\d{1,2})$/);
      if (!nm) continue;
      out.push({ lane, bib: null, name: nm[1].trim(), grade: gradeShortFromRaw(nm[2]) });
    }
  }
  return out;
}

function parseDetailBlock(raw: string | undefined, isRelay: boolean): ProgramAthlete[] {
  if (!raw) return [];
  const heatSplit = raw.split(/【(\d+)組】/);
  const entries: ProgramAthlete[] = [];
  if (heatSplit.length === 1) {
    const parsed = isRelay ? parseRelayRows(raw) : parseIndividualRows(raw);
    for (const p of parsed) entries.push({ heat: null, ...p });
  } else {
    for (let i = 1; i < heatSplit.length; i += 2) {
      const heatNo = Number(heatSplit[i]);
      const segment = heatSplit[i + 1] ?? "";
      const parsed = isRelay ? parseRelayRows(segment) : parseIndividualRows(segment);
      for (const p of parsed) entries.push({ heat: heatNo, ...p });
    }
  }
  return entries;
}

/** タイムテーブルHTML（デコード済みテキスト）を解析し、農工大の出場エントリー付きでプログラム順の行を返す。 */
export function parseCompetitionProgram(html: string, year: number): ParsedProgramRow[] {
  const programEndIdx = html.search(/<H2><A Name=/);
  const programText = programEndIdx === -1 ? html : html.slice(0, programEndIdx);
  const detailText = programEndIdx === -1 ? "" : html.slice(programEndIdx);

  type ProgramHeader = { date: string; block: ProgramBlock; sortOrder: number; timeLabel: string; roundKey: string; eventLabel: string; status: string };
  const headers: ProgramHeader[] = [];
  const dateChunks = programText.split(/<H3>(\d{2})\/(\d{2})<\/H3>/).slice(1);
  for (let i = 0; i < dateChunks.length; i += 3) {
    const month = dateChunks[i];
    const day = dateChunks[i + 1];
    const chunk = dateChunks[i + 2];
    const eventDate = `${year}-${month}-${day}`;
    const rowRe = /<tr><td colspan=3><B>\s*(トラック|フィールド)\s*<\/B><\/td><\/tr>|<tr><td>(\d{2}:\d{2})<\/td><td><A Href='#([\d-]+)'>([^<]*)<\/A><\/td><td[^>]*>([^<]*)<\/td><\/tr>/g;
    let block: ProgramBlock | null = null;
    let sortOrder = 0;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(chunk))) {
      if (m[1]) {
        block = m[1] === "トラック" ? "track" : "field";
        sortOrder = 0;
        continue;
      }
      if (!block) continue;
      sortOrder += 1;
      headers.push({ date: eventDate, block, sortOrder, timeLabel: m[2], roundKey: m[3], eventLabel: m[4], status: m[5] });
    }
  }

  const blocks = new Map<string, string>();
  const headerRe = /<H2><A Name='([\d-]+)'>/g;
  const starts: { key: string; idx: number }[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(detailText))) starts.push({ key: hm[1], idx: hm.index });
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].idx;
    const end = i + 1 < starts.length ? starts[i + 1].idx : detailText.length;
    blocks.set(starts[i].key, detailText.slice(start, end));
  }

  return headers.map((header) => ({
    eventDate: header.date,
    block: header.block,
    sortOrder: header.sortOrder,
    timeLabel: header.timeLabel,
    roundKey: header.roundKey,
    eventLabel: header.eventLabel,
    status: header.status || null,
    tuatEntries: parseDetailBlock(blocks.get(header.roundKey), header.eventLabel.includes("×")),
  }));
}

/** 全角英数記号（U+FF01〜U+FF5E）を半角へ。日本語文字はこの範囲外なのでそのまま残る。 */
function toHalfWidth(text: string): string {
  return text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 表示用に全角数字・記号を半角へ、「オープン」を「OP」へ整える（ホームカードの限られた幅向け）。 */
export function formatProgramEventLabel(label: string): string {
  return toHalfWidth(label.replace(/オープン/g, "OP")).replace(/\s+/g, " ").trim();
}

/** 「B2山田」のように学年+苗字だけの短い表示にする。 */
export function formatAthleteLabel(entry: ProgramAthlete): string {
  const surname = entry.name.trim().split(/\s+/)[0] ?? entry.name;
  return `${entry.grade}${surname}`;
}

export function formatAthleteList(entries: ProgramAthlete[]): string {
  return entries.map(formatAthleteLabel).join("、");
}

/** プログラム詳細ページ向け。組・レーン番号も添える（例: 「2組3番 B2山田」）。 */
export function formatAthletePosition(entry: ProgramAthlete): string {
  const heat = entry.heat ? `${entry.heat}組` : "";
  return `${heat}${entry.lane}番 ${formatAthleteLabel(entry)}`;
}

export interface ProgramDateGroup {
  date: string;
  track: ParsedProgramRow[];
  field: ParsedProgramRow[];
}

/** 日付ごと・トラック/フィールド別、プログラム順にまとめる。 */
export function groupProgramByDate(rows: ParsedProgramRow[]): ProgramDateGroup[] {
  const byDate = new Map<string, ProgramDateGroup>();
  for (const row of rows) {
    let group = byDate.get(row.eventDate);
    if (!group) {
      group = { date: row.eventDate, track: [], field: [] };
      byDate.set(row.eventDate, group);
    }
    group[row.block].push(row);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((group) => ({
      date: group.date,
      track: [...group.track].sort((a, b) => a.sortOrder - b.sortOrder),
      field: [...group.field].sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}

/** DBから読んだ行（スネークケース）を、パース結果と同じ形へ揃える。 */
export function fromStoredProgramRow(row: {
  event_date: string;
  block: ProgramBlock;
  sort_order: number;
  time_label: string | null;
  round_key: string | null;
  event_label: string;
  status: string | null;
  tuat_entries: ProgramAthlete[];
}): ParsedProgramRow {
  return {
    eventDate: row.event_date,
    block: row.block,
    sortOrder: row.sort_order,
    timeLabel: row.time_label,
    roundKey: row.round_key ?? "",
    eventLabel: row.event_label,
    status: row.status,
    tuatEntries: row.tuat_entries,
  };
}

/**
 * 「いま行われている」種目を1件返す（無ければnull）。対象日・ブロックの中で、
 * 開始時刻が現在時刻以下の行のうち最も遅いものを選び、農工大の出場者がいない回は対象外にする
 * （名前を出せない「競技中」表示は避ける）。
 */
export function currentProgramRow(
  rows: ParsedProgramRow[],
  todayIso: string,
  nowLabel: string,
  block: ProgramBlock,
): ParsedProgramRow | null {
  const candidates = rows.filter(
    (row) =>
      row.eventDate === todayIso &&
      row.block === block &&
      row.timeLabel !== null &&
      row.timeLabel <= nowLabel &&
      row.tuatEntries.length > 0,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.timeLabel!.localeCompare(b.timeLabel!) || a.sortOrder - b.sortOrder);
  return candidates[candidates.length - 1];
}
