import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encryptGoogleToken,
  exchangeGoogleCode,
  fetchGoogleEmail,
  verifyGoogleOAuthState,
} from "@/lib/google-drive";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const destination = new URL(
    "/schedule?compose=1&sheets=1&google=connected",
    request.url,
  );

  if (error || !code || !state) {
    destination.searchParams.set("google", "error");
    return NextResponse.redirect(destination);
  }

  const verified = verifyGoogleOAuthState(state);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!verified || !user || verified.userId !== user.id) {
    destination.searchParams.set("google", "invalid_state");
    return NextResponse.redirect(destination);
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("google_drive_connections")
      .select("refresh_token_encrypted")
      .eq("profile_id", user.id)
      .maybeSingle();
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptGoogleToken(tokens.refresh_token)
      : existing?.refresh_token_encrypted;
    if (!encryptedRefreshToken) throw new Error("Google refresh token was not returned");
    const googleEmail = await fetchGoogleEmail(tokens.access_token);
    const { error: saveError } = await admin
      .from("google_drive_connections")
      .upsert({
        profile_id: user.id,
        refresh_token_encrypted: encryptedRefreshToken,
        google_email: googleEmail,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    if (saveError) throw saveError;
    return NextResponse.redirect(destination);
  } catch (oauthError) {
    console.error("Google Drive OAuth callback failed", oauthError);
    destination.searchParams.set("google", "error");
    return NextResponse.redirect(destination);
  }
}
