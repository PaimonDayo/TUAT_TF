import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { sessionClientConfig } from "./server-client-options";
import { CLOUD_AUTH_TEST_COOKIE } from "./cloud-auth";

/**
 * サーバー（Server Component / Route Handler / Server Action）用 Supabase クライアント。
 * Next.js 16 では cookies() が非同期なので await する。
 */
export async function createClient() {
  const cookieStore = await cookies();
  const session = sessionClientConfig(cookieStore.get(CLOUD_AUTH_TEST_COOKIE)?.value === "1");

  return createServerClient<Database>(
    session.url,
    session.key,
    {
      ...session.options,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component から呼ばれた場合は set 不可。
            // セッション更新は proxy.ts 側で行うため無視してよい。
          }
        },
      },
    },
  );
}
