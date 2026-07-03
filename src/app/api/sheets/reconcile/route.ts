import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileOnSwitch } from "@/lib/sheet-sync";

/**
 * 記録の入力元(record_source)を切り替える直前に、その部員自身だけを対象に
 * 一度だけ両側を揃える（2026-07-03インシデントの再発防止。オーナー確定 2026-07-04）。
 * 本人のみ実行可能（他人の入力元は切り替えられないため、対象は常に自分の profile.id）。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    direction?: "to_sheet" | "to_app";
    dryRun?: boolean;
  };
  if (body.direction !== "to_sheet" && body.direction !== "to_app") {
    return NextResponse.json({ error: "directionを指定してください" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const admin = createAdminClient();
  try {
    const result = await reconcileOnSwitch(admin, user.id, body.direction, {
      dryRun: body.dryRun === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同期に失敗しました";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
