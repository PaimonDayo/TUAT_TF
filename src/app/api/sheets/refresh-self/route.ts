import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshMemberFromSheetLive } from "@/lib/sheet-sync";
import { fetchRolesByProfileIds } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { profileRecordSource, recordFieldsFromJson } from "@/lib/profile-normalize";

/** Refresh a sheet-backed member after the page has rendered. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, sheet_name, record_source, record_fields, sheet_linked_at, sheet_header_signature")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const roles = await fetchRolesByProfileIds(supabase, [user.id]);
  const stagedSheetFlow =
    process.env.SHEET_FORM_V2_APPLY_ENABLED === "true" &&
    permissionsOf(roles.get(user.id)).manageSystem &&
    Boolean(profile.sheet_header_signature);
  const result = await refreshMemberFromSheetLive(supabase, {
    ...profile,
    record_source: profileRecordSource(profile.record_source),
    record_fields: recordFieldsFromJson(profile.record_fields),
  }, { replaceMappedBlanks: stagedSheetFlow, enforceHeaderSignature: stagedSheetFlow });
  return NextResponse.json({ ok: true, changed: Boolean(result && (result.inserted || result.updated)) });
}
