# 画像ストレージのR2移行

対象は既存の `avatars` と `tweet-images`。DB・Auth・Realtime・本文はSupabaseに残す。
R2は非公開のStandardバケットを1つ使い、キーを `avatars/<元パス>` / `tweet-images/<元パス>` とする。
public development URL、公開カスタムドメインは有効にしない。アプリが認証し、ストーリーは既存RLSと有効期限を確認してから署名URLへリダイレクトする。

## 実施記録（2026-09-06）

- オーナーの明示承認後、`tuat-tf-images` 限定のAccount Object Read & Writeキーを発行。ローカル `.env.local` とVercel ProductionのSecret型環境変数へ保存。バケットは非公開Standard。
- dry-run: 37画像 / 17,711,786 bytes。avatars 31画像 / 1,159,970 bytes、tweet-images 6画像 / 16,551,816 bytes。元StorageにないDB参照0。
- `.r2-migration/2026-09-06T00-48-19-423Z/` に事前スナップショット、`2026-09-06T00-49-16-799Z/verified.json` に全37件のコピー・SHA-256検証記録。元画像の削除0、DB変更0。
- アプリのimage-storage実装を使って両バケットの署名URL取得・画像ハッシュ一致、署名なしアクセス拒否、一時画像の保存・取得・削除成功を実接続検証。検証後も37画像 / 17,711,786 bytes。
- READ=trueと配信識別子r2-v1はProductionデプロイ `HgymvYiChDSXtgKxdAyy3G2QxRLE`（36bd97f）でREADY確認。続いてWRITE=trueを本番環境に設定。本記録のデプロイで反映する。
- 大学認証を伴うログイン後の画面操作・iOS実機は未確認。認証情報のチャット共有を求めず大学ログインを依頼済み。今期のSupabase累積転送量・9月8日からの制限警告は移行で消えない。
- 古いPWAからのSupabase書き込みは404フォールバックで読める。更新後にコピーを再実行し、新規画像があれば追いつかせる。DB・Authやノート本文は今回移行していない。

## 設定

`.env.example` のR2変数をローカルとVercel Productionに設定する。
API資格情報はこのバケットに限定したObject Read & Writeにする。ブラウザに渡さず、Gitや会話に貼らない。
新しいAPI資格情報の作成・R2契約の有効化はユーザーが画面で確認する。
アプリはS3 APIを使うのでCloudflare有料Workersや独自ドメインは不要。

新規アップロードは認証済みAPIで画像を検証・WebP変換してR2へ保存する。
画像表示のバイト列はR2から直接配信し、Vercelは中継しない。
ストーリーは端末で縮小後3MiBまで（元ファイル12MiBまで）。これはVercelリクエスト上限を避けるため。

## 実施順

1. バケットと資格情報を用意。READ/WRITEフラグはfalseのまま。
2. `node --env-file=.env.local scripts/migrate-images-to-r2.mjs` でdry-run。
   `.r2-migration/<時刻>/` にprofiles/tweetsの画像参照スナップショットと全オブジェクト一覧を保存する（Git対象外）。
3. 件数・容量・対象を確認後、同じコマンドへ `--apply` を付ける。
   元画像をコピーし、R2から再取得してSHA-256一致を確認。既存の異なるオブジェクトは上書きせず停止する。
   検証結果はverified.json。Supabase画像の削除やDB更新はしない。
   references-absent-from-source.jsonにはDB参照があるのに旧Storageにないキーを記録する。
   applyではR2上の存在も確認し、両方にない画像があれば停止する。
   コピー中に投稿・画像変更があるので、切替後も再実行して追いつかせる。
4. Vercelに `R2_READ_ENABLED=true` と `NEXT_PUBLIC_IMAGE_DELIVERY_VERSION=r2-v1` を設定して再デプロイ。
   未移行の404だけSupabaseにフォールバック。R2権限エラー等は隠さない。
5. ログイン後の既存プロフィール・ストーリー画像、未認証アクセス拒否、期限切れ拒否を確認。
6. `R2_WRITE_ENABLED=true` で再デプロイし、新規アイコン・ストーリー投稿、削除・期限切れ清掃を確認。
   古いPWAは当面Supabaseへ書き込む可能性があるため、更新案内後に再度コピーを実施する。
7. 実測した日別Storage EgressとR2容量・リクエスト数を確認する。

## 費用と運用

R2 Standard無料枠は保存10GB-month、Class A操作100万回/月、Class B操作1000万回/月。転送料は無料。
アプリはアップロード前にバケットの全ページを列挙し、既定8GBを超える場合拒否する。
同時アップロードの競合で閾値を少し超え得るため、これは厳密な課金ハードキャップではない。
この検査自体もClass A操作を消費する。画像数・利用者が増えるときはDBでの原子的な容量予約へ置き換える。
`R2_UPLOADS_PAUSED=true` で新規R2書き込みだけを停止できる。読み取りは継続する。
移行スクリプトは運用者用でアプリの容量制限対象外。dry-runの容量確認が必要。
無料枠はアカウント全体で共有されるため、他のR2バケットの利用量も確認する。

元のSupabaseオブジェクトは移行のために削除しない。ただし本人がアイコン変更・削除をした場合と
期限切れストーリーの通常清掃時は両方を削除する（フォールバックで古い画像を復活させないため）。
手動削除されたストーリーや通信切断で放置されたアップロードの孤立画像は、この変更だけでは自動回収しない。
容量監視時に参照一覧と照合し、削除候補を確認する。独立した画像バックアップも別途必要。

## ロールバック

新規R2書き込み開始前ならREAD/WRITEをfalseにして旧配信へ戻せる。
開始後は **WRITEだけfalse、READはtrueを維持する**。R2にしかない画像があるため、両方falseへ戻すと欠落する。
完全に戻す場合はR2-only画像をSupabaseへ逆コピー・ハッシュ検証してからREADを止める。
無料枠を超過したSupabaseへのフォールバックは402になる場合があり、R2移行は今期の累積転送量を取り消さない。

公式仕様: https://developers.cloudflare.com/r2/pricing/
https://developers.cloudflare.com/r2/api/s3/presigned-urls/
