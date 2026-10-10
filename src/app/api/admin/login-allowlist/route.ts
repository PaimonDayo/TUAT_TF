import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { getLoginAllowedEmails } from "@/lib/queries";
import { allowedEmailError, normalizeAllowedEmail } from "@/lib/login-allowlist";
import { permissionsOf } from "@/lib/permissions";
import { MEMBER_PREVIEW_COOKIE } from "@/lib/member-preview";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function authorize() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return reply({ error: "ログインしてください" }, 401);
  const roles = await fetchRolesByProfileIds(client, [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageMembers || (await cookies()).get(MEMBER_PREVIEW_COOKIE)?.value === "1") {
    return reply({ error: "部員・ロール管理権限が必要です" }, 403);
  }
  return client;
}

export async function GET() {
  try {
    const access = await authorize();
    if (access instanceof Response) return access;
    return reply({ entries: await getLoginAllowedEmails() });
  } catch {
    return reply({ error: "許可リストを取得できませんでした。再読み込みしてください。" }, 503);
  }
}

async function change(request: NextRequest, action: "add" | "remove") {
  // Cookie認証の操作は同じoriginの管理画面だけから受け付ける。
  if (request.headers.get("origin") !== request.nextUrl.origin) return reply({ error: "管理画面から操作してください" }, 403);
  try {
    const client = await authorize();
    if (client instanceof Response) return client;
    let input: unknown;
    try { input = await request.json(); } catch { return reply({ error: "メールアドレスを入力してください" }, 400); }
    if (!input || typeof input !== "object" || !("email" in input) || typeof input.email !== "string") {
      return reply({ error: "メールアドレスを入力してください" }, 400);
    }
    const email = normalizeAllowedEmail(input.email);
    const validation = allowedEmailError(email);
    if (validation) return reply({ error: validation }, 400);
    const { data, error } = action === "add"
      ? await client.from("login_email_allowlist").insert({ email }).select("*")
      : await client.from("login_email_allowlist").delete().eq("email", email).select("*");
    if (error) {
      if (error.code === "23505") return reply({ error: "このメールアドレスは登録済みです。再読み込みしてください。" }, 409);
      if (error.code === "PT503") return reply({ error: "PC停止中は許可リストを変更できません。復帰後にお試しください。", unchanged: true }, 503);
      if (["PT403", "42501"].includes(error.code)) return reply({ error: "管理権限を確認してください" }, 403);
      // 接続切断等の結果不明は、クライアント側で確認するまで再送しない。
      return reply({ error: "変更結果を確認できませんでした。再読み込みしてください。", uncertain: true }, 503);
    }
    if (data?.length !== 1 || data[0].email !== email) {
      return reply({ error: "登録状況が変わっています。再読み込みしてください。", uncertain: true }, 409);
    }
    return reply({ entry: data[0] });
  } catch {
    return reply({ error: "変更結果を確認できませんでした。再読み込みしてください。", uncertain: true }, 503);
  }
}

export const POST = (request: NextRequest) => change(request, "add");
export const DELETE = (request: NextRequest) => change(request, "remove");
