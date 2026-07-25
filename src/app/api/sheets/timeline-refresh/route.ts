import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSheetSync } from "@/lib/sheet-sync";
import { sheetSyncChunkSize } from "@/lib/sheet-sync-chunk";

export const maxDuration = 60;

type Chunk = {
  sheetNames: string[];
  startOffset: number;
  endOffset: number;
  totalMembers: number;
  cycleComplete: boolean;
};

function parseChunk(data: unknown): Chunk {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("同期範囲を取得できませんでした");
  const value = data as Record<string, unknown>;
  return {
    sheetNames: Array.isArray(value.sheetNames) ? value.sheetNames.filter((name): name is string => typeof name === "string") : [],
    startOffset: Number(value.startOffset) || 0,
    endOffset: Number(value.endOffset) || 0,
    totalMembers: Number(value.totalMembers) || 0,
    cycleComplete: value.cycleComplete === true,
  };
}

/** DB表示後に呼ぶ軽量CSV同期。1回は小さいチャンクだけ処理し、クライアントが順次継続する。 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (process.env.SHEET_SYNC_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: true, changed: false, cycleComplete: true });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_sheet_sync_chunk", {
      requested_chunk_size: sheetSyncChunkSize(),
      reset_cycle: false,
    });
    if (error) throw error;
    const chunk = parseChunk(data);
    if (chunk.sheetNames.length === 0) {
      return NextResponse.json({ ok: true, changed: false, ...chunk });
    }
    const result = await runSheetSync(admin, { onlySheets: chunk.sheetNames });
    return NextResponse.json({
      ok: true,
      changed: result.inserted + result.updated + result.sheetReplies > 0,
      inserted: result.inserted,
      updated: result.updated,
      failedMembers: result.failedMembers,
      ...chunk,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "同期に失敗しました" },
      { status: 500 },
    );
  }
}
