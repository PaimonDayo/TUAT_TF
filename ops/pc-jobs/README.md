# PC定期処理（2026-09-27、稼働中）

## PCアプリ集約候補（2026-10-11、未切替）

`config.shared-pc.example.json` の `runtime: "shared-pc"` は、`ops/pc-host` が起動した一つのNextを再利用する。JobsはNextを起動/停止せず、cloud Supabase Authと非公開R2を維持する。既存configでruntimeを省略した専用Next方式は従来どおり。例はdisabledで、既存タスクや設定を変更しない。

共有方式の `appOrigin` は明示した `http://127.0.0.1:<port>` のrootだけ。公開URL・localhost・path・credentials・redirectは拒否する。`PC_APP_RUNTIME` / `NEXT_PUBLIC_PC_APP_RUNTIME`、固定HTTPS `APP_PUBLIC_ORIGIN`、same-originの公開Supabase URL、`PC_BACKEND_INTERNAL_URL=http://127.0.0.1:8000`、cloud Authペア、R2読書き、同期秘密を固定releaseの環境から検査する。`/api/version` のcommit SHAとreleaseId、新hostのrunning/心拍とbackup identityを照合する。`hostStateDirectory`・`backupStatusPath`・既存archive UUID/実DB system IDを固定し、そのgenerationの35分以内pair・120秒未満心拍/target・maintenance解除を確認する。旧backend statusだけで新hostをreadyにしない。RESTのOpenAPI確認はanon keyでloopbackだけへ行い、部員の行は読まない。Auth障害の監視は既存認証経路で行う。

`run.mjs --check <private-config>` はbuildと設定の検査のみ。共有方式のbuildは `ops/pc-host` が担当し、Jobsの `build-production.mjs` は拒否する。`preflight.mjs` は共有Nextを再利用して未認証拒否と既存APIのdryRunを実施し、終わっても共有Nextを止めない。APIのdryRunは実同期元への読取を伴うので、今回の合成試験と同一視しない。

切替時は既存のJobsをdisabledにして実行終了・lock解放を確認してから、同じstateDirectoryとactivateAtを共有方式へ引き継ぐ。journalを空にしない。特に `uncertain` / `sheetWritesBlocked` / 元の失敗履歴は保持し、新旧を同時実行しない。現在稼働中のタスクはこの準備で変更しない。

合成試験: `node --test ops/pc-jobs/scheduler.test.mjs ops/pc-jobs/shared-pc.test.mjs`。固定release不一致、公開/曖昧URL、古い/未来の心拍、maintenance、共有方式の子プロセス不使用、遅いprobe中の無効化、既存journalの再送停止を確認する。OS再起動・定時実行・R2/GAS本番・実端末の確認は別途必要。

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

2026-10-04以降、記録同期の失敗・結果不明は `sheetWritesBlocked` と元の失敗履歴を保持する。同じ枠の再送はせず、翌日以降は `skipSheetWrites` で取り込みだけ継続する。送信・記録の空欄化・返信の処理は保留し、pendingフラグと削除待ちを残す。この結果は `partial` であり、完全成功ではない。送信再開はシートの実値・DB・履歴を照合した復旧後に行う。大会・期限切れ整理の結果不明時の停止方針は従来どおり。

外部メール監視は取りやめ済み。GAS監視・Worker health・署名鍵を稼働条件に含めず、外部healthは書かない。状態はPCのjournal/status.jsonに保存する。旧監視用の準備スクリプトは実行しない。

2026-10-05の修正以降、APIが `sheetWritesUncertain=false` を明示した読み取り失敗/見出し不整合はfailedとして保持し、翌日の送信を保留しない。応答不明・旧API・書き込み後の不一致は従来どおり保留する。既に保留中の書き込みを読み取り成功だけで解除しない。稼働固定リリース、実データ照合、復旧証跡は [10/5の同期復旧](../../docs/SHEET-SYNC-RECOVERY-2026-10-05.md) を参照。

## 本番切替

1. 全dryRun、同期元、バックアップ、現行Productionを確認する。
2. 最新アプリのVercel cronを外し、READYと旧処理終了を確認する。
3. 未来のactivateAt以降だけPCが担当するよう設定し、専用Windowsタスクを設置する。既存DB/backendタスクは変更しない。
4. 3処理の初回結果、二重処理なし、翌日の定時実行を確認する。手動同期との分散排他はないので切替中は実行しない。

切り戻しはPCを無効化し実行終了後に専用タスクを止め、同じ最新アプリへ元のcronを戻す。新旧を同時に動かさない。料金プラン変更やメール監視再開は行わない。

予定の自動同期は2026-09-27オーナー指示で取りやめ。既存予定・手動操作は保持する。install-task.ps1はWindows管理者権限で専用S4Uタスクを無効状態で登録する。切替完了の実状態は9/27記録を参照。
