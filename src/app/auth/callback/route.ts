import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLOUD_AUTH_TEST_COOKIE, cloudAuthConfig } from "@/lib/supabase/cloud-auth";

/**
 * Google OAuth コールバック。
 * 1. code をセッションに交換
 * 2. メールドメインを検証（大学ドメイン以外は拒否）
 * 3. profiles の存在を確認（トリガー未設定環境向けの保険）
 * 4. プロフィール未設定なら /mypage、設定済みなら /home へ
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/home";

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

  // メールドメイン検証（サーバー側で担保）
  const domain = process.env.NEXT_PUBLIC_UNIVERSITY_DOMAIN;
  const email = user.email ?? "";
  if (domain && !email.endsWith(`@${domain}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // ログインをクラウドで行っているときは、データを置いているPCにも同じIDのアカウントを用意する
  // （部員名簿がアカウントを参照しているため。PCのトリガーが部員名簿も作る）。
  if (cloudAuthConfig(request.cookies.get(CLOUD_AUTH_TEST_COOKIE)?.value === "1")) {
    const admin = createAdminClient();
    const { data: existing } = await admin.auth.admin.getUserById(user.id);
    if (!existing?.user) {
      const { error: createError } = await admin.auth.admin.createUser({
        id: user.id,
        email,
        email_confirm: true,
        user_metadata: user.user_metadata,
        app_metadata: { provider: "google", providers: ["google"] },
      });
      if (createError) {
        console.error("Failed to create the PC account during auth callback", createError.message);
        return NextResponse.redirect(`${origin}/login?error=profile`);
      }
    }
  }

  // プロフィール確認（trigger で自動作成されるが、無い場合は upsert を試みる）
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, blocks")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to load profile during auth callback", profileError);
    return NextResponse.redirect(`${origin}/login?error=profile`);
  }
  if (!profile) {
    await supabase.from("profiles").upsert({ id: user.id, email });
  }

  // 初期設定が未完了（名前 or ブロック未入力）なら設定画面へ
  const needsSetup = !profile?.display_name || !profile.blocks?.length;
  const dest = needsSetup ? "/mypage?setup=1" : next;

  return NextResponse.redirect(`${origin}${dest}`);
}
