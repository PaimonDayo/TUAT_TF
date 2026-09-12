// 同期の入出力の形。

export type { SheetMember } from "@/lib/sheet-public-csv";

export type SyncOptions = {
  dryRun?: boolean;
  onlySheet?: string;
  onlySheets?: string[];
};

export type SyncResult = {
  inserted: number; // スプシ→アプリ 新規取込
  updated: number; // スプシ→アプリ 更新取込
  pushed: number; // アプリ→スプシ 書き戻し
  conflicts: string[]; // 同日に複数記録があり安全のためスキップした "シート名 日付"
  skippedMembers: string[];
  /** 前回取得時とCSV本文が同一で、解析・DB突合を省略した部員 */
  unchangedMembers: string[];
  /** 部員ごとの失敗（1人の不調で他の部員の同期を止めないための部分失敗設計） */
  failedMembers: { member: string; reason: string }[];
  sheetReplies: number;
  dryRun: boolean;
};
