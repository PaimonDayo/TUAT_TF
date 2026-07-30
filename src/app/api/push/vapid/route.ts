// Service Worker が購読を作り直すときに使う VAPID 公開鍵を返す。
// 公開鍵はクライアントのバンドルにも含まれる公開情報で、秘密鍵は返さない。
export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
  return new Response(JSON.stringify({ key }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
