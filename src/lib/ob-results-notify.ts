import { createHmac } from "node:crypto";
import { after } from "next/server";
import { obResultsFeedToken } from "./ob-results-feed-auth";

// A destination, not a credential. Requests require the private derived-key signature.
const publisherUrl = "https://script.google.com/macros/s/AKfycbxwmB0ckBeWGvlBdLTydHcbayRIQn6F89NI_bbUewaL4RNJbiw-JT7xGU8QIoK6yjvUgA/exec";

export async function notifyObResults(): Promise<boolean> {
  const secret = process.env.SHEET_SYNC_SECRET;
  if (!secret) return false;
  const timestamp = Date.now();
  const signature = createHmac("sha256", obResultsFeedToken(secret)).update(`ob-publish:${timestamp}`).digest("hex");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(publisherUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", timestamp, signature }),
        signal: AbortSignal.timeout(15000), cache: "no-store",
      });
      if (!response.ok) return false;
      const result = await response.json();
      if (result?.ok === true) return true;
      if (result?.busy !== true || attempt === 2) return false;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    return false;
  } catch { return false; }
}

/** Only after a verified save; a failed export must never undo or repeat the DB save. */
export function scheduleObResultsPublish() {
  after(async () => {
    if (!await notifyObResults()) console.warn("OB sheet notification failed; hourly publisher will recover");
  });
}
