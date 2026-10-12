import { NextResponse } from "next/server";
import { getAppPublicOrigin } from "@/lib/app-public-origin";
import { createClient } from "@/lib/supabase/server";
import { loginAccessResponse } from "@/lib/supabase/login-access";
import { ImageNotFoundError,logImageFailure,signedImageUrl } from "@/lib/image-storage";
import {
  AVATAR_BUCKET,
  isSafeAvatarStoragePath,
} from "@/lib/avatar-image";

export const runtime="nodejs";

const SIGNED_URL_TTL_SECONDS=7*24*60*60;
const REDIRECT_CACHE_SECONDS=6*24*60*60;

export async function GET(request: Request) {
  try {
    const supabase=await createClient();
    const { data: { user },error: authError }=await supabase.auth.getUser();
    if(authError&&authError.status!==401&&authError.name!=="AuthSessionMissingError") throw authError;
    if(!user) {
      return NextResponse.json({ error: "ログインが必要です" },{ status: 401 });
    }

    const path=new URL(request.url).searchParams.get("path");
    const accessError=await loginAccessResponse(supabase);
    if(accessError) return accessError;
    if(!path||!isSafeAvatarStoragePath(path)) {
      return NextResponse.json({ error: "画像が見つかりません" },{ status: 404 });
    }

    // R2 signing uses server credentials, so apply the same membership condition
    // as the avatars Storage RLS before issuing a URL.
    try {
      const { data: profile,error }=await supabase
        .from("profiles")
        .select("approved")
        .eq("id",user.id)
        .maybeSingle();
      if(error) throw error;
      if(profile?.approved!==true) {
        return NextResponse.json({ error: "画像を閲覧する権限がありません" },{ status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "閲覧権限を確認できませんでした" },{ status: 503 });
    }

    // Stop issuing new seven-day signatures after the worker atomically closes
    // an unreferenced path. Existing redirects keep their six-day cache.
    const retirement=await supabase.rpc("avatar_image_is_retired",{ p_path: path });
    if(retirement.error||typeof retirement.data!=="boolean") throw retirement.error??new Error("Invalid retirement result");
    if(retirement.data) return NextResponse.json({ error: "画像が見つかりません" },{ status: 404,headers: { "Cache-Control": "private, no-store" } });

    let url: string;
    try {
      url=await signedImageUrl(supabase,AVATAR_BUCKET,path,SIGNED_URL_TTL_SECONDS);
    } catch(error) {
      if(error instanceof ImageNotFoundError) return NextResponse.json({ error: "画像が見つかりません" },{ status: 404,headers: { "Cache-Control": "private, no-store" } });
      throw error;
    }

    // The object path changes whenever an avatar is replaced. Cache this private
    // redirect for less than the signed URL lifetime and let Supabase Storage/CDN
    // serve the image bytes directly instead of buffering them in Vercel.
    const response=NextResponse.redirect(new URL(url,getAppPublicOrigin(request.url)),307);
    response.headers.set("Cache-Control",`private, max-age=${REDIRECT_CACHE_SECONDS}, immutable`);
    response.headers.set("Vary","Cookie");
    return response;
  } catch {
    logImageFailure("avatar-read");
    return NextResponse.json({ error: "画像を取得できませんでした" },{ status: 503,headers: { "Cache-Control": "private, no-store" } });
  }
}
