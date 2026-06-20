import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleAuthorizationUrl } from "@/lib/google-drive";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/login?next=/api/google/connect", request.url),
    );
  }
  return NextResponse.redirect(googleAuthorizationUrl(user.id));
}
