import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleAuthorizationUrl } from "@/lib/google-drive";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  return NextResponse.redirect(googleAuthorizationUrl(user.id));
}
