import { NextResponse } from "next/server";
import { getAppPublicOrigin } from "@/lib/app-public-origin";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { ImageNotFoundError,ImageUploadError,logImageFailure,readImageUpload,signedImageUrl,uploadImage } from "@/lib/image-storage";
import { cleanupNoteImages } from "@/lib/note-image-cleanup";
import { TWEET_IMAGE_MAX_UPLOAD_BYTES } from "@/lib/tweet-image";
export const runtime="nodejs";
export async function GET(request: Request) {
  try {
    const sb=await createClient();
    const {
      data: { user },error: authError,
    }=await sb.auth.getUser();
    if(authError&&authError.status!==401&&authError.name!=="AuthSessionMissingError") throw authError;
    if(!user)
      return NextResponse.json({ error: "ログインが必要です" },{ status: 401 });
    const id=new URL(request.url).searchParams.get("id");
    if(!id)
      return NextResponse.json(
        { error: "画像が見つかりません" },
        { status: 404 },
      );
    const { data,error }=await sb
      .from("note_article_images")
      .select("path")
      .eq("id",id)
      .maybeSingle();
    if(error) throw error;
    if(!data)
      return NextResponse.json(
        { error: "画像が見つかりません" },
        { status: 404 },
      );
    try {
      const url=await signedImageUrl(sb,"note-images",data.path,300);
      const response=NextResponse.redirect(new URL(url,getAppPublicOrigin(request.url)),307);
      response.headers.set("Cache-Control","private, max-age=240");
      response.headers.set("Vary","Cookie");
      return response;
    } catch(error) {
      if(error instanceof ImageNotFoundError) return NextResponse.json({ error: "画像が見つかりません" },{ status: 404,headers: { "Cache-Control": "private, no-store" } });
      throw error;
    }
  } catch {
    logImageFailure("note-image-read");
    return NextResponse.json(
      { error: "画像を取得できませんでした" },
      { status: 503,headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
export async function POST(request: Request) {
  try {
    const sb=await createClient();
    const {
      data: { user },error: authError,
    }=await sb.auth.getUser();
    if(authError&&authError.status!==401&&authError.name!=="AuthSessionMissingError") throw authError;
    if(!user)
      return NextResponse.json({ error: "ログインが必要です" },{ status: 401 });
    const articleId=new URL(request.url).searchParams.get("articleId");
    if(!articleId)
      return NextResponse.json(
        { error: "記事が見つかりません" },
        { status: 404 },
      );
    const { data: article,error: articleError }=await sb
      .from("note_articles")
      .select("note_id")
      .eq("id",articleId)
      .maybeSingle();
    if(articleError) return NextResponse.json({ error: "記事を確認できませんでした" },{ status: 503 });
    const permission=article
      ? await sb.rpc("can_edit_note",{ target_note_id: article.note_id })
      :null;
    if(permission?.error) return NextResponse.json({ error: "編集権限を確認できませんでした" },{ status: 503 });
    if(!permission?.data)
      return NextResponse.json(
        { error: "画像を追加する権限がありません" },
        { status: 403 },
      );
    if(
      !["image/jpeg","image/png","image/webp"].includes(
        request.headers.get("content-type")?.split(";")[0]??"",
      )
    )
      return NextResponse.json(
        { error: "JPG・PNG・WebPを選んでください" },
        { status: 415 },
      );
    if(
      Number(request.headers.get("content-length"))>TWEET_IMAGE_MAX_UPLOAD_BYTES
    )
      return NextResponse.json(
        { error: "画像の容量が大きすぎます" },
        { status: 413 },
      );
    let input: Buffer;
    try { input=await readImageUpload(request,TWEET_IMAGE_MAX_UPLOAD_BYTES); }
    catch(error) {
      if(error instanceof ImageUploadError) return NextResponse.json({ error: error.message },{ status: error.status });
      return NextResponse.json({ error: "画像を受信できませんでした" },{ status: 503 });
    }
    let output: Buffer;
    try {
      output=await sharp(input,{ limitInputPixels: 50_000_000 })
        .rotate()
        .resize(1600,1600,{ fit: "inside",withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      return NextResponse.json(
        { error: "画像を読み込めませんでした" },
        { status: 400 },
      );
    }
    if(output.length>TWEET_IMAGE_MAX_UPLOAD_BYTES)
      return NextResponse.json(
        { error: "画像の容量が大きすぎます" },
        { status: 413 },
      );
    const uploadId=new URL(request.url).searchParams.get("uploadId");
    if(
      !uploadId||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        uploadId,
      )
    )
      return NextResponse.json(
        { error: "画像の識別情報が不正です" },
        { status: 400 },
      );
    const path=`${articleId}/${uploadId}.webp`;
    const existing=await sb
      .from("note_article_images")
      .select("id,path")
      .eq("path",path)
      .maybeSingle();
    if(existing.error)
      return NextResponse.json(
        { error: "画像を確認できませんでした" },
        { status: 503 },
      );
    if(existing.data)
      return NextResponse.json(existing.data,{
        headers: { "Cache-Control": "no-store" },
      });
    try {
      await uploadImage(sb,"note-images",path,output);
    } catch {
      return NextResponse.json(
        { error: "画像を保存できませんでした" },
        { status: 503 },
      );
    }
    let result: { data: { id: string; path: string }|null; error: unknown };
    try {
      result=await sb
        .from("note_article_images")
        .insert({ article_id: articleId,path,created_by: user.id })
        .select("id,path")
        .single();
    } catch { result={ data: null,error: true }; }
    if(result.error||!result.data) {
      // A lost insert response must not queue a potentially referenced image for deletion.
      // Reconcile the stable upload path once; never replay the insert or delete blindly.
      try {
        const confirmed=await sb.from("note_article_images").select("id,path").eq("path",path).maybeSingle();
        if(!confirmed.error&&confirmed.data) return NextResponse.json(confirmed.data,{ headers: { "Cache-Control": "no-store" } });
      } catch { /* Preserve the object until its registration outcome can be verified. */ }
      const failure=result.error as { code?: string; message?: string }|null;
      if(failure?.code==="P0001"&&failure.message==="An article can have at most 6 photos") {
        return NextResponse.json({ error: "1記事につき6枚まで追加できます" },{ status: 409,headers: { "Cache-Control": "private, no-store" } });
      }
      logImageFailure("note-image-register-result");
      return NextResponse.json(
        { error: "画像の登録結果を確認できませんでした。画面を開き直して確認してください" },
        { status: 503,headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(result.data,{
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    logImageFailure("note-image-upload");
    return NextResponse.json({ error: "画像を保存できませんでした。時間をおいてお試しください" },{ status: 503,headers: { "Cache-Control": "private, no-store" } });
  }
}
export async function DELETE(request: Request) {
  try {
    const sb=await createClient();
    const {
      data: { user },error: authError,
    }=await sb.auth.getUser();
    if(authError&&authError.status!==401&&authError.name!=="AuthSessionMissingError") throw authError;
    if(!user)
      return NextResponse.json({ error: "ログインが必要です" },{ status: 401 });
    const id=new URL(request.url).searchParams.get("id");
    if(!id)
      return NextResponse.json(
        { error: "画像が見つかりません" },
        { status: 404 },
      );
    const existing=await sb
      .from("note_article_images")
      .select("id")
      .eq("id",id)
      .maybeSingle();
    if(existing.error)
      return NextResponse.json(
        { error: "画像を確認できませんでした" },
        { status: 503 },
      );
    if(!existing.data) return NextResponse.json({ ok: true });
    const { data,error }=await sb
      .from("note_article_images")
      .delete()
      .eq("id",id)
      .select("id");
    if(error) return NextResponse.json({ error: "画像の削除結果を確認できませんでした。画面を開き直して確認してください" },{ status: 503 });
    if(!data?.length)
      return NextResponse.json(
        { error: "画像を削除できませんでした" },
        { status: 403 },
      );
    await cleanupNoteImages().catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch {
    logImageFailure("note-image-delete");
    return NextResponse.json({ error: "画像の削除結果を確認できませんでした。画面を開き直して確認してください" },{ status: 503,headers: { "Cache-Control": "private, no-store" } });
  }
}
