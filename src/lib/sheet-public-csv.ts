import Papa from "papaparse";
import type { RawSheetReply } from "@/lib/sheet-replies";

export type RawMember = {
  name: string;
  gid?: string;
  header: string[];
  records: { date: string; cells: Record<string, string>; replies?: RawSheetReply[] }[];
};

export type SheetMember = { name: string; gid: string };

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

function commentColumn(header: string[]): number {
  const keywords = ["感想", "コメント", "反省", "状態"];
  return header.findIndex((cell) => keywords.some((keyword) => normalizeHeader(cell).includes(keyword)));
}

/** 1タブ分の公開CSVを、従来のGAS readMemberSheetと同じ形へ変換する。 */
export function parseMemberCsv(member: SheetMember, csv: string, defaultYear = currentYearJst()): RawMember {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const fatal = parsed.errors.find((error) => error.type === "Quotes");
  if (fatal) throw new Error(`CSVの解析に失敗しました: ${fatal.message}`);
  const rows = parsed.data.map((row) => row.map((cell) => String(cell ?? "")));
  const headerIndex = rows
    .slice(0, 15)
    .findIndex((row) => row.some((cell) => normalizeHeader(cell) === "日付"));
  if (headerIndex === -1) throw new Error("見出し行（日付）が見つかりません");

  const fullHeader = rows[headerIndex].map((cell) => cell.trim());
  const replyStart = commentColumn(fullHeader);
  const records: RawMember["records"] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const date = parsePublicSheetDate(row[0] ?? "", defaultYear);
    if (!date) continue;
    const cells: Record<string, string> = {};
    for (let column = 0; column < fullHeader.length; column++) {
      const key = fullHeader[column];
      if (key && cells[key] === undefined) cells[key] = row[column] ?? "";
    }
    const replies: RawSheetReply[] = [];
    if (replyStart !== -1) {
      for (let column = replyStart + 1; column < row.length; column++) {
        if ((fullHeader[column] ?? "").trim()) continue;
        const content = (row[column] ?? "").trim();
        if (content) replies.push({ replyIndex: column, content, source: "sheet" });
      }
    }
    records.push({ date, cells, replies });
  }

  return {
    name: member.name,
    gid: member.gid,
    header: fullHeader.filter(Boolean),
    records,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublicSheetMembers(): Promise<SheetMember[]> {
  const id = spreadsheetId();
  if (metadataCache?.spreadsheetId === id && metadataCache.expiresAt > Date.now()) {
    return metadataCache.members;
  }
  const response = await fetchWithTimeout(`${BASE_URL}/${encodeURIComponent(id)}/htmlview`, 10_000);
  if (!response.ok) throw new Error(`シート一覧の取得に失敗しました (${response.status})`);
  const html = await response.text();
  const members = parseSheetMetadataHtml(html);
  if (members.length === 0) {
    throw new Error("公開シートから部員タブを取得できませんでした。スプレッドシートIDと公開状態を確認してください");
  }
  metadataCache = { spreadsheetId: id, expiresAt: Date.now() + META_CACHE_MS, members };
  return members;
}

export async function fetchPublicMember(
  memberName: string,
  opts: { timeoutMs?: number; members?: SheetMember[] } = {},
): Promise<RawMember> {
  const members = opts.members ?? (await fetchPublicSheetMembers());
  const wanted = canonicalName(memberName);
  const member = members.find((candidate) => canonicalName(candidate.name) === wanted);
  if (!member) throw new Error(`部員シート「${memberName}」が見つかりません`);
  const id = spreadsheetId();
  const url = `${BASE_URL}/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(member.gid)}&t=${Date.now()}`;
  const response = await fetchWithTimeout(url, opts.timeoutMs ?? 10_000);
  if (!response.ok) throw new Error(`CSVの取得に失敗しました (${response.status})`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const csv = await response.text();
  const startsAsHtml = /^\s*(?:<!doctype|<html)/i.test(csv);
  if (contentType.includes("text/html") || startsAsHtml) {
    throw new Error("CSVではなくHTMLが返されました。公開状態を確認してください");
  }
  return parseMemberCsv(member, csv);
}
