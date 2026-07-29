import fs from "node:fs";
import path from "node:path";

const PRODUCTION_APP_HOST = "tuat-tf.vercel.app";
const PRODUCTION_SUPABASE_REF = "snbgxocgdhqtuywrlqrs";

export type E2EEnvironment = {
  baseURL: string;
  supabaseURL: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
};

export function loadE2EEnv(): void {
  const file = process.env.E2E_ENV_FILE ?? ".env.e2e.local";
  const fullPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(fullPath)) return;

  for (const line of fs.readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Copy .env.e2e.example to .env.e2e.local.`);
  return value;
}

export function getE2EEnvironment(): E2EEnvironment {
  loadE2EEnv();
  if (process.env.E2E_ALLOW_MUTATION !== "true") {
    throw new Error("E2E_ALLOW_MUTATION=true is required because E2E creates temporary users.");
  }

  const baseURL = required("E2E_BASE_URL").replace(/\/$/, "");
  const supabaseURL = required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const expectedRef = required("E2E_EXPECTED_SUPABASE_REF");
  const appHost = new URL(baseURL).hostname;
  const projectRef = new URL(supabaseURL).hostname.split(".")[0];

  if (appHost === PRODUCTION_APP_HOST || projectRef === PRODUCTION_SUPABASE_REF) {
    throw new Error("E2E is blocked against the production app or production Supabase project.");
  }
  if (projectRef !== expectedRef) {
    throw new Error(`Supabase ref mismatch: expected ${expectedRef}, got ${projectRef}`);
  }

  return { baseURL, supabaseURL, anonKey, serviceRoleKey, projectRef };
}