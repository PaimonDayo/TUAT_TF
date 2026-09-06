// Server only: never return credentials, raw provider errors, or billing records.
import { unstable_cache } from "next/cache";
import { getR2Inventory } from "@/lib/image-storage";

export type ServiceHealth = {
  indicator: "none" | "minor" | "major" | "critical" | "unknown";
  incidents: string[];
};
export type ServiceStatus = {
  checkedAt: string;
  health: Record<"vercel" | "supabase" | "cloudflare", ServiceHealth>;
  r2: { state: "ready" | "unconfigured" | "error"; bytes: number | null; objects: number | null };
  vercel: { state: "ready" | "unconfigured" | "error"; from: string; to: string; usage: { name: string; unit: string; quantity: number }[] };
  images: { reads: boolean; writes: boolean; paused: boolean; limitBytes: number | null };
};

export function parseHealth(value: unknown): ServiceHealth {
  const data = value as { status?: { indicator?: string }; incidents?: { name?: string }[] } | null;
  const indicator = data?.status?.indicator;
  if (!indicator || !["none", "minor", "major", "critical"].includes(indicator)) throw new Error("Invalid status response");
  return { indicator: indicator as ServiceHealth["indicator"], incidents: (data?.incidents ?? []).slice(0, 5).map((i) => String(i.name ?? "障害情報").slice(0, 200)) };
}

export function parseVercelUsage(jsonl: string) {
  const totals = new Map<string, { name: string; unit: string; quantity: number }>();
  for (const line of jsonl.split("\n").filter((s) => s.trim())) {
    const row = JSON.parse(line);
    // Fees, credits, and adjustments have no comparable request quantity.
    if (row.ChargeCategory !== "Usage") continue;
    if (row.ConsumedQuantity === null || row.ConsumedUnit === null) continue;
    if (typeof row.ServiceName !== "string" || typeof row.ConsumedUnit !== "string" || row.ConsumedQuantity === "" || row.ConsumedQuantity === undefined) throw new Error("Invalid billing record");
    const quantity = Number(row.ConsumedQuantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Invalid billing quantity");
    const key = JSON.stringify([row.ServiceName, row.ConsumedUnit]);
    const previous = totals.get(key);
    totals.set(key, { name: row.ServiceName, unit: row.ConsumedUnit, quantity: quantity + (previous?.quantity ?? 0) });
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function health(url: string): Promise<ServiceHealth> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error("Status unavailable");
    return parseHealth(await response.json());
  } catch { return { indicator: "unknown", incidents: [] }; }
}

async function inventory(): Promise<ServiceStatus["r2"]> {
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) return { state: "unconfigured", bytes: null, objects: null };
  try { return { state: "ready", ...await getR2Inventory() }; }
  catch { return { state: "error", bytes: null, objects: null }; }
}

async function vercelUsage(): Promise<ServiceStatus["vercel"]> {
  // Calendar month in UTC, deliberately not presented as the billing cycle.
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const to = now.toISOString();
  const base = { from, to, usage: [] };
  const token = process.env.VERCEL_MONITORING_TOKEN;
  const team = process.env.SERVICE_STATUS_VERCEL_TEAM_ID;
  if (!token || !team) return { ...base, state: "unconfigured" };
  try {
    const query = new URLSearchParams({ teamId: team, from, to });
    const response = await fetch(`https://api.vercel.com/v1/billing/charges?${query}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Billing unavailable");
    // Bound a streamed JSONL response before reading it all into memory.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing billing response");
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2_000_000) throw new Error("Billing response too large");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel(); }
    return { from, to, state: "ready", usage: parseVercelUsage(text) };
  } catch { return { ...base, state: "error" }; }
}

/** Only call after checking manage_system. No cookies/session inside this shared cache. */
export async function getServiceStatus(): Promise<ServiceStatus> {
  const snapshot = await unstable_cache(async () => {
    const [vercel, supabase, cloudflare, r2, usage] = await Promise.all([
      health("https://www.vercel-status.com/api/v2/summary.json"),
      health("https://status.supabase.com/api/v2/summary.json"),
      health("https://www.cloudflarestatus.com/api/v2/summary.json"), inventory(), vercelUsage(),
    ]);
    return { checkedAt: new Date().toISOString(), health: { vercel, supabase, cloudflare }, r2, vercel: usage };
  }, ["service-status-v1", process.env.VERCEL_DEPLOYMENT_ID ?? "local", process.env.R2_ACCOUNT_ID ?? "", process.env.R2_BUCKET_NAME ?? "", process.env.SERVICE_STATUS_VERCEL_TEAM_ID ?? ""], { revalidate: 900 })();
  const limit = Number(process.env.R2_MAX_STORAGE_BYTES ?? 8_000_000_000);
  return { ...snapshot, images: {
    reads: process.env.R2_READ_ENABLED === "true", writes: process.env.R2_WRITE_ENABLED === "true", paused: process.env.R2_UPLOADS_PAUSED === "true",
    limitBytes: Number.isSafeInteger(limit) && limit > 0 ? limit : null,
  } };
}
