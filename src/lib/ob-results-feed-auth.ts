import { createHmac } from "node:crypto";
import { OB_MEET } from "./ob-meet";

export const OB_RESULTS_SPREADSHEET_ID = "188DwdYDpRuk4a27whOiu5lhhNK4MDaSeYRfXTHDhBAw";

/** Give the private publisher this read-only derived key, never the all-purpose sync secret. */
export function obResultsFeedToken(secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(["ob-results-v1", OB_MEET.meetKey, OB_RESULTS_SPREADSHEET_ID])).digest("hex");
}

/** Separate, fixed-meet permission for status edits only. */
export function obResultsStatusToken(secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(["ob-status-v1", OB_MEET.meetKey, OB_RESULTS_SPREADSHEET_ID])).digest("hex");
}
