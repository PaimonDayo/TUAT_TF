# 現行アプリの文書案内

更新: 2026-09-23。現在の実装はコード、作業ルールと依頼履歴は [AGENTS.md](../AGENTS.md) を確認する。日付付きの報告は、その日時点の検証記録であり、未実装タスクや再実行の指示ではない。

## 開発・運用で使う文書

| 用途 | 文書 |
| --- | --- |
| 開発環境・コマンド | [README](../README.md) |
| 現在のPC本番構成・起動・保全 | [PC本番運用](../ops/laptop/PC-PRODUCTION-HANDOFF.md) |
| PC移設 / 旧クラウドへの復帰条件 | [PC移設](../ops/laptop/SERVER-HANDOFF.md) / [復帰](../ops/laptop/RETURN-TO-SUPABASE.md) |
| UI・データ取得・更新の規約 | [UI統一](UI-UNIFICATION.md) / [文言](WORDING-GUIDELINES.md) |
| 直近の現行アプリ改善 | [UI・通信改善](UI-PERFORMANCE-2026-09-23.md) / [ホーム・文書整理](HOME-2026-09-23.md) |
| 監査の修正状況と確認方法 | [実測監査](AUDIT-2026-09-21.md) |
| 利用量の確認経路 | [サービス状態](SERVICE-STATUS.md) / [9月22日の改善記録](USAGE-2026-09-22.md) |

新アプリの検討・実装は `tuat-tf-next/` の独立した作業。現行アプリのルートビルド・テストへ混ぜない。再構築案の存在を、現行機能の廃止・DB移行の承認と解釈しない。

## 設計・移行の記録

[構造整理](ARCHITECTURE-REFACTOR-PLAN.md)、[大会記録](COMPETITION-RESULTS-PLAN.md)、[シート同期](SHEETS-SYNC-PLAN.md)、[通知](NOTIFICATIONS-PLAN.md)、[R2移行](R2-MIGRATION.md)、[転送量監査](EGRESS-AUDIT.md)、[9月22日のUI](UI-2026-09-22.md) は設計意図や検証の参照用として残す。古い未完了表記を現在の状態とみなさず、コード・最新の作業ログと照合する。

## 2026-09-23に整理した文書

- `CLAUDE-HANDOFF.md`: 6〜9月の重複ログと失効した「最新」案内。入口をこの索引とPC本番運用へ統合。
- `ANNOUNCE-MEMO.md`: 7月の公開前説明下書き。現在の機能・共有範囲の案内として使えないため削除。
- `ops/laptop/CLAUDE-PRODUCTION-UPDATE.md`: 9月10日の大会記録反映指示。適用済み/未実行が同居していたため削除。接続先確認・秘密保持・本番確認の原則はPC本番運用とAGENTSに維持。
- `ops/laptop/ONE-WEEK-CUTOVER.md`: 完了した9月9日の切替前計画。現在の起動手順と復帰条件に集約。

削除前の本文はGit履歴から参照できる。障害の教訓、監査証跡、復旧手順は削除していない。
