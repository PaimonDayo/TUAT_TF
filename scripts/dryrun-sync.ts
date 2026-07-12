// 修正後の sheet-sync を本番データに対して dryRun 実行する一時スクリプト（書き込みなし）。
// 実行: npx tsx --env-file=.env.local scripts/dryrun-sync.ts
import { createClient } from "@supabase/supabase-js";
import { runSheetSync } from "../src/lib/sheet-sync";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const result = await runSheetSync(admin as never, { dryRun: true });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
