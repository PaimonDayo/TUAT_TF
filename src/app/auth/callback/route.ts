import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLOUD_AUTH_TEST_COOKIE, cloudAuthConfig } from "@/lib/supabase/cloud-auth";
import { pcAvailable } from "@/lib/pc-backend";
import { loginAccessStatus } from "@/lib/supabase/login-access";
import { getAppPublicOrigin } from "@/lib/app-public-origin";
import { getPcAppRuntime } from "@/lib/pc-app-runtime";
import { safeLoginNext } from "@/lib/login-next";

/**
 * Google OAuth コールバック。
 * 1. code をセッションに交換
 * 2. 大学メール/指定メールの許可をDBで検証
 * 3. profiles の存在を確認（トリガー未設定環境向けの保険）
 * 4. プロフィール未設定なら /mypage、設定済みなら /home へ
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = getAppPublicOrigin(request.nextUrl.href);
  const code = searchParams.get("code");
  const next = safeLoginNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`);
  }

  const email = user.email ?? "";
  const app = getPcAppRuntime();
  // PC/予備側の署名検証済みJWTで判定。通信不良と許可外を区別する。
  const access = await loginAccessStatus(supabase);
  if (access === "unavailable") {
    return NextResponse.json({ error: "ログインの許可を確認できませんでした。時間をおいてログインし直してください。" }, { status: 503 });
  }
  if (access === "denied") {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // ログインをクラウドで行っているときは、データを置いているPCにも同じIDのアカウントを用意する
  // （部員名簿がアカウントを参照しているため。PCのトリガーが部員名簿も作る）。
  // 専用PCアプリはこの場で同じIDを用意し、業務データの書戻しには依存しない。
  if ((app?.cloud ?? cloudAuthConfig(request.cookies.get(CLOUD_AUTH_TEST_COOKIE)?.value === "1")) && await pcAvailable()) {
    const admin = createAdminClient();
    const identityUnavailable = () => NextResponse.json({ error: "アカウントの確認を完了できませんでした。時間をおいて再度お試しください。" }, {
      status: 503, headers: { "cache-control": "private, no-store" },
    });
    const sameIdentity = (local: { id: string; email?: string } | null | undefined) =>
      !!local && local.id === user.id && local.email?.toLowerCase() === email.toLowerCase();
    try {
      const { data: existing, error: lookupError } = await admin.auth.admin.getUserById(user.id);
      const explicitlyMissing = lookupError?.status === 404 || lookupError?.code === "user_not_found";
      if (app && (existing?.user ? !!lookupError || !sameIdentity(existing.user) : !explicitlyMissing)) {
        return identityUnavailable();
      }
      if (!existing?.user) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          id: user.id,
          email,
          email_confirm: true,
          user_metadata: user.user_metadata,
          app_metadata: { provider: "google", providers: ["google"] },
        });
        if (app && (createError || !sameIdentity(created?.user))) {
          // A creation may have committed before its response was lost. Read once; never create again.
          const { data: reconciled, error: reconcileError } = await admin.auth.admin.getUserById(user.id);
          if (reconcileError || !sameIdentity(reconciled?.user)) return identityUnavailable();
        } else if (createError) {
          console.error("Failed to create the PC account during auth callback", createError.message);
          return NextResponse.redirect(`${origin}/login?error=profile`);
        }
      }
    } catch (error) {
      if (app) return identityUnavailable();
      throw error;
    }
  }

  // プロフィール確認（trigger で自動作成されるが、無い場合は upsert を試みる）
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, blocks")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    if (app) return NextResponse.json({ error: "プロフィールを確認できませんでした。時間をおいて再度お試しください。" }, {
      status: 503, headers: { "cache-control": "private, no-store" },
    });
    console.error("Failed to load profile during auth callback", profileError);
    return NextResponse.redirect(`${origin}/login?error=profile`);
  }
  if (!profile) {
    const { error: createProfileError } = await supabase.from("profiles").upsert({ id: user.id, email });
    if (app && createProfileError) return NextResponse.json({ error: "プロフィールの準備を完了できませんでした。時間をおいて再度お試しください。" }, {
      status: 503, headers: { "cache-control": "private, no-store" },
    });
  }

  // 初期設定が未完了（名前 or ブロック未入力）なら設定画面へ
  const needsSetup = !profile?.display_name || !profile.blocks?.length;
  const dest = needsSetup ? "/mypage?setup=1" : next;

  return NextResponse.redirect(`${origin}${dest}`);
}
