/**
 * ito のサーバーアクションの戻り値。
 *
 * Next.js は Server Action の中で投げた例外を本番で伏せてしまい、
 * 画面には digest つきの「サーバーでエラーが発生しました」しか出ない。
 * 「参加者が0人です」のような、利用者が対処できる理由は伝えたいので、
 * 例外にせず結果として返す。
 */
export type ItoActionResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const FALLBACK_MESSAGE = "実行できませんでした。時間をおいてもう一度お試しください。";

/** サーバー側。失敗した理由を message として持ち帰る。 */
export async function runItoAction<T>(
  action: () => Promise<T>,
): Promise<ItoActionResult<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    // 予期しないエラーはログに残す（Vercel のランタイムログで追える）。
    if (!(error instanceof Error)) console.error("[ito] unexpected error", error);
    return { ok: false, message: error instanceof Error ? error.message : FALLBACK_MESSAGE };
  }
}

/** クライアント側。失敗ならその場で例外にして、呼び出し元の catch で文言を出す。 */
export function unwrapItoResult<T>(result: ItoActionResult<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

export function itoActionMessage(result: ItoActionResult<unknown>): string | null {
  return result.ok ? null : result.message;
}
