# Supabase復帰手順（期限2026-09-16 15:00 JST）

**2026-09-10: この手順は現状のまま実行不可。** 所有者は旧クラウド更新を後回しとし、9/17以降に別PCをサーバー化する予定。大会記録v2のスキーマと正規化はPCのみ反映済みで、旧クラウドは未適用・凍結中。以下は以前の計画として保持する。自動再開時も古い前提でクラウドへ切り替えず、最新の所有者指示と移行先を確認する。スキーマ比較ガードは維持する。

対象は `tuat-tf.vercel.app` / cloud `snbgxocgdhqtuywrlqrs`。所有者はPC期間中のデータの逆移行を承認済み。**古いDBへURLだけ戻してはいけない。** [引き継ぎ](PC-PRODUCTION-HANDOFF.md) を読み、この本番PCで作業する。

## 1. 復旧材料とクラウドの利用可否

```powershell
node ops/laptop/control-backend.mjs status
node ops/laptop/backup-backend.mjs --verify-download
powershell -NoProfile -File ops/laptop/prepare-backup-wsl.ps1 -RefreshConnection
wsl -d Ubuntu -u root -- bash '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/database-ops-wsl.sh' preflight-cloud
```

短期DB認証は数分で切れるためcloud操作の直前に更新する。接続情報を表示しない。Supabaseがまだ使えなければ無理に切替せず、期限延長も勝手にせず、所有者へ具体的な状態を伝える。

## 2. PCを凍結して最終差分を準備

```powershell
node ops/laptop/control-backend.mjs maintenance-on
node ops/laptop/backup-backend.mjs
wsl -d Ubuntu -u root -- python3 '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/prepare-return-wsl.py'
```

PCのDB書き込みも凍結し、最終snapshot/差分SQL/reportを `/opt/tuat-tf-supabase/transfer/` へ保存する。クラウドには書かない。基準は `cloud-frozen-final-20260909.jsonl`。reportの増減を評価する。データ/SQLをログへ貼らない。スキーマ相違は停止理由であり、ガードを外して通さない。

## 3. クラウドへ原子的に反映し全行比較

下記の日時部分は生成された実際のplan名へ置き換える。

```powershell
powershell -NoProfile -File ops/laptop/prepare-backup-wsl.ps1 -RefreshConnection
wsl -d Ubuntu -u root -- bash '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/database-ops-wsl.sh' apply-return-cloud return-YYYYMMDDHHMMSS
wsl -d Ubuntu -u root -- bash '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/database-ops-wsl.sh' snapshot-cloud return-cloud-verified-YYYYMMDDHHMMSS
```

planのSHA256と対象DB凍結を確認し、SET ROLE postgresで1トランザクション実行。全対象テーブルの基準行、転送後の全行、FKを照合して不一致ならロールバック。成功しても両側の凍結は保持。

生成されたPC最終snapshotとcloud検証snapshotの全テーブル・全行を、database-transfer.pyのread_snapshotと正規化JSON集合で比較する。列/PK/FK定義も確認。cloud独自のAuth sessions等は上書きしないが、削除ユーザーを参照する内部FKが残れば検証は止まるので原因を調べる。運用中の実差分のmanaged cloud適用は当日に検証する。

## 4. Vercel設定・デプロイを戻してからcloud再開

全行一致を確認した後だけ実行:

```powershell
node ops/laptop/save-preview-env.mjs --production --restore-cloud --cloud-data-verified
```

CLIパスが変わっていれば正規インストール先へ修正。保護されたproduction-rollback-env.jsonから読み、秘密値を出力しない。最新masterのコードでVercel Productionを再デプロイする。NEXT_PUBLIC設定はビルド時値なので、環境変数保存だけでは切り替わらない。古いコードへのrollbackは不要。

READY/alias、本番PC APIが404、認証先が元のSupabaseであることを確認してから:

```powershell
powershell -NoProfile -File ops/laptop/prepare-backup-wsl.ps1 -RefreshConnection
wsl -d Ubuntu -u root -- bash '/mnt/c/Paimon Dayo/TUAT_TF/ops/laptop/database-ops-wsl.sh' thaw-cloud
```

cloud書き込みと旧cronを再開する。Vercelの移行用cronはPC_BACKEND_ENABLED=falseなら204で何もしない。ログイン/閲覧/本人保存/画像/同期を確認。失敗時はcloudを再凍結し、どちらに新しい書き込みがあるか確認する。PCだけ安易に再開して分岐を作らない。

## 5. 完了後の整理

PCは凍結したまま最終バックアップを保存。タスクTUAT PC Backend Temporaryを停止/無効化し、当アプリの中継だけ終了。スリープ抑止はプロセス終了で解除。不要なVercel PC設定・試験デプロイ・Google専用callbackを整理するが、継続利用するR2画像設定は削除しない。

PCデータ・基準・バックアップ・復号材料を確認完了まで保持。バックアップ削除は別途保存期間を確認。復帰日時/最新デプロイ/検証/残事項をAGENTS.mdと引き継ぎへ記録。

適用前に中断してPCへ戻す場合は、cloudを凍結したままPCのpc_ops.control.frozenをfalseへ戻し、control-backend.mjs maintenance-off。期限後は同コマンドが拒否する。cloudで新しい書き込みが発生した後は、この単純な再開を行わない。
