import { createHmac } from "node:crypto";
import { timingSafeEqualString } from "./timing-safe";
import { obFamilyRows } from "./ob-mixed-operations";
import { OB_PROGRAM } from "./ob-meet";
import { obFamilyLabel } from "./ob-meet";
import type { ObEntry } from "./ob-entries";
import type { ObEventOperation } from "./ob-operations";
import type { XlsxSheet } from "./xlsx-writer";

export const OB_SHEET_STATUSES = { "出場": "entered", "DNS（欠場）": "DNS", "DNF（途中棄権）": "DNF", "DQ（失格）": "DQ" } as const;
export type ObSheetStatusTarget = { entryId: string; event: string; entryRevision: number; operationRevision: number | null };

export function signObSheetTarget(target: ObSheetStatusTarget, secret: string) {
  const body = Buffer.from(JSON.stringify(target)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`ob-status-row-v1:${body}`).digest("hex")}`;
}

export function readObSheetTarget(token: unknown, secret: string): ObSheetStatusTarget | null {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || !timingSafeEqualString(signature, createHmac("sha256", secret).update(`ob-status-row-v1:${body}`).digest("hex"))) return null;
  try {
    const row = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ObSheetStatusTarget;
    return /^[0-9a-f-]{36}$/.test(row.entryId) && /^(男子|女子)(1500m|ジャベリックスロー|立ち五段|100m|砲丸投げ|300mH|走り高跳び|300m|やり投げ|走り幅跳び|3000m)$/.test(row.event)
      && Number.isSafeInteger(row.entryRevision) && row.entryRevision >= 0
      && (row.operationRevision === null || Number.isSafeInteger(row.operationRevision) && row.operationRevision >= 0) ? row : null;
  } catch { return null; }
}

/** Row identities stay in the private publisher, never in public cells or metadata. */
export function obSheetStatusTargets(entries: ObEntry[], operations: ObEventOperation[], sheets: XlsxSheet[], secret: string) {
  return OB_PROGRAM.flatMap(slot => slot.events).map(family => {
    const name = obFamilyLabel(family), sheet = sheets.find(sheet => sheet.name === name)!;
    const statusColumn = sheet.rows[0].indexOf("出場状況");
    const people = obFamilyRows(family, entries, operations);
    let person = 0;
    const rows = sheet.rows.slice(1).flatMap((cells, offset) => {
      if (!cells.length) return [];
      const row = people[person++];
      if (!row?.entry || !row.state.registered) return [];
      return [{ row: offset + 1, key: "P" + createHmac("sha256", secret).update("ob-person-v1:" + row.entryId).digest("hex").slice(0, 16), event: row.eventName, token: signObSheetTarget({ entryId: row.entryId, event: row.eventName, entryRevision: row.entry.revision,
        operationRevision: operations.find(op => op.event_name === row.eventName)?.revision ?? null }, secret) }];
    });
    if (person !== people.length) throw new Error("Status row mapping mismatch");
    return { name, statusColumn, rows };
  });
}
