import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }
  const { data } = await supabase
    .from("google_drive_connections")
    .select("google_email, connected_at")
    .eq("profile_id", user.id)
    .maybeSingle();
  return NextResponse.json({
    connected: !!data,
    email: data?.google_email ?? null,
    connectedAt: data?.connected_at ?? null,
  });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  const { error } = await supabase
    .from("google_drive_connections")
    .delete()
    .eq("profile_id", user.id);
  if (error) {
    return NextResponse.json({ error: "連携を解除できませんでした" }, { status: 500 });
  }
  return NextResponse.json({ connected: false });
}
