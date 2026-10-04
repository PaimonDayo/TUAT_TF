import Papa from "papaparse";
import type {
  MiddleLongMenuSnapshot,
  MiddleLongSheetMenuRow,
} from "@/lib/middle-long-menu-data";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";

const BASE_URL = "https://docs.google.com/spreadsheets/d";
const MENU_SHEET_NAME = /^(\d{1,2})月メニュー$/;
const FETCH_TIMEOUT_MS = 6_000;
const META_CACHE_MS = 3_600_000;
const ROWS_CACHE_MS = 60_000;
let metadataCache: { spreadsheetId: string; expiresAt: number; tabs: SheetTab[] } | null = null;
/**
 * 取り込んだ月のメニューを短時間だけ覚えておく。ホームと予定は開くたびにここを通るので、
 * 覚えていないと1画面ごとにGoogleへ数本の取得が走り、その分だけ表示が遅れる。
 * 60秒で捨てる。Nextの共有fetchキャッシュにも同じ有効期間を指定する。
 */
const rowsCache = new Map<string, { expiresAt: number; rows: MiddleLongSheetMenuRow[] }>();
// キャッシュが空・期限切れの瞬間も、同じ取得を人数分並べない。
const pendingMetadata = new Map<string, Promise<SheetTab[]>>();
const pendingRows = new Map<string, Promise<MiddleLongSheetMenuRow[]>>();


type SheetTab = { name: string; gid: string; month: number };

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

/** 月別シート（A:H = 日付〜補強）を予定・メニュー表示用データへ変換する。 */
export function parseMiddleLongMenuCsv(csv: string, sourceMonth: number): MiddleLongSheetMenuRow[] {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: false });
  const fatal = parsed.errors.find((error) => error.type === "Quotes");
  if (fatal) throw new Error(`メニューのCSVを読み取れませんでした: ${fatal.message}`);
  return parsed.data.flatMap((rawRow) => {
    const row = rawRow.map((cell) => String(cell ?? ""));
    const date = parseDateCell(row[0] ?? "");
    if (!date) return [];
    const time = (row[2] ?? "").trim();
    const location = (row[3] ?? "").trim();
    const content = (row[4] ?? "").replace(/\\n/g, "\n").trim();
    const pace = (row[5] ?? "").replace(/\\n/g, "\n").trim();
    const remark = (row[6] ?? "").replace(/\\n/g, "\n").trim();
    const supplement = (row[7] ?? "").replace(/\\n/g, "\n").trim();
    if (!time && !location && !content && !pace && !remark && !supplement) return [];
    return [{ ...date, sourceMonth, time, location, content, pace, remark, supplement }];
  });
}

async function fetchWithTimeout(url: string, revalidateSeconds: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { next: { revalidate: revalidateSeconds }, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMenuTabs(id: string): Promise<SheetTab[]> {
  if (metadataCache?.spreadsheetId === id && metadataCache.expiresAt > Date.now()) {
    return metadataCache.tabs;
  }
  const pending = pendingMetadata.get(id);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/${encodeURIComponent(id)}/htmlview`, META_CACHE_MS / 1000);
    if (!response.ok) throw new Error(`メニューのシート一覧を取得できませんでした (${response.status})`);
    const tabs = parseMenuTabs(await response.text());
    if (tabs.length === 0) throw new Error("公開ブックの月別メニューを取得できませんでした");
    metadataCache = { spreadsheetId: id, expiresAt: Date.now() + META_CACHE_MS, tabs };
    return tabs;
  })();
  pendingMetadata.set(id, request);
  try { return await request; } finally { pendingMetadata.delete(id); }
}

async function fetchMenuRows(id: string, tab: SheetTab): Promise<MiddleLongSheetMenuRow[]> {
  const cacheKey = `${id}:${tab.gid}:${tab.month}`;
  const cached = rowsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const pending = pendingRows.get(cacheKey);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetchWithTimeout(
      `${BASE_URL}/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(tab.gid)}`,
      ROWS_CACHE_MS / 1000,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csv = await response.text();
    if (/^\s*(?:<!doctype|<html)/i.test(csv)) throw new Error("HTML response");
    const rows = parseMiddleLongMenuCsv(csv, tab.month);
    rowsCache.set(cacheKey, { expiresAt: Date.now() + ROWS_CACHE_MS, rows });
    return rows;
  })();
  pendingRows.set(cacheKey, request);
  try { return await request; } finally { pendingRows.delete(cacheKey); }
}

/** 必要な月のCSVだけを並列取得する。失敗月はloadedMonthsに含めない。 */
export async function fetchMiddleLongMenuSnapshot(months: number[]): Promise<MiddleLongMenuSnapshot> {
  // 記録連携のSHEET_SYNC_SPREADSHEET_IDは旧ブックを指す場合がある。
  // メニューは依頼された2026年10月開始の公開ブックから読む。
  const id = OCTOBER_SHEET_ID;
  if (months.length === 0) return { rows: [], loadedMonths: [] };
  const wanted = new Set(months.filter((month) => month >= 1 && month <= 12));
  const tabs = (await fetchMenuTabs(id)).filter((tab) => wanted.has(tab.month));
  if (tabs.length === 0) throw new Error("指定した月のメニューシートが見つかりません");
  const results = await Promise.allSettled(
    tabs.map(async (tab) => {
      const rows = await fetchMenuRows(id, tab);
      return { month: tab.month, rows };
    }),
  );
  const loadedMonths: number[] = [];
  const rows: MiddleLongSheetMenuRow[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    loadedMonths.push(result.value.month);
    rows.push(...result.value.rows);
  }
  if (loadedMonths.length === 0) throw new Error("月別メニューのCSVを取得できませんでした");
  return { rows, loadedMonths };
}
