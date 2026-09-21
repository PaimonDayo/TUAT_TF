// 大会プログラム（速報サイトのタイムテーブルから、農工大の出場種目・出場選手を抽出する）。
// 対象サイトはShift_JISで配信されるため、フェッチ側でArrayBufferのまま渡してもらい、
// ここでデコードしてから解析する。

export type ProgramBlock = "track" | "field";

export interface ProgramAthlete {
  heat: number | null;
  lane: number | null;
  bib: string | null;
  name: string;
  grade: string;
  result?: { place: string | null; record: string; wind?: string };
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

function cellText(html: string): string {
  return html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

function parseResultRows(segment: string, isRelay: boolean): ProgramAthlete[] {
  const entries: ProgramAthlete[] = [];
  const wind = segment.match(/風(?:速)?\s*[:：]?\s*([+-]?\d+\.\d+)/)?.[1];
  for (const row of segment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => cellText(m[1]));
    const team = cells[isRelay ? 2 : 4];
    if (!team?.startsWith(TUAT_ABBREVIATION) || !cells[1]) continue;
    const result = { place: /^\d+$/.test(cells[0]) ? cells[0] : null, record: cells[1], ...(wind ? { wind } : {}) };
    if (isRelay) {
      for (const cell of cells.slice(3)) {
        const name = cell.match(/^(.+?)\s?((?:[BMD])?\d{1,2})$/);
        if (name) entries.push({ heat: null, lane: null, bib: null, name: name[1].trim(), grade: gradeShortFromRaw(name[2]), result });
      }
    } else {
      entries.push({ heat: null, lane: null, bib: null, name: cells[2], grade: gradeShortFromRaw(cells[3]), result });
    }
  }
  return entries;
}

function parseDetailBlock(raw: string | undefined, isRelay: boolean): ProgramAthlete[] {
  if (!raw) return [];
  const heatSplit = raw.split(/【(\d+)組】/);
  const entries: ProgramAthlete[] = [];
  const read = (segment: string, heat: number | null) => {
    if (/<b>\s*結果\s*<\/b>/i.test(segment)) {
      entries.push(...parseResultRows(segment, isRelay).map(entry => ({ ...entry, heat })));
    } else {
      const parsed = isRelay ? parseRelayRows(segment) : parseIndividualRows(segment);
      entries.push(...parsed.map(entry => ({ ...entry, heat })));
    }
  };
  if (heatSplit.length === 1) read(raw, null);
  else for (let i = 1; i < heatSplit.length; i += 2) read(heatSplit[i + 1] ?? "", Number(heatSplit[i]));
  return entries;
}

/** Result pages replace bib/lane columns; keep earlier start positions only for an unambiguous match. */
export function retainProgramPositions(rows: ParsedProgramRow[], previous: ParsedProgramRow[]): ParsedProgramRow[] {
  return rows.map(row => {
    const old = previous.find(p => p.roundKey === row.roundKey && p.eventDate === row.eventDate);
    return { ...row, tuatEntries: row.tuatEntries.map(entry => {
      if (!entry.result || !old) return entry;
      const matches = old.tuatEntries.filter(e => e.name === entry.name && e.grade === entry.grade && e.heat === entry.heat);
      return matches.length === 1 ? { ...entry, lane: matches[0].lane, bib: matches[0].bib } : entry;
    }) };
  });
}

export function validateProgramImport(html: string, rows: ParsedProgramRow[], previousCount: number): void {
  if (!/<\/html>/i.test(html) || rows.length === 0 || rows.length < previousCount * 0.8) {
    throw new Error("取得ページが不完全なため、前回のプログラムを保持しました");
  }
  if (new Set(rows.map(r => `${r.eventDate}/${r.block}/${r.roundKey}`)).size !== rows.length) {
    throw new Error("プログラムの種目が重複しています");
  }
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

/** 種目名の末尾に付く「(2組2着+2)」のような組数・通過条件の注記。 */
const ROUND_NOTE_RE = /[（(]\s*(\d+)組([^（()）]*)[)）]\s*$/;

/** 表示用に全角数字・記号を半角へ、「オープン」を「OP」へ整える（ホームカードの限られた幅向け）。 */
function normalizeEventText(label: string): string {
  return toHalfWidth(label.replace(/オープン/g, "OP")).replace(/\s+/g, " ").trim();
}

/**
 * 表示用の種目名。末尾の「(2組2着+2)」は種目全体の組数であって農工大が出る組ではなく、
 * 組番号と読み違えられるため外す（注記は programRoundNote で別に出す）。
 */
export function formatProgramEventLabel(label: string): string {
  return normalizeEventText(label)
    .replace(ROUND_NOTE_RE, "")
    // 「男子対校」は既定なので落とし、「男子オープン」はOPとして残す（区別が要るのはこちらだけ）。
    .replace(/対校/g, "")
    // 「110mH[1.067m/9.14m]」のような器具の規格は部員向けには不要な長さになる。
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/(\S)(予選|準決勝|決勝|タイムレース)/, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** 「全2組・2着+2」のような種目全体の注記。無ければ null。 */
export function programRoundNote(label: string): string | null {
  const match = normalizeEventText(label).match(ROUND_NOTE_RE);
  if (!match) return null;
  const condition = match[2].trim();
  return condition ? `全${match[1]}組・${condition}` : `全${match[1]}組`;
}

/** 農工大が出る組だけを「1組・3組」の形で返す。組の情報が無ければ null。 */
export function formatTuatHeats(entries: ProgramAthlete[]): string | null {
  const heats = [...new Set(entries.map((entry) => entry.heat).filter((heat): heat is number => heat !== null))];
  return heats.length === 0 ? null : heats.sort((a, b) => a - b).map((heat) => `${heat}組`).join("・");
}

/** 「B2山田」のように学年+苗字だけの短い表示にする。 */
export function formatAthleteLabel(entry: ProgramAthlete): string {
  const surname = entry.name.trim().split(/\s+/)[0] ?? entry.name;
  return `${entry.grade}${surname}`;
}

export function formatAthleteList(entries: ProgramAthlete[]): string {
  return entries.map(formatAthleteLabel).join("、");
}

/** 「2組3番」のような出走位置だけ。無ければ空文字。 */
export function formatPosition(entry: ProgramAthlete): string {
  return `${entry.heat ? `${entry.heat}組` : ""}${entry.lane !== null ? `${entry.lane}番` : ""}`;
}

/** プログラム詳細ページ向け。組・レーン番号も添える（例: 「2組3番 B2山田」）。 */
export function formatAthletePosition(entry: ProgramAthlete): string {
  return `${formatPosition(entry)} ${formatAthleteLabel(entry)}`.trim();
}

/**
 * 同じ組・レーンの選手（リレーの4人など）をひとまとめにする。
 * 「2組3番 B2山田 → 2組3番 B3佐藤 → …」と位置が繰り返されるのを防ぐ。
 */
export function groupEntriesByPosition(entries: ProgramAthlete[]): { position: string; entries: ProgramAthlete[] }[] {
  const groups: { position: string; entries: ProgramAthlete[] }[] = [];
  for (const entry of entries) {
    const position = formatPosition(entry);
    const last = groups.at(-1);
    if (last && last.position === position) last.entries.push(entry);
    else groups.push({ position, entries: [entry] });
  }
  return groups;
}

/** 位置をまとめた1行表示（例: 「2組3番 B2山田・B3佐藤」）。 */
export function formatEntryPositions(entries: ProgramAthlete[]): string {
  return groupEntriesByPosition(entries)
    .map(({ position, entries: members }) => `${position} ${members.map(formatAthleteLabel).join("・")}`.trim())
    .join("、");
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

/** 開始予定時刻に基づく目安。フィールドは並行開催されるため全件を残す。 */
export function currentProgramRows(
  rows: ParsedProgramRow[], todayIso: string, nowLabel: string,
): ParsedProgramRow[] {
  const started = rows.filter(row => row.eventDate === todayIso && row.timeLabel !== null && row.timeLabel <= nowLabel);
  // 農工大の出場者がいない次種目も、トラックの進行境界として扱う。
  const latestTrackTime = started.filter(row => row.block === "track").reduce((latest, row) => row.timeLabel! > latest ? row.timeLabel! : latest, "");
  return started.filter(row =>
    row.tuatEntries.length > 0 &&
    !/完了|終了|中止/.test(row.status ?? "") &&
    (row.block === "field" || !row.tuatEntries.every(entry => entry.result)) &&
    (row.block === "field" || row.timeLabel === latestTrackTime)
  ).sort((a, b) => a.timeLabel!.localeCompare(b.timeLabel!) || a.sortOrder - b.sortOrder);
}

/** 1件だけ必要な呼び出し向け。複数フィールドの表示には currentProgramRows を使う。 */
export function currentProgramRow(rows: ParsedProgramRow[], todayIso: string, nowLabel: string, block: ProgramBlock): ParsedProgramRow | null {
  return currentProgramRows(rows, todayIso, nowLabel).filter(row => row.block === block).at(-1) ?? null;
}

/** 次に農工大が出場するトラック・フィールドをそれぞれ返す。同時刻は全件表示。 */
export function nextProgramRows(rows: ParsedProgramRow[], todayIso: string, nowLabel: string): ParsedProgramRow[] {
  const future = rows.filter(row => row.timeLabel !== null &&
    (row.eventDate > todayIso || (row.eventDate === todayIso && row.timeLabel > nowLabel)) &&
    row.tuatEntries.length > 0 && !/完了|終了|中止/.test(row.status ?? "") &&
    !row.tuatEntries.every(entry => entry.result)
  ).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.timeLabel!.localeCompare(b.timeLabel!) || a.sortOrder - b.sortOrder);
  return future.filter(row => {
    const first = future.find(candidate => candidate.block === row.block)!;
    return row.eventDate === first.eventDate && row.timeLabel === first.timeLabel;
  });
}
