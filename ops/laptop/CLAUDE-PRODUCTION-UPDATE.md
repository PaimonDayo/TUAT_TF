# Claudeからの本番更新（2026-09-10）

追記: 所有者の最新指示により大会記録v2はこのPCで適用し、旧クラウド更新は後回し。9/17以降は別PCをサーバー化する予定。既存正規化の実行も今回明示承認され、確実に変換できる18件へ適用済み。以下の「方針のみ・未実行」は今回の適用前の記録として扱う。

最初に [PC-PRODUCTION-HANDOFF.md](PC-PRODUCTION-HANDOFF.md) と [RETURN-TO-SUPABASE.md](RETURN-TO-SUPABASE.md) を読む。この案内は接続権限やクラウド環境のpush制限を新たに付与するものではない。

## 実行場所の確認

現在の本番はVercel + 所有者PCのWSL内Supabase。旧managed Supabaseは凍結中。`.env.local` やSupabase CLIの既存リンクを本番接続先とみなして `supabase db push` しない。

- このPCのClaude Code: `C:\Paimon Dayo\TUAT_TF` から下記の読み取り確認を実行できる。秘密値をチャットへ渡してもらう必要はない。
- Claude Web/クラウド・別PC: このPCのWSLや秘密ファイルにはアクセスできない。Git上の手順だけでは本番DBへ接続できない。コードとmigrationの準備は続け、適用はこのPCのClaude Code等へ引き継ぐ。DB/Studioの公開や本番キーのGit追加で解決しない。
- セッション自体にブランチ以外へのpush制限がある場合、この文書で制限を回避しない。制限のない所有者PCのセッションで統合する。

## このPCでの初期確認（読み取り）

```powershell
git status --short
node ops/laptop/control-backend.mjs status
node ops/laptop/audit-backend.mjs
powershell -NoProfile -File ops/laptop/runtime.ps1 status
```

状態ファイルのhealthyだけで判断せず、心拍・バックアップの時刻と実API疎通を確認する。WSLは `Ubuntu`、構成は `/opt/tuat-tf-supabase`、Docker projectは `tuat-contingency`。別PCの同名コンテナで代用しない。

PC用アプリ設定は `.contingency/local-app.env`。秘密値を表示せず、必要なプロセスだけで読み込む。Vercelの既存Production設定は保持する。一般Previewへ本番設定を複製しない。

## migrationを含む更新

1. 対象ブランチと最新masterの差分、未適用migration、現在のPCスキーマを確認する。DB・環境変数・デプロイは一人の担当だけが変更する。
2. 本番変更前にバックアップと対象データのスナップショットを保存する。別DBでmigrationを検証する。
3. PC一時運用中のスキーマ変更は9月16日の逆移行にも影響する。PC・旧クラウド・移行基準snapshotの整合方法を変更内容に合わせて設計し、復帰リハーサルで検証してから適用する。旧クラウドの書き込み凍結やスキーマ比較ガードを外して通さない。既存の復帰コマンドだけで対応できるとは仮定しない。
4. 検証したmigrationを現在の本番PCへ適用し、履歴・列・制約・RLSを確認する。旧クラウドへの `db push` だけで本番適用済みと報告しない。
5. AGENTS.mdの検証とmaster統合手順に従い、対象コミットのVercel Production READY・alias・本番動作まで確認する。ブランチのPreview成功だけでは完了ではない。

## 大会記録入力の引き継ぎ

対象: `claude/competition-record-input-standardization-0bca68`。対象ブランチの `docs/COMPETITION-RESULTS-PLAN.md` と `scripts/dryrun-pb-normalize.ts` を読んでから作業する。

既存データの正規化は「方針のみ・未実行」の指示を維持する。本番反映の準備を理由に一括更新しない。dry-runも実装が書き込みなしであることと接続先を確認し、PC設定を指定する。`.env.local` を指定した過去のコマンドをそのまま再利用しない。

iOS PWAの結果フォーム切替、大会選択時の日付、目標ページのPB表示は実機未確認。デスクトップやビルドの成功を実機確認済みとしない。
