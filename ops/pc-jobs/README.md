# PC定期処理（2026-09-27、稼働中）

現行Nextアプリを127.0.0.1だけで起動し、既存APIを同じ頻度で呼ぶ。画面はVercelを維持する。

| 処理 | 日本時間 | API |
| --- | --- | --- |
| 記録同期 | 毎日0時 | POST /api/sheets/sync |
| 大会同期 | 5分ごと | POST /api/competition-program/sync |
| 期限切れ整理 | 毎日12:17 | GET /api/cron/cleanup-stories |

**Vercel cronは0件。TUAT PC Jobsが3処理を実行中。** 15:32 JSTに切替、アプリ固定リリースはffbbd96。記録同期・期限切れ整理の初回実行と大会同期の定刻実行が成功。最新検証は [9/27記録](../../docs/OPERATIONS-2026-09-27.md)。古い隔離候補や合成buildを本番へ使わない。

## 準備と検証

Node24を使う。prepare.mjs はtracked HEADから新規リリースを作る。prepare-production.mjs は既存PC/同期設定からACL保護した非公開環境とdisabled configを作り、既存設定は上書きしない。

build-production.mjs <private-config> は専用リリースをbuildする。preflight.mjs <private-config> は一時起動し、未認証拒否と記録・大会のdryRunを行う。--without-records は部分確認専用で、全処理の準備完了を意味しない。結果は非公開stateに保存し標準出力は件数のみ。

run.mjs --check <private-config> は設定・buildを検査するだけ。--run はenabled=trueが必要。PC以外のDB設定・クラウド認証設定は拒否する。Nextはloopback限定で、トンネルへ追加しない。

## 実行と停止

実行前にjournalへrunningを保存する。結果不明・部分失敗はその処理を停止し、自動再送しない。PCのmaintenance・心拍・35分以内のバックアップを確認する。停止期間の全回分は再生せず、各処理の最新枠だけを行う。

config.enabled=falseにすると次の処理へ進まず、実行中の要求を待って終了する。強制終了時のrunner.lockとuncertainは、プロセス・データ・同期履歴を確認してから復旧する。再起動しただけでは失敗状態を消さない。

外部メール監視は取りやめ済み。GAS監視・Worker health・署名鍵を稼働条件に含めず、外部healthは書かない。状態はPCのjournal/status.jsonに保存する。旧監視用の準備スクリプトは実行しない。

## 本番切替

1. 全dryRun、同期元、バックアップ、現行Productionを確認する。
2. 最新アプリのVercel cronを外し、READYと旧処理終了を確認する。
3. 未来のactivateAt以降だけPCが担当するよう設定し、専用Windowsタスクを設置する。既存DB/backendタスクは変更しない。
4. 3処理の初回結果、二重処理なし、翌日の定時実行を確認する。手動同期との分散排他はないので切替中は実行しない。

切り戻しはPCを無効化し実行終了後に専用タスクを止め、同じ最新アプリへ元のcronを戻す。新旧を同時に動かさない。料金プラン変更やメール監視再開は行わない。

予定の自動同期は2026-09-27オーナー指示で取りやめ。既存予定・手動操作は保持する。install-task.ps1はWindows管理者権限で専用S4Uタスクを無効状態で登録する。切替完了の実状態は9/27記録を参照。
