import { configuredAppPublicOrigin } from "./app-public-origin";
import { pcAppCloudAuthConfig, syntheticLoopbackOrigin } from "./pc-app-transport";
import type { CloudAuth } from "./supabase/cloud-auth";
import { getPcLocalRuntime, type PcLocalRuntime } from "./pc-local-runtime";

export type PcAppRuntime = { publicOrigin: string; internalUrl: string; synthetic: boolean } &
  ({ cloud: CloudAuth; local?: undefined } | { cloud: null; local: PcLocalRuntime });

/** Explicit server deployment only. Existing production routing stays unchanged when disabled. */
export function getPcAppRuntime(): PcAppRuntime | undefined {
  const server = process.env.PC_APP_RUNTIME === "true";
  const browser = process.env.NEXT_PUBLIC_PC_APP_RUNTIME === "true";
  if (!server && !browser && !process.env.PC_BACKEND_INTERNAL_URL) return undefined;
  if (!server || !browser || typeof window !== "undefined" || process.env.VERCEL || process.env.VERCEL_ENV ||
      process.env.PC_TRIAL_VERCEL === "true" || process.env.NEXT_PUBLIC_PC_TRIAL === "true" ||
      process.env.PC_BACKEND_ENABLED !== "true" || process.env.NEXT_PUBLIC_PC_BACKEND !== "true" ||
      process.env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN) {
    throw new Error("PC app requires its explicit independent runtime");
  }
  const publicOrigin = configuredAppPublicOrigin();
  if (!publicOrigin || process.env.NEXT_PUBLIC_SUPABASE_URL !== `${publicOrigin}/api/pc-supabase`) {
    throw new Error("PC app requires its fixed same-origin data API");
  }
  const synthetic = process.env.PC_APP_SYNTHETIC_REVIEW === "true";
  if (synthetic !== (process.env.NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW === "true")) {
    throw new Error("Synthetic PC app flags must match");
  }
  const local = getPcLocalRuntime();
  if (local) {
    if (synthetic && (!/(?:\.example\.test|\.localhost)$/.test(new URL(publicOrigin).hostname) || process.env.SHEET_SYNC_ENABLED !== "false" ||
        process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.SHEET_SYNC_GAS_URL)) {
      throw new Error("Synthetic local runtime requires disabled external providers");
    }
    return { publicOrigin, internalUrl: local.restUrl, cloud: null, local, synthetic };
  }
  const internalUrl = process.env.PC_BACKEND_INTERNAL_URL;
  const cloud = pcAppCloudAuthConfig();
  if (cloud.url === publicOrigin) throw new Error("Cloud Auth and PC app origins must differ");
  if (synthetic) {
    if (!/(?:\.example\.test|\.localhost)$/.test(new URL(publicOrigin).hostname) ||
        !syntheticLoopbackOrigin(internalUrl ?? "") || internalUrl === cloud.url ||
        process.env.IMAGE_STORAGE_READ_ONLY !== "true" || process.env.R2_READ_ENABLED !== "false" ||
        process.env.R2_WRITE_ENABLED !== "false" || process.env.SHEET_SYNC_ENABLED !== "false") {
      throw new Error("Synthetic PC app requires isolated loopback data and disabled external writes");
    }
  } else if (internalUrl !== "http://127.0.0.1:8000") {
    throw new Error("PC app requires the established private loopback API");
  }
  return { publicOrigin, internalUrl: internalUrl!, cloud, synthetic };
}
