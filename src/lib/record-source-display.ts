/**
 * タイムラインの各投稿に「アプリ由来 / スプレッドシート由来」を出すかどうか。
 *
 * 出るのはシステム管理者だけ（運用の確認用で、一般部員には関係がない情報のため）。
 * 既定は**オン**。以前は cookie が "1" のときだけ出す＝未設定だと出ない作りで、
 * 端末を変えたり cookie が消えたりすると黙って見えなくなっていた（オーナー報告 2026-09-13）。
 * 見たくないときは設定→システム管理→「記録の保存元を表示」で切る（"0" が入る）。
 */
export const RECORD_SOURCE_COOKIE = "show-record-source";

/** cookie 単体の状態。設定画面のトグルの初期値に使う。 */
export function recordSourceEnabled(cookieValue: string | undefined): boolean {
  return cookieValue !== "0";
}

/** 実際に投稿へ出すか。権限が無ければ cookie に関係なく出さない。 */
export function showRecordSourceFor(
  canManageSystem: boolean,
  cookieValue: string | undefined,
): boolean {
  return canManageSystem && recordSourceEnabled(cookieValue);
}
