import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleAuthorizationUrl } from "@/lib/google-drive";

export async function GET(request: Request) {
  return NextResponse.redirect(
    new URL("/schedule?compose=1&sheets=1", request.url),
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/schedule?compose=1&sheets=1");
    return NextResponse.redirect(loginUrl, 303);
  }
  return NextResponse.redirect(googleAuthorizationUrl(user.id), 303);
}
