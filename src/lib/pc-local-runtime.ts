import { pcAppLocalAuthEnabled, syntheticLoopbackOrigin } from "./pc-app-transport";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";

export type PcLocalRuntime = { authUrl: string; restUrl: string };

/** Reuses the minimal runtime's private GoTrue/PostgREST URL contract. */
export function getPcLocalRuntime(): PcLocalRuntime | undefined {
  const server = process.env.PC_LOCAL_RUNTIME === "true";
  const browser = pcAppLocalAuthEnabled();
  if (!server && !browser) return undefined;
  if (!server || !browser || process.env.PC_BACKEND_INTERNAL_URL || typeof window !== "undefined" ||
      process.env.IMAGE_STORAGE_DRIVER !== "local" || process.env.R2_READ_ENABLED !== "false" || process.env.R2_WRITE_ENABLED !== "false" ||
      ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"].some(name => process.env[name])) {
    throw new Error("Local runtime requires private Auth/REST and local images without image-provider credentials");
  }
  const authUrl = process.env.PC_LOCAL_AUTH_URL ?? "http://127.0.0.1:18001";
  const restUrl = process.env.PC_LOCAL_REST_URL ?? "http://127.0.0.1:18002";
  if (!syntheticLoopbackOrigin(authUrl) || !syntheticLoopbackOrigin(restUrl) || authUrl === restUrl) {
    throw new Error("Local Auth and REST require distinct private loopback root URLs");
  }
  const root = process.env.LOCAL_IMAGE_STORAGE_ROOT, fromApp = root ? relative(process.cwd(),root) : "";
  const size = Number(process.env.LOCAL_IMAGE_MAX_STORAGE_BYTES);
  if (!root || !isAbsolute(root) || resolve(root) !== root || root === parse(root).root || !(fromApp === ".." || fromApp.startsWith(`..${sep}`) || isAbsolute(fromApp)) ||
      Buffer.byteLength(process.env.LOCAL_IMAGE_SIGNING_KEY ?? "") < 32 || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Local runtime requires a separate private image root, signing key and capacity");
  }
  return { authUrl, restUrl };
}

export function pcLocalApiTarget(runtime: PcLocalRuntime, path: string, search = ""): string {
  if (/^\/auth\/v1(?:\/|$)/.test(path)) return `${runtime.authUrl}${path.slice("/auth/v1".length) || "/"}${search}`;
  if (/^\/rest\/v1(?:\/|$)/.test(path)) return `${runtime.restUrl}${path.slice("/rest/v1".length) || "/"}${search}`;
  throw new Error("This API is not provided by the minimal local runtime");
}
