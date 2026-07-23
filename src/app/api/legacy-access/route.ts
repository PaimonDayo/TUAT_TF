import { NextResponse } from "next/server";
import { issueLegacyAccessToken, verifyLegacyAccessToken } from "@/lib/legacy-access";
import { permissionsOf } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";

const LEGACY_APP_ORIGIN = "https://menu20260404-vjga.vercel.app";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const CORS_HEADERS = {
  ...NO_STORE_HEADERS,
  "Access-Control-Allow-Origin": LEGACY_APP_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function accessSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/**
 * システム管理者だけに、旧アプリを開くための短時間トークンを発行する。
 * URLフラグだけではなく、ログイン状態と manage_system 権限をサーバーで検証する。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "認証が必要です" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const roles = await fetchRolesByProfileIds(supabase, [user.id]);
  if (!permissionsOf(roles.get(user.id)).manageSystem) {
    return NextResponse.json(
      { error: "システム管理権限が必要です" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const secret = accessSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "旧アプリのアクセス設定が不足しています" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const token = issueLegacyAccessToken(user.id, secret);
  const destination = new URL(LEGACY_APP_ORIGIN);
  destination.hash = new URLSearchParams({ access: token }).toString();

  return NextResponse.redirect(destination, { headers: NO_STORE_HEADERS });
}

/** 旧アプリから送られた署名付きトークンを検証する。 */
export async function POST(request: Request) {
  const secret = accessSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  const valid =
    typeof token === "string" &&
    token.length <= 2048 &&
    verifyLegacyAccessToken(token, secret);

  return NextResponse.json(
    { ok: valid },
    { status: valid ? 200 : 403, headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
