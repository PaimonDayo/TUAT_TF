// 現在デプロイされているバージョン（コミットSHA）を返す。
// クライアントが定期的に取得し、起動時と異なれば「更新あり」と判断する。
//
// 値はデプロイごとに固定なので、ビルド時に焼き付けた静的ファイルとして配信する。
// 動的ルートのままだと、部員の端末が定期的に叩くたびに Vercel の関数が動いていた。
export const dynamic = "force-static";

export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    "dev";
  return new Response(JSON.stringify({ version }), {
    headers: { "content-type": "application/json" },
  });
}
