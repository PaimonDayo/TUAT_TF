import Papa from "papaparse";
import type {
  MiddleLongMenuSnapshot,
  MiddleLongSheetMenuRow,
} from "@/lib/middle-long-menu-data";

const BASE_URL = "https://docs.google.com/spreadsheets/d";
const MENU_SHEET_NAME = /^(\d{1,2})月メニュー$/;
const FETCH_TIMEOUT_MS = 6_000;
const META_CACHE_MS = 60_000;
let metadataCache: { spreadsheetId: string; expiresAt: number; tabs: SheetTab[] } | null = null;


type SheetTab = { name: string; gid: string; month: number };

function spreadsheetId(): string | null {
  return process.env.SHEET_SYNC_SPREADSHEET_ID?.trim() || null;
}

function decodeJsString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function parseMenuTabs(html: string): SheetTab[] {
  const tabs: SheetTab[] = [];
  const itemPattern = /items\.push\(\s*({[^}]+})\s*\)/g;
  let item: RegExpExecArray | null;
  while ((item = itemPattern.exec(html)) !== null) {
    const nameMatch = /name:\s*"((?:\\.|[^"\\])*)"/.exec(item[1]);
    const gidMatch = /gid:\s*"(\d+)"/.exec(item[1]);
    if (!nameMatch || !gidMatch) continue;
    const name = decodeJsString(nameMatch[1]).normalize("NFC").trim();
    const menuMatch = MENU_SHEET_NAME.exec(name);
    if (!menuMatch) continue;
    const month = Number(menuMatch[1]);
    if (month >= 1 && month <= 12) tabs.push({ name, gid: gidMatch[1], month });
  }
  return tabs;
}

function parseDateCell(value: string): { exactDate: string | null; monthDay: string } | null {
  const normalized = value.trim().split(/\s+/)[0];
  let year: number | null = null;
  let month: number;
  let day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/.exec(normalized);
    if (!match) return null;
    year = match[1] ? Number(match[1]) : null;
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const checked = new Date(Date.UTC(year ?? 2000, month - 1, day));
  if (checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return null;
  const monthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    exactDate: year === null ? null : `${String(year).padStart(4, "0")}-${monthDay}`,
    monthDay,
  };
}

/** 旧アプリと同じ月別シート（A:H = 日付〜補強）を表示用データへ変換する。 */
export function parseMiddleLongMenuCsv(csv: string, sourceMonth: number): MiddleLongSheetMenuRow[] {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const fatal = parsed.errors.find((error) => error.type === "Quotes");
  if (fatal) throw new Error(`メニューCSVの解析に失敗しました: ${fatal.message}`);
  return parsed.data.flatMap((rawRow) => {
    const row = rawRow.map((cell) => String(cell ?? ""));
    const date = parseDateCell(row[0] ?? "");
    if (!date) return [];
    const location = (row[3] ?? "").trim();
    const content = (row[4] ?? "").replace(/\\n/g, "\n").trim();
    const pace = (row[5] ?? "").replace(/\\n/g, "\n").trim();
    const remark = (row[6] ?? "").replace(/\\n/g, "\n").trim();
    const supplement = (row[7] ?? "").replace(/\\n/g, "\n").trim();
    if (!location && !content && !pace && !remark && !supplement) return [];
    return [{ ...date, sourceMonth, content, pace, remark, supplement }];
  });
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { cache: "no-store", redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMenuTabs(id: string): Promise<SheetTab[]> {
  if (metadataCache?.spreadsheetId === id && metadataCache.expiresAt > Date.now()) {
    return metadataCache.tabs;
  }
  const response = await fetchWithTimeout(`${BASE_URL}/${encodeURIComponent(id)}/htmlview`);
  if (!response.ok) return [];
  const tabs = parseMenuTabs(await response.text());
  metadataCache = { spreadsheetId: id, expiresAt: Date.now() + META_CACHE_MS, tabs };
  return tabs;
}

/** 必要な月のCSVだけを並列取得する。失敗月はloadedMonthsに含めない。 */
export async function fetchMiddleLongMenuSnapshot(months: number[]): Promise<MiddleLongMenuSnapshot> {
  const id = spreadsheetId();
  if (!id || months.length === 0) return { rows: [], loadedMonths: [] };
  try {
    const wanted = new Set(months.filter((month) => month >= 1 && month <= 12));
    const tabs = (await fetchMenuTabs(id)).filter((tab) => wanted.has(tab.month));
    const results = await Promise.allSettled(
      tabs.map(async (tab) => {
        const response = await fetchWithTimeout(
          `${BASE_URL}/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(tab.gid)}&t=${Date.now()}`,
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const csv = await response.text();
        if (/^\s*(?:<!doctype|<html)/i.test(csv)) throw new Error("HTML response");
        return { month: tab.month, rows: parseMiddleLongMenuCsv(csv, tab.month) };
      }),
    );
    const loadedMonths: number[] = [];
    const rows: MiddleLongSheetMenuRow[] = [];
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      loadedMonths.push(result.value.month);
      rows.push(...result.value.rows);
    }
    return { rows, loadedMonths };
  } catch {
    return { rows: [], loadedMonths: [] };
  }
}
