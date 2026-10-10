import { createClient } from "@/lib/supabase/server";
import type { LoginAllowedEmail } from "@/lib/login-allowlist";

export async function getLoginAllowedEmails(): Promise<LoginAllowedEmail[]> {
  const supabase = await createClient();
  const entries: LoginAllowedEmail[] = [];
  // PostgRESTの1,000件上限で登録済みメールを取りこぼさない。
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("login_email_allowlist").select("*")
      .order("email").range(offset, offset + 499);
    if (error || !data) throw new Error("ログイン許可リストを取得できませんでした。再読み込みしてください。");
    entries.push(...data);
    if (data.length < 500) return entries;
  }
}
