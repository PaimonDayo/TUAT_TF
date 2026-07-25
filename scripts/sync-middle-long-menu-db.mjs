import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

process.loadEnvFile?.(".env.local");

const apply = process.argv.includes("--apply");
const prune = process.argv.includes("--prune");
const targetYearArg = process.argv.find((arg) => arg.startsWith("--year="));
const targetYear = targetYearArg
  ? Number(targetYearArg.slice("--year=".length))
  : Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric" }).format(new Date()));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const spreadsheetId = process.env.SHEET_SYNC_SPREADSHEET_ID;
if (!supabaseUrl || !serviceRoleKey || !spreadsheetId) {
  throw new Error("Supabase or spreadsheet environment variables are missing");
}
if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2100) {
  throw new Error(`Invalid target year: ${targetYear}`);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function decodeJsString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function parseTabs(html) {
  const tabs = [];
  const itemPattern = /items\.push\(\s*({[^}]+})\s*\)/g;
  let item;
  while ((item = itemPattern.exec(html)) !== null) {
    const nameMatch = /name:\s*"((?:\\.|[^"\\])*)"/.exec(item[1]);
    const gidMatch = /gid:\s*"(\d+)"/.exec(item[1]);
    if (!nameMatch || !gidMatch) continue;
    const name = decodeJsString(nameMatch[1]).normalize("NFC").trim();
    const monthMatch = /^(\d{1,2})\u6708\u30e1\u30cb\u30e5\u30fc$/.exec(name);
    if (!monthMatch) continue;
    tabs.push({ name, gid: gidMatch[1], month: Number(monthMatch[1]) });
  }
  return tabs;
}

function parseDate(raw, sourceMonth) {
  const value = String(raw ?? "").trim().split(/\s+/)[0];
  let year = targetYear;
  let month;
  let day;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/.exec(value);
    if (!match) return null;
    year = match[1] ? Number(match[1]) : targetYear;
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (
    checked.getUTCFullYear() !== year ||
    checked.getUTCMonth() !== month - 1 ||
    checked.getUTCDate() !== day ||
    month !== sourceMonth
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeCell(value) {
  const normalized = String(value ?? "").replace(/\\n/g, "\n").trim();
  return normalized || null;
}

async function loadSheetRows() {
  const htmlResponse = await fetch(
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/htmlview`,
    { cache: "no-store", redirect: "follow" },
  );
  if (!htmlResponse.ok) throw new Error(`Sheet metadata HTTP ${htmlResponse.status}`);
  const tabs = parseTabs(await htmlResponse.text());
  if (tabs.length === 0) throw new Error("No monthly menu tabs were found");

  const rows = new Map();
  for (const tab of tabs) {
    const csvResponse = await fetch(
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(tab.gid)}&t=${Date.now()}`,
      { cache: "no-store", redirect: "follow" },
    );
    if (!csvResponse.ok) throw new Error(`${tab.name} HTTP ${csvResponse.status}`);
    const csv = await csvResponse.text();
    if (/^\s*(?:<!doctype|<html)/i.test(csv)) throw new Error(`${tab.name} returned HTML`);
    const parsed = Papa.parse(csv, { skipEmptyLines: false });
    const quoteError = parsed.errors.find((error) => error.type === "Quotes");
    if (quoteError) throw new Error(`${tab.name}: ${quoteError.message}`);
    for (const raw of parsed.data) {
      const date = parseDate(raw[0], tab.month);
      if (!date) continue;
      const row = {
        date,
        content: normalizeCell(raw[4]) ?? "",
        pace: normalizeCell(raw[5]),
        remark: normalizeCell(raw[6]),
      };
      if (!row.content && !row.pace && !row.remark) continue;
      if (!rows.has(date)) rows.set(date, row);
    }
  }
  return { tabs, rows };
}

async function loadExistingMenus() {
  const start = `${targetYear}-01-01`;
  const end = `${targetYear + 1}-01-01`;
  const { data, error } = await admin
    .from("practice_menus")
    .select(
      "id,schedule_id,author_id,target_block,status,content,pace,remark,supplement,created_at,updated_at,targets:practice_menu_targets(user_id),schedule:practice_schedules!inner(id,schedule_date,schedule_type,target_blocks)",
    )
    .eq("schedule.schedule_type", "practice")
    .gte("schedule.schedule_date", start)
    .lt("schedule.schedule_date", end)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).filter(
    (menu) =>
      (menu.targets?.length ?? 0) === 0 &&
      (menu.target_block === "middle_long" || menu.target_block === null),
  );
}

