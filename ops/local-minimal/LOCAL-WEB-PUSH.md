# ローカル Web Push の opt-in

既存 Next と既存 Jobs を利用し、Vault/pg_net/Edge Function の実行サービスを最小構成へ戻さずに配信する。既定の cloud/PC runtime は変更しない。ライブラリは現在の Edge Function と同系統の `web-push` を Node 対応の **3.6.7** に固定し、暗号化・VAPID はライブラリへ任せる。[公式 API と対応 Node](https://github.com/web-push-libs/web-push/tree/v3.6.7)

## 経路と保持する権限

`notifications INSERT → pc_ops.local_push_delivery → existing shared-local Jobs → /api/push/deliver → browser Push provider`。各配信を送信前に atomic claim する。HTTP provider の成功、購読失効、失敗、結果不明を記録する。古い claimed、failed、uncertain は pending に戻さず、lease の時間切れや Jobs 再起動を再送の許可にしない。アプリ画面の通知一覧は従来の notifications を使用する。

配信 route は `LOCAL_WEB_PUSH_ENABLED=true` と有効なローカル runtime を要求し、既存 `CRON_SECRET` の Bearer を検証する。DB の claim/complete RPC は service_role のみ。本人の「通知が届くか試す」は従来の authenticated RPC を使い、auth.uid() の所有端末だけを同じ配信待ち表へ入れる。通知一覧へテスト行を追加しない。

pc_ops の配信状態はローカル専用で、cloud mirror/writeback に含めない。コピーから再配信しないため。mirror 通知は enqueue しない。backup read-only は service_role、test RPC、claim、complete、購読削除にも適用する。active claimed が残る間は停止・結果確認を終えてからバックアップする。

## 有効化は別操作

この候補の `20261012181000_local_web_push.sql` は新しい時刻で追加した冪等migration。繰り返し適用しても既存 cloud trigger/RPC の source、trigger mode、Vault 設定を変更せず、有効化しない。適用前に対象 DB のスナップショットと dryRun を行う。本番へ適用済みとは扱わない。

独立ローカル DB の administrator session でのみ、次を実行する。既存 trigger mode を保存して cloud への二重配信を止める。既存 test RPC には local policy が有効な時だけの分岐を加え、元の cloud ロジックと権限を保持する。

```sql
BEGIN;
SET LOCAL pc_ops.local_runtime = 'on';
SELECT pc_ops.set_local_push_enabled(true);
COMMIT;
```

アプリと Jobs の private env に `LOCAL_WEB_PUSH_ENABLED=true`、既存と整合する `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` を設定する。公開鍵だけを新しい値へ変えない。秘密は repo/log に保存しない。既存 shared-local Jobs に1分周期の push drain が追加され、既定の3件の schedule と dedicated runtime は変わらない。

止める場合はまず Jobs の新規 dispatch を止め、送信中の結果を確認する。同じ administrator marker で `set_local_push_enabled(false)` を呼ぶと元の cloud trigger mode に戻る。保留/claimed/uncertain を消去・success に変更しない。

## 検証と実機の未確認

- network-none の使い捨て Postgres: 冪等適用、cloud source/mode の保持、明示 opt-in、本人の端末だけのテスト、service_role claim、二回/古い claim の再送なし、mirror、backup read-only、元 trigger mode の復元を確認。
- ネット遮断 Linux の合成 HTTP provider: web-push が作った暗号化 payload と VAPID を受け、偽端末の鍵で元の通知 payload を復号。許可 endpoint と所有者/端末、404/410/403 の失効整理、削除0件の失敗、未知結果一回、readonly で無配信/無書込みを確認。
- 外部 provider、実端末、実通知、実 subscription は使っていない。主担当の追加 Next+DB HTTP 結合試験と本番適用は別に確認する。

## 切替前の購読整合

元候補の当時の read-only 棚卸しでは実 subscription が **15件**あり、今回の候補では現行件数を再取得していない。未使用とは扱えない。private snapshot を取り、UUID、所有 user UUID、endpoint と鍵の fingerprint、created_at/last_seen_at を照合してから merge する。実 endpoint や鍵をログへ出さず、同じ endpoint の別所有者、片側だけの登録、既存 VAPID 鍵との差を解決する。登録後に RLS と本人の端末範囲を確認する。

workers.dev などへ origin が変わると、古い origin の Service Worker の購読を新 origin の PWA と同一扱いにはできない。購読をコピーするだけで移行完了とせず、新 origin・Google 認証・PWA からの再登録を実端末で確認する。403 の自動整理を、誤ったサーバー鍵の一括交換の代用にしない。
