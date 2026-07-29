import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const envFile = path.join(root, ".env.e2e.local");
const stateDir = path.join(root, ".playwright");
const userStateFile = path.join(stateDir, "users.json");

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

const baseURL = process.env.E2E_BASE_URL ?? "";
const supabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const expectedRef = process.env.E2E_EXPECTED_SUPABASE_REF ?? "";
const projectRef = new URL(supabaseURL).hostname.split(".")[0];

if (process.env.E2E_ALLOW_MUTATION !== "true") {
  throw new Error("Set E2E_ALLOW_MUTATION=true only for a dedicated staging project.");
}
if (!baseURL || !supabaseURL || !serviceRoleKey || !expectedRef) {
  throw new Error("The E2E staging environment is incomplete.");
}
if (new URL(baseURL).hostname === "tuat-tf.vercel.app" || projectRef === "snbgxocgdhqtuywrlqrs") {
  throw new Error("Refusing to mutate the production environment.");
}
if (projectRef !== expectedRef) {
  throw new Error("The expected Supabase project ref does not match the configured URL.");
}

if (!fs.existsSync(userStateFile)) {
  console.log("No E2E users need cleanup.");
  process.exit(0);
}

const state = JSON.parse(fs.readFileSync(userStateFile, "utf8"));
if (state.projectRef !== projectRef) {
  throw new Error("Saved E2E users belong to another Supabase project.");
}

const admin = createClient(supabaseURL, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const results = await Promise.allSettled(
  state.users.map(({ id }) => admin.auth.admin.deleteUser(id)),
);
const failures = results.filter((result) => result.status === "rejected");
if (failures.length) {
  throw new Error(`Failed to delete ${failures.length} E2E user(s).`);
}

for (const name of ["users.json", "member.json", "system.json"]) {
  const file = path.join(stateDir, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
console.log(`Removed ${state.users.length} E2E user(s) and local auth state.`);