function changedFields(menu, sheet) {
  const fields = [];
  if ((menu.content ?? "") !== sheet.content) fields.push("content");
  if ((menu.pace || null) !== sheet.pace) fields.push("pace");
  if ((menu.remark || null) !== sheet.remark) fields.push("remark");
  if (menu.supplement !== null) fields.push("supplement");
  if (menu.target_block !== "middle_long") fields.push("target_block");
  if (menu.status !== "published") fields.push("status");
  return fields;
}

const { tabs, rows: sheetRows } = await loadSheetRows();
const menus = await loadExistingMenus();
const matches = [];
const skipped = [];
for (const menu of menus) {
  const date = menu.schedule.schedule_date;
  const sheet = sheetRows.get(date);
  if (!sheet) {
    skipped.push({ id: menu.id, date });
    continue;
  }
  const fields = changedFields(menu, sheet);
  matches.push({ menu, sheet, date, fields });
}

const changes = matches.filter((match) => match.fields.length > 0);
const summary = {
  mode: apply ? (prune ? "apply-and-prune" : "apply") : "dry-run",
  targetYear,
  sheetTabs: tabs.map((tab) => tab.name),
  sheetRows: sheetRows.size,
  existingCandidates: menus.length,
  matchingDates: matches.length,
  changed: changes.length,
  unchanged: matches.length - changes.length,
  skippedNoSheet: skipped,
  changes: changes.map(({ menu, date, fields }) => ({ id: menu.id, date, fields })),
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const applied = [];
try {
  for (const change of changes) {
    const { menu, sheet } = change;
    const { error } = await admin
      .from("practice_menus")
      .update({
        content: sheet.content,
        pace: sheet.pace,
        remark: sheet.remark,
        supplement: null,
        target_block: "middle_long",
        status: "published",
        updated_at: new Date().toISOString(),
      })
      .eq("id", menu.id);
    if (error) throw error;
    applied.push(change);
  }
} catch (error) {
  for (const change of applied.reverse()) {
    const { menu } = change;
    await admin
      .from("practice_menus")
      .update({
        content: menu.content,
        pace: menu.pace,
        remark: menu.remark,
        supplement: menu.supplement,
        target_block: menu.target_block,
        status: menu.status,
        updated_at: menu.updated_at,
      })
      .eq("id", menu.id);
  }
  throw error;
}

const ids = changes.map(({ menu }) => menu.id);
let verified = 0;
if (ids.length > 0) {
  const { data, error } = await admin
    .from("practice_menus")
    .select("id,content,pace,remark,supplement,target_block,status")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((data ?? []).map((menu) => [menu.id, menu]));
  for (const change of changes) {
    const current = byId.get(change.menu.id);
    if (
      current &&
      current.content === change.sheet.content &&
      (current.pace || null) === change.sheet.pace &&
      (current.remark || null) === change.sheet.remark &&
      current.supplement === null &&
      current.target_block === "middle_long" &&
      current.status === "published"
    ) {
      verified++;
    }
  }
}

let pruned = 0;
if (prune && skipped.length > 0) {
  const pruneIds = skipped.map((item) => item.id);
  const { error } = await admin.from("practice_menus").delete().in("id", pruneIds);
  if (error) throw error;
  const { data: remaining, error: verifyError } = await admin
    .from("practice_menus")
    .select("id")
    .in("id", pruneIds);
  if (verifyError) throw verifyError;
  pruned = pruneIds.length - (remaining?.length ?? 0);
  if (pruned !== pruneIds.length) {
    throw new Error(`Prune verification failed: ${pruned}/${pruneIds.length}`);
  }
}

console.log(
  JSON.stringify(
    { ...summary, applied: applied.length, verified, pruned },
    null,
    2,
  ),
);
