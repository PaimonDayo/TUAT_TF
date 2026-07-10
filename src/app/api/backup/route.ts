import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { timingSafeEqualString } from "@/lib/timing-safe";

export const maxDuration = 60;

const TABLES = [
  "practice_records",
  "profiles",
  "notes",
  "note_articles",
  "notices",
  "practice_schedules",
  "practice_menus",
] as const;

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
}

async function fetchAllRows(table: string): Promise<Record<string, unknown>[]> {
  const admin = createAdminClient();
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}

/** GASの週次トリガー専用。主要テーブルを復元可能なCSVとして返す。 */
export async function POST(request: Request) {
  const secret = process.env.BACKUP_SECRET ?? process.env.SHEET_SYNC_SECRET ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqualString(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const exports = await Promise.all(
      TABLES.map(async (table) => {
        const rows = await fetchAllRows(table);
        return { table, rowCount: rows.length, csv: toCsv(rows) };
      }),
    );
    return NextResponse.json({
      createdAt: new Date().toISOString(),
      exports,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "backup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
