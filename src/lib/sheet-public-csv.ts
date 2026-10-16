import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";
import Papa from "papaparse";
import { createHash } from "node:crypto";

export type RawMember = {
  name: string;
  gid?: string;
  columns?: { index: number; label: string }[];
  header: string[];
  records: { date: string; cells: Record<string, string>; values?: string[] }[];
};

export type SheetMember = { name: string; gid: string };
export type PublicMemberSnapshot = {
  signature: string;
  member: RawMember | null;
};

const BASE_URL = "https://docs.google.com/spreadsheets/d";
const MEMBER_SHEET = /^[BM]\d/;
const META_CACHE_MS = 60_000;

let metadataCache: { spreadsheetId: string; expiresAt: number; members: SheetMember[] } | null = null;

function spreadsheetId(): string {
  const value = process.env.SHEET_SYNC_SPREADSHEET_ID?.trim();
  if (!value) throw new Error("SHEET_SYNC_SPREADSHEET_ID is not configured");
  return value;
}

function canonicalName(value: string): string {
  return value.normalize("NFC").trim();
}

function decodeJsString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

/** Google Sheets の htmlview に埋め込まれたタブ名とGIDを抽出する。 */
export function parseSheetMetadataHtml(html: string): SheetMember[] {
  const members = new Map<string, SheetMember>();
  const itemPattern = /items\.push\(\s*({[^}]+})\s*\)/g;
  let item: RegExpExecArray | null;
  while ((item = itemPattern.exec(html)) !== null) {
    const name = /name:\s*"((?:\\.|[^"\\])*)"/.exec(item[1]);
    const gid = /gid:\s*"(\d+)"/.exec(item[1]);
    if (!name || !gid) continue;
    const decodedName = canonicalName(decodeJsString(name[1]));
    if (!MEMBER_SHEET.test(decodedName)) continue;
    members.set(decodedName, { name: decodedName, gid: gid[1] });
  }
  return [...members.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function currentYearJst(): number {
  return Number(
    new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric" }).format(new Date()),
  );
}

/** 表示値の M/D・YYYY/M/D・YYYY-MM-DD をDB用の日付へ変換する。 */
export function parsePublicSheetDate(raw: string, defaultYear = currentYearJst()): string | null {
  const value = raw.trim().split(/\s+/)[0];
  if (!value) return null;
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/.exec(value);
    if (!match) return null;
    year = match[1] ? Number(match[1]) : defaultYear;
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() !== month - 1 ||
    checked.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const normalizeHeader = (value: string) => value.replace(/\s+/g, "").trim();

/** 1タブ分の公開CSVを、従来のGAS readMemberSheetと同じ形へ変換する。 */
export function parseMemberCsv(member: SheetMember, csv: string, defaultYear = currentYearJst(), startMonth?: number): RawMember {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const fatal = parsed.errors.find((error) => error.type === "Quotes");
  if (fatal) throw new Error(`CSVを読み取れませんでした: ${fatal.message}`);
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "")));
  const headerIndex = rows
    .slice(0, 15)
    .findIndex((row) => row.some((cell) => normalizeHeader(cell) === "日付"));
  if (headerIndex === -1) throw new Error("見出し行（日付）が見つかりません");

  const fullHeader = rows[headerIndex].map((cell) => cell.trim());
  const dateColumn = fullHeader.findIndex((cell) => normalizeHeader(cell) === "日付");
  const records: RawMember["records"] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const rawDate = row[dateColumn] ?? "";
    const shortDate = /^(\d{1,2})\/(\d{1,2})(?:\s|$)/.exec(rawDate.trim());
    const year = startMonth && shortDate && Number(shortDate[1]) < startMonth ? defaultYear + 1 : defaultYear;
    const date = parsePublicSheetDate(rawDate, year);
    if (!date) continue;
    const cells: Record<string, string> = {};
    for (let column = 0; column < fullHeader.length; column++) {
      const key = fullHeader[column];
      if (key && cells[key] === undefined) cells[key] = row[column] ?? "";
    }
    records.push({ date, cells, values: row });
  }

  return {
    name: member.name,
    gid: member.gid,
    columns: fullHeader.map((label, index) => ({ index, label })).filter((column) => Boolean(column.label)),
    header: fullHeader.filter(Boolean),
    records,
  };
}

/** One deadline covers headers and bounded body bytes; retain each caller's cache policy. */
export async function fetchPublicSheetText(url: string, timeoutMs: number, maxBytes: number, init: RequestInit) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("公開シートの取得がタイムアウトしました")); }, timeoutMs);
  });
  try {
    const response = await Promise.race([fetch(url, { ...init, redirect: "follow", signal: controller.signal }), deadline]);
    reader = response.body?.getReader();
    if (!response.ok) return { response, text: "" };
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("公開シートの容量が上限を超えています");
    const decoder = new TextDecoder(), chunks: string[] = [];
    let bytes = 0;
    if (reader) for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("公開シートの容量が上限を超えています");
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { response, text: chunks.join("") };
  } finally {
    clearTimeout(timer);
    // A failed or interrupted stream may never settle its cancellation promise.
    void reader?.cancel().catch(() => undefined);
  }
}

export async function fetchPublicSheetMembers(targetSpreadsheetId?: string): Promise<SheetMember[]> {
  const id = targetSpreadsheetId ?? spreadsheetId();
  if (metadataCache?.spreadsheetId === id && metadataCache.expiresAt > Date.now()) {
    return metadataCache.members;
  }
  const { response, text: html } = await fetchPublicSheetText(`${BASE_URL}/${encodeURIComponent(id)}/htmlview`, 10_000, 4 * 1024 ** 2, { cache: "no-store" });
  if (!response.ok) throw new Error(`シート一覧を取得できませんでした (${response.status})`);
  const members = parseSheetMetadataHtml(html);
  if (members.length === 0) {
    throw new Error("公開シートから部員タブを取得できませんでした。スプレッドシートIDと公開状態を確認してください");
  }
  metadataCache = { spreadsheetId: id, expiresAt: Date.now() + META_CACHE_MS, members };
  return members;
}

export async function fetchPublicMember(
  memberName: string,
  opts: { timeoutMs?: number; members?: SheetMember[]; spreadsheetId?: string } = {},
): Promise<RawMember> {
  const snapshot = await fetchPublicMemberSnapshot(memberName, { ...opts, forceParse: true });
  if (!snapshot.member) throw new Error("CSVを解析できませんでした");
  return snapshot.member;
}

export function sheetContentSignature(csv: string): string {
  return createHash("sha256").update(csv, "utf8").digest("hex");
}

/**
 * CSV本文を先にハッシュ化し、前回と同じなら重いCSV解析を省略する。
 * pending write-throughの再送時だけ forceParse で内容を復元する。
 */
export async function fetchPublicMemberSnapshot(
  memberName: string,
  opts: {
    timeoutMs?: number;
    spreadsheetId?: string;
    members?: SheetMember[];
    expectedSignature?: string | null;
    forceParse?: boolean;
  } = {},
): Promise<PublicMemberSnapshot> {
  const members = opts.members ?? (await fetchPublicSheetMembers(opts.spreadsheetId));
  const wanted = canonicalName(memberName);
  const member = members.find((candidate) => canonicalName(candidate.name) === wanted);
  if (!member) throw new Error(`部員シート「${memberName}」が見つかりません`);
  const id = opts.spreadsheetId ?? spreadsheetId();
  const url = `${BASE_URL}/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(member.gid)}&t=${Date.now()}`;
  const { response, text: csv } = await fetchPublicSheetText(url, opts.timeoutMs ?? 10_000, 16 * 1024 ** 2, { cache: "no-store" });
  if (!response.ok) throw new Error(`CSVを取得できませんでした (${response.status})`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const startsAsHtml = /^\s*(?:<!doctype|<html)/i.test(csv);
  if (contentType.includes("text/html") || startsAsHtml) {
    throw new Error("CSVではなくHTMLが返されました。公開状態を確認してください");
  }
  const signature = sheetContentSignature(csv);
  return {
    signature,
    member: !opts.forceParse && opts.expectedSignature === signature
      ? null
      : parseMemberCsv(member, csv, id === OCTOBER_SHEET_ID ? 2026 : currentYearJst(), id === OCTOBER_SHEET_ID ? 10 : undefined),
  };
}
