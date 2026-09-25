/**
 * TF構造スプレッドシート（部員別シート）と practice_records の同期。
 * GASブリッジ（TF/gas/Code.gs を Web App 公開）を HTTP で叩く。
 * 詳細・マッピング: docs/SHEETS-SYNC-PLAN.md
 *
 * 見出し名ベースで突合する（中長距離＝低強度等の数値枠／短距離＝メニュー等の自由記述／
 * ユーザー追加のカスタム項目＝アプリ上の項目名）。項目名とシート列名が一致する項目だけ同期する。
 *
 * 同期方向は部員ごとに固定（profiles.record_source）:
 *   'sheet' → pullのみ（シート→アプリ）。確認済みの対応列は空欄も含めて反映し、
 *             シートを唯一の正とする。シートに行が無い日は触らない（安全側）。
 *             アプリ→シートの書き戻しはしない。
 *   'app'   → アプリの記録をスプシへ書き込む。スプシにしかない日は取り込み、スプシで直接直した
 *             （空でない）値もアプリへ反映する（2026-07-27 の方針。2026-09-26 に反映漏れを修正）。
 * どちらも、書き戻し待ちの日と「アプリで消した日」（sheet_pending_clears）は取り込まない。
 * アプリで記録を消したり日付を変えたりしたら、スプシの元の日の欄を空にする（2026-09-26 オーナー確定）。
 */


// 実体はこのフォルダ内の各モジュール。アプリ側は @/lib/sheet-sync から使う。

export * from "./types";
export * from "./dates";
export * from "./field-map";
export * from "./gas-client";
export * from "./push";
export * from "./clear";
export * from "./reconcile";
export * from "./pull";
export * from "./replies";
export * from "./run";
