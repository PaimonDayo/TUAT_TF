import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getE2EEnvironment, type E2EEnvironment } from "./environment";

export const E2E_STATE_DIR = path.resolve(process.cwd(), ".playwright");
export const MEMBER_AUTH_STATE = path.join(E2E_STATE_DIR, "member.json");
export const SYSTEM_AUTH_STATE = path.join(E2E_STATE_DIR, "system.json");
const USER_STATE = path.join(E2E_STATE_DIR, "users.json");

type CreatedUser = { id: string; email: string; kind: "member" | "system" };
type UserState = { projectRef: string; users: CreatedUser[] };

function adminClient(env: E2EEnvironment): SupabaseClient<Database> {
  return createClient<Database>(env.supabaseURL, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createUser(
  admin: SupabaseClient<Database>,
  kind: CreatedUser["kind"],
): Promise<{ user: User; password: string }> {
  const password = `E2e-${crypto.randomUUID()}-9aA!`;
  const email = `e2e-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@st.go.tuat.ac.jp`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: kind === "system" ? "E2E システム" : "E2E 部員" },
  });
  if (error || !data.user) throw error ?? new Error("Failed to create E2E user");

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      display_name: kind === "system" ? "E2E システム" : "E2E 部員",
      blocks: kind === "system" ? ["short"] : ["middle_long"],
      grade: "1",
      status: "active",
      approved: true,
    })
    .eq("id", data.user.id);
  if (profileError) throw profileError;

  if (kind === "system") {
    const { data: role, error: roleError } = await admin
      .from("roles")
      .select("id")
      .eq("can_manage_system", true)
      .limit(1)
      .single();
    if (roleError || !role) throw roleError ?? new Error("System role is missing in staging");
    const { error: assignmentError } = await admin
      .from("profile_roles")
      .insert({ profile_id: data.user.id, role_id: role.id });
    if (assignmentError) throw assignmentError;
  }

  return { user: data.user, password };
}

async function storageState(
  env: E2EEnvironment,
  email: string,
  password: string,
) {
  const auth = createClient<Database>(env.supabaseURL, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("Failed to sign in E2E user");

  const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
  const ssr = createServerClient<Database>(env.supabaseURL, env.anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, item]) => ({ name, value: item.value })),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => {
        jar.set(name, { value, options: options as Record<string, unknown> });
      }),
    },
  });
  await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  const host = new URL(env.baseURL).hostname;
  return {
    cookies: [...jar.entries()].map(([name, item]) => ({
      name,
      value: item.value,
      domain: host,
      path: typeof item.options.path === "string" ? item.options.path : "/",
      expires: -1,
      httpOnly: item.options.httpOnly === true,
      secure: env.baseURL.startsWith("https://"),
      sameSite: "Lax" as const,
    })),
    origins: [],
  };
}

export async function setupE2EUsers(): Promise<void> {
  const env = getE2EEnvironment();
  fs.mkdirSync(E2E_STATE_DIR, { recursive: true });
  await cleanupE2EUsers();

  const admin = adminClient(env);
  const created: CreatedUser[] = [];
  try {
    const member = await createUser(admin, "member");
    created.push({ id: member.user.id, email: member.user.email!, kind: "member" });
    const system = await createUser(admin, "system");
    created.push({ id: system.user.id, email: system.user.email!, kind: "system" });

    fs.writeFileSync(USER_STATE, JSON.stringify({ projectRef: env.projectRef, users: created }, null, 2));
    fs.writeFileSync(MEMBER_AUTH_STATE, JSON.stringify(await storageState(env, member.user.email!, member.password), null, 2));
    fs.writeFileSync(SYSTEM_AUTH_STATE, JSON.stringify(await storageState(env, system.user.email!, system.password), null, 2));
  } catch (error) {
    await Promise.allSettled(created.map((user) => admin.auth.admin.deleteUser(user.id)));
    throw error;
  }
}

export async function cleanupE2EUsers(): Promise<void> {
  if (!fs.existsSync(USER_STATE)) return;
  const env = getE2EEnvironment();
  const state = JSON.parse(fs.readFileSync(USER_STATE, "utf8")) as UserState;
  if (state.projectRef !== env.projectRef) {
    throw new Error("Refusing cleanup because saved E2E users belong to another Supabase project.");
  }
  const admin = adminClient(env);
  const results = await Promise.allSettled(state.users.map((user) => admin.auth.admin.deleteUser(user.id)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new Error(`Failed to delete ${failures.length} E2E user(s).`);
  for (const file of [USER_STATE, MEMBER_AUTH_STATE, SYSTEM_AUTH_STATE]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}