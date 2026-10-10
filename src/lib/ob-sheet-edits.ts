import { createHmac } from "node:crypto";
import { timingSafeEqualString } from "./timing-safe";
import { OB_PROGRAM } from "./ob-meet";
import { obFamilyRows, obMixedGroupLabel } from "./ob-mixed-operations";
import { OB_SHEET_STATUSES } from "./ob-sheet-status";
import type { ObEntry } from "./ob-entries";
import type { ObEventOperation } from "./ob-operations";

export const OB_EDIT_HEADERS = ["参加者番号", "氏名", "学年", "区分", "種目", "組", "レーン・試技順", "出場状況"];
export const OB_EDIT_GRADES = ["B1", "B2", "B3", "B4", "M1", "M2", "D1", "D2", "D3", "OB・OG"];
export const OB_EDIT_EVENTS = OB_PROGRAM.flatMap(slot => slot.events);
type Context = { entries: { key: string; id: string; revision: number; events: string[] }[]; operations: { event: string; revision: number | null }[] };
export function obSheetPersonKey(id: string, secret: string) {
  return "P" + createHmac("sha256", secret).update("ob-person-v1:" + id).digest("hex").slice(0, 16);
}
export function obSheetEditSource(entries: ObEntry[], operations: ObEventOperation[], secret: string) {
  const context: Context = { entries: entries.map(e => ({ key: obSheetPersonKey(e.id, secret), id: e.id, revision: e.revision, events: e.events })).sort((a, b) => a.id.localeCompare(b.id)),
    operations: OB_EDIT_EVENTS.flatMap(family => ["男子", "女子"].map(division => ({ event: division + family, revision: operations.find(o => o.event_name === division + family)?.revision ?? null }))) };
  if (new Set(context.entries.map(e => e.key)).size !== entries.length) throw Error("Participant key collision");
  const body = Buffer.from(JSON.stringify(context)).toString("base64url");
  const token = body + "." + createHmac("sha256", secret).update("ob-edit-context-v1:" + body).digest("hex");
  const rows: (string | number | null)[][] = [OB_EDIT_HEADERS];
  for (const family of OB_EDIT_EVENTS) for (const row of obFamilyRows(family, entries, operations)) {
    if (!row.entry || !row.state.registered) continue;
    const p = row.performance;
    const status = p.status !== "entered" ? Object.entries(OB_SHEET_STATUSES).find(([, v]) => v === p.status)![0] : row.entry.absent && !row.state.recorded ? "DNS（欠場）" : "出場";
    rows.push([obSheetPersonKey(row.entryId, secret), row.entry.submitted_name, row.entry.grade, row.division, family,
      row.group === null ? "" : obMixedGroupLabel(row.group), p.order, status]);
  }
  return { editContext: token, editSheet: { name: "エントリー編集", widths: [23, 18, 9, 9, 24, 15, 18, 19], rows } };
}
export function readObEditContext(token: unknown, secret: string): Context | null {
  if (typeof token !== "string" || token.length > 200000) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || extra || !signature || !timingSafeEqualString(signature, createHmac("sha256", secret).update("ob-edit-context-v1:" + body).digest("hex"))) return null;
  try { const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return Array.isArray(data.entries) && Array.isArray(data.operations) ? data : null; } catch { return null; }
}
