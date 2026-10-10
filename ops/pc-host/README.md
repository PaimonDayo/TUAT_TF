# PC集約の切替前候補

Cloudflare固定Tunnel → loopback gateway → Next一つ → 現行PC DB。
認証はクラウドSupabase、画像は非公開R2。業務の予備/再送/lease発見は使わない。
既存本番を切り替えるまで、旧backend/Jobs/mirrorと本番envを変更しない。

公開入口と個別操作の権限は別の境界。gatewayはbody/期限/Origin/内部headerを制限するが、本人確認とRLSはアプリとDBで必須。
入口は127.0.0.1のみで起動し、固定Tunnelはgatewayだけへ接続する。Next・DB管理口をLANへ公開しない。

切替時はAuthユーザー/許可リスト連携を先に分離し、旧業務予備の未解決書込みを照合してから停止する。
Jobsは同じNextへ接続するshared-pcモードを使用し、旧journalの履歴を保持する。
Googleログイン/Drive callback、Push購読、PWA/旧タブのorigin変更は切替前に確認する。

## 準備と起動

Node24と、WindowsではPowerShell7を使用する。独立したrelease checkoutに `npm ci` で依存を用意する。開発checkoutのnode_modules・.envを共用しない。releaseは正確なcommitへ固定し、未コミット/未追跡ファイルがある場合はbuildを拒否する。

`config.example.json` と `environment.example.env` は置換前の例であり、起動設定ではない。実env・stateはGit外の専用directoryへ置く。Windowsでは新規directoryのACLを本人/SYSTEMだけにしてから書き、既存directoryの明示的な他者権限やjunctionを拒否する。これは現在の実行者との境界であり、開発/AIから本番秘密を隔離する専用OSアカウントの配置確認は別途必要。

1. `enabled:false` で `node ops/pc-host/build.mjs <private-config.json>` を実行する。Next出力は保護済みstate内だけへ保存する。固定commit・lockfile・Node・env・buildのreceiptを作成する。
2. `node ops/pc-host/run.mjs <private-config.json>` でreceiptの一致を確認する。`--execute` と `enabled:true` が揃うまではlistenerを起動しない。
3. `stage-task.ps1` は専用accountを指定して無効なWindows Task XMLを作るだけ。登録/起動や既存タスクの削除は行わない。最終移行時にaccount・ACL・起動条件を照合してから登録する。
4. 起動はNext/gatewayとも127.0.0.1限定。gateway公開前に `/api/version` のcommitとreleaseIdを照合する。Task wrapperのmutexとstate lockで競合を拒否する。以前の候補で検証したlock primitiveを再利用し、managed wrapperがOS mutexを持ち、元PIDの停止とファイル同一性を再確認できる場合だけ古いlockを回収する。直接起動・生存/再利用PID・権限不明・壊れたlockは拒否する。

更新前に共有Jobsの新規dispatchを止めてjournalの未解決操作を確認し、host設定を無効にしてgateway経由の進行中要求をdrainする。Nextの標準終了処理をIPC経由で呼び、親死亡時も子だけを終了する。結果不明の書込みを再送しない。旧release/env/receiptを保全したまま、新releaseは別directoryとreleaseIdでbuildする。同じstate内で実行者は一つ。DB変更のrollbackはhostの旧版起動と別に評価する。

buildのreceiptはruntime node_modulesや公開ファイルの全バイトを証明するものではない。専用npm ci、releaseを実行account以外から変更できないACL、復元元の保全を配置時に確認する。`.next/cache`等の可変診断/cacheはhashから除外する。

## 合成試験と残条件

`synthetic-review.mjs --check` は外部接続やlistener/key生成を行わない。既存のowner-named private stateを指定した `--serve --state-dir <path>` だけが、独立のfake PC API18180/cloud Auth18181を起動する。実サービスの資格情報を引き継がず、画像/Sheetsを無効にする。これはbuilt NextのHTTP/cookie/経路/障害の試験用で、実DBのRLS・Google・Drive・R2・Push・PWAの証拠ではない。

本番前には固定無料入口/hostname、新originのOAuth callback、Drive正規source、R2実効フラグ、Push鍵/購読、専用accountと秘密隔離、実写真/通常保存/旧タブ/実端末PWA、OS再起動と別媒体復元を確認する。現在の候補はこれらの未確認が残るため切替可能とは報告しない。
