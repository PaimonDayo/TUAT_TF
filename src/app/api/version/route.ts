// 現在デプロイされているバージョン（コミットSHA）を返す。
// クライアントが定期的に取得し、起動時と異なれば「更新あり」と判断する。
export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    "dev";
  return new Response(JSON.stringify({ version }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, max-age=0",
    },
  });
}
