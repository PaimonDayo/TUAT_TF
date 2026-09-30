import type { RecordFieldDef } from "@/types";

export const OCTOBER_SHEET_ID = "18HKZrVL-JtXbZ9zcYUFPRPGIGCpd7ltLOsmvBKdJfR8";
export const OCTOBER_START = "2026-10-01";
export const LEGACY_SYNC_END = "2026-10-07T15:00:00.000Z"; // 10/8 00:00 JST
// Updated guidance must be confirmed once, without clearing existing settings.
export const SHEET_SETUP_RECONFIRM_AFTER = "2026-09-30T00:45:32.000Z";
export type SheetTransition = {
  version: "2026-10";
  mode: "sheet" | "app_only";
  confirmed_at: string;
  legacy: {
    sheet_name: string | null;
    record_fields: RecordFieldDef[];
    sheet_header_signature: string | null;
    record_source: "app" | "sheet";
  };
};
export function parseSheetTransition(value: unknown): SheetTransition | null {
  if (!value || typeof value !== "object") return null;
  const config = value as SheetTransition;
  return config.version === "2026-10" && (config.mode === "sheet" || config.mode === "app_only")
    && !!config.legacy && Array.isArray(config.legacy.record_fields) ? config : null;
}
export function needsSheetSetupConfirmation(transition: SheetTransition | null | undefined): boolean {
  const confirmedAt = Date.parse(transition?.confirmed_at ?? "");
  return !Number.isFinite(confirmedAt) || confirmedAt < Date.parse(SHEET_SETUP_RECONFIRM_AFTER);
}
export function legacySyncOpen(now = new Date()): boolean {
  return now.getTime() < Date.parse(LEGACY_SYNC_END);
}
export function periodContains(date: string, period: "legacy" | "october" | "unchanged", now = new Date()): boolean {
  if (period === "unchanged") return true;
  return period === "october" ? date >= OCTOBER_START : date < OCTOBER_START && legacySyncOpen(now);
}
