import type { createClient } from "@/lib/supabase/client";

type BrowserClient = ReturnType<typeof createClient>;

export type SafeUpdateResult =
  | { ok: true }
  | { ok: false; reason: "error" | "blocked" };

/**
 * 「エラー無し・0件」の無言失敗（RLS/セッション切れ）を検出して再試行する更新。
 *
 * - `.select("id")` で更新件数を確認する。
 * - 0件なら `auth.refreshSession()` してから一度だけ再試行する。
 * - それでも0件なら `blocked`（権限/セッション）を返す。`error` はクエリ自体の失敗。
 *
 * 重要な更新（お知らせ・目標・プロフィール・予定・ノート 等）はこれを使い、
 * 画面ごとに更新の堅牢さがバラつかないようにする。
 */
export async function safeUpdate(
  supabase: BrowserClient,
  table: string,
  values: Record<string, unknown>,
  match: Record<string, unknown>,
): Promise<SafeUpdateResult> {
  const run = () => {
    let query = supabase.from(table).update(values);
    for (const [key, value] of Object.entries(match)) {
      query = query.eq(key, value);
    }
    return query.select("id");
  };

  let { data, error } = await run();
  if (!error && (!data || data.length === 0)) {
    await supabase.auth.refreshSession();
    ({ data, error } = await run());
  }
  if (error || !data || data.length === 0) {
    return { ok: false, reason: error ? "error" : "blocked" };
  }
  return { ok: true };
}

/** 無言失敗時の標準メッセージ */
export function safeUpdateMessage(reason: "error" | "blocked"): string {
  return reason === "error"
    ? "更新に失敗しました"
    : "更新できませんでした。ページを再読み込みしてからお試しください";
}
