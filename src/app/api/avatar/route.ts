import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { loginAccessResponse } from "@/lib/supabase/login-access";
import { ImageUploadError, logImageFailure, readImageUpload, uploadImage } from "@/lib/image-storage";
import { AVATAR_BUCKET, AVATAR_MAX_PIXELS, AVATAR_OUTPUT_SIZE } from "@/lib/avatar-image";

export const runtime = "nodejs";
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/webp"]);
const NO_STORE = { "Cache-Control": "private, no-store" };

function unavailable(error = "画像を保存できませんでした。時間をおいてお試しください") {
  return NextResponse.json({ error }, { status: 503, headers: NO_STORE });
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && error.status !== 401 && error.name !== "AuthSessionMissingError") {
    return { response: unavailable("ログインを確認できませんでした") };
  }
  if (!user) return { response: NextResponse.json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE }) };
  const accessError = await loginAccessResponse(supabase);
  if (accessError) return { response: accessError };
  return { supabase, user };
}

async function currentAvatar(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase.from("profiles").select("avatar_url").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function changeAvatar(
  supabase: Awaited<ReturnType<typeof createClient>>, id: string,
  previous: string | null, next: string | null,
) {
  // Compare and set: another device's replacement must win over this stale read.
  let query = supabase.from("profiles").update({ avatar_url: next }).eq("id", id);
  query = previous === null ? query.is("avatar_url", null) : query.eq("avatar_url", previous);
  try {
    const { data, error } = await query.select("id").maybeSingle();
    if (!error) return data ? "saved" : "conflict";
  } catch { /* A transport failure can occur after the database committed. */ }

  try {
    const profile = await currentAvatar(supabase, id);
    if (profile && profile.avatar_url === next) return "saved";
  } catch { /* Retain objects while the outcome cannot be established. */ }
  logImageFailure("avatar-update-result");
  return "unknown";
}

export async function POST(request: Request) {
  try {
    const auth = await authenticatedClient();
    if (auth.response) return auth.response;
    const { supabase, user } = auth;
    const contentType = request.headers.get("content-type")?.split(";", 1)[0] ?? "";
    if (!ACCEPTED_TYPES.has(contentType)) {
      return NextResponse.json({ error: "対応していない画像形式です" }, { status: 415, headers: NO_STORE });
    }
    const input = await readImageUpload(request, MAX_UPLOAD_BYTES);
    const [profile, output] = await Promise.all([
      currentAvatar(supabase, user.id),
      sharp(input, { limitInputPixels: AVATAR_MAX_PIXELS })
        .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: "cover" })
        .webp({ quality: 82 }).toBuffer()
        .catch(() => { throw new ImageUploadError(400, "画像を読み込めませんでした"); }),
    ]);
    if (!profile) return NextResponse.json({ error: "プロフィールが見つかりません" }, { status: 404, headers: NO_STORE });

    const uploadedPath = `${user.id}/${crypto.randomUUID()}.webp`;
    await uploadImage(supabase, AVATAR_BUCKET, uploadedPath, output);
    const outcome = await changeAvatar(supabase, user.id, profile.avatar_url, uploadedPath);
    if (outcome === "conflict") {
      return NextResponse.json({ error: "画像が別の画面で変更されました。画面を開き直して確認してください" }, { status: 409, headers: NO_STORE });
    }
    if (outcome === "unknown") return unavailable("画像の保存結果を確認できませんでした。画面を開き直して確認してください");
    // Keep retired/uncertain objects until a verified cleanup. Old open forms can
    // still restore their prior path, so even a successful save is not proof of orphanhood.
    return NextResponse.json({ ok: true, avatarUrl: uploadedPath }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ImageUploadError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    logImageFailure("avatar-save");
    return unavailable();
  }
}

export async function DELETE() {
  try {
    const auth = await authenticatedClient();
    if (auth.response) return auth.response;
    const { supabase, user } = auth;
    const profile = await currentAvatar(supabase, user.id);
    if (!profile) return NextResponse.json({ error: "プロフィールが見つかりません" }, { status: 404, headers: NO_STORE });
    if (profile.avatar_url === null) return NextResponse.json({ ok: true }, { headers: NO_STORE });
    const outcome = await changeAvatar(supabase, user.id, profile.avatar_url, null);
    if (outcome === "conflict") {
      return NextResponse.json({ error: "画像が別の画面で変更されました。画面を開き直して確認してください" }, { status: 409, headers: NO_STORE });
    }
    if (outcome === "unknown") return unavailable("画像の削除結果を確認できませんでした。画面を開き直して確認してください");
    // Removing the reference is separate from physical cleanup (see POST).
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    logImageFailure("avatar-delete");
    return unavailable("画像を削除できませんでした。時間をおいてお試しください");
  }
}
