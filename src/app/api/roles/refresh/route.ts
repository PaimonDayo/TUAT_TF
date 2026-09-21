import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ROLE_CATALOG_TAG } from "@/lib/supabase/role-catalog";

/** Members may refresh shared display data, including after relinquishing a role. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await supabase.rpc("is_member");
  if (member.error || !member.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  revalidateTag(ROLE_CATALOG_TAG, { expire: 0 });
  return NextResponse.json({ ok: true });
}
