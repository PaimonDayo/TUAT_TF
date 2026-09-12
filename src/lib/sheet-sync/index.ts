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
 *   'app'   -> push app records to the sheet, and import CSV-only dates.
 *              Existing app dates remain authoritative and are never overwritten from CSV.
 */


// 実体はこのフォルダ内の各モジュール。アプリ側は @/lib/sheet-sync から使う。

export * from "./types";
export * from "./dates";
export * from "./field-map";
export * from "./gas-client";
export * from "./push";
export * from "./reconcile";
export * from "./pull";
export * from "./replies";
export * from "./run";
