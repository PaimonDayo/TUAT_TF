import { pcBackendFetch } from "../pc-backend";

/** Server-only transport credentials; never import this from a browser client. */
export function pcServerOptions(): { global?: { fetch?: typeof fetch; headers?: Record<string, string> } } {
  if (process.env.PC_BACKEND_ENABLED === "true") return { global: { fetch: pcBackendFetch } };
  if (process.env.NEXT_PUBLIC_PC_TRIAL === "true" && process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:18000") {
    const key = process.env.PC_TRIAL_BRIDGE_KEY;
    if (!key || key.length < 32) throw new Error("Independent review access is not configured");
    return { global: { headers: { "x-tuat-review-internal": key } } };
  }
  if (process.env.PC_TRIAL_VERCEL !== "true") return {};
  const key = process.env.PC_TRIAL_BRIDGE_KEY;
  if (!key || key.length < 32) throw new Error("Private PC bridge is not configured");
  return { global: { headers: { "x-pc-trial-bridge": key } } };
}
