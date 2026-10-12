# 切替前の合成暗号化DB復元試験

2026-10-12追加: `runReview({localAuth:true})` は専用DBの非公開network namespaceに
実GoTrue/PostgRESTを起動し、新規UUID/refresh/本人保存/他人拒否/偽署名拒否を確認する。
public/auth/storageに加えてpc_opsをdumpし、208件のcandidate migrationの復元後に
local Pushの明示opt-in・本人端末・claim一回・mirror拒否・backup read-only・opt-outを
rollback付きで検証する。ACLはNULL（既定権限）と同じ明示ACLをacldefaultで正規化して
実効権限を比較する。実Google、実Push、実画像、実R2コピーの証明にはしない。
Windowsアカウントの新設は保留し、Linux側の専用実行主体を切替前条件として整理する。

ID確認前に同じGoogleシートが手動登録済みだった場合も、確認済みIDを記録して保留し、DB修復・予約UUIDでの直接INSERTのどちらでも別登録を作れないことを追加検証する。元の登録は再利用・更新・削除しない。

`20261011190000_google_sheet_creation_attempts.sql` も含めて復元する。作成前の予約、Google IDだけ確認済み、整形とDB登録が完了済み、整形は確認済みでDB登録のみ未完了の4状態を実RPCで作り、暗号化したarchiveから戻す。5つの合成identityのうちA/C/D/Eだけに作成権限を与え、Bは不許可を維持する。復元後も本人と現在の権限だけが記録を読め、結果不明に期限や新UUIDで再作成許可を与えず、既知IDのDB登録だけを再開できることを検証する。整形の未確認は登録後も保持する。URLの別表記による重複登録を拒否し、完了後の正当な編集・削除を再登録で戻さない。Google呼出しは0回で、全SQL受入操作をrollbackして全table digestの一致を再確認する。

2026-10-11追加候補は `20261011170000_sheet_push_attempts.sql` を含む全migrationを使用する。実service-role RPCでreserved（古い未知結果）、confirmed/partial、completed/applied、completed/supersededの4記録receiptと未知clear receiptを作る。3つ目の承認済み合成profileを同日・同じ物理slotへ向け、復元後に別profileのbeginとclear解決も拒否されることを確認する。復元後の実anon/authenticated/service-role操作でRLS/ACL・RPC限定更新を検証し、未知/部分/適用済みversionのbeginは新しいattempt UUIDでもdispatch許可0、部分receiptの後付け成功化禁止、marker_versionと新しいpending編集の保持、未知receiptの削除後保持・CSV上書き拒否をassertする。実providerは呼ばない。全受入操作をrollbackして元の全table digestへ戻ることを確認する。既存の8区分metadata比較は維持する。

旧 `result.json` は上書きせず、実行前後のSHA256一致を新証拠へ記録する。新結果は親ACLを保護した `.private/<fresh generation>/result.json` に `wx` で一度だけ書き、driver・fixture・受入SQL・tests・READMEと全migrationのSHA256を含める。合成暗号化pairと失敗診断も同じprivate generationに置くが、暗号鍵はメモリだけでファイルへ保存しない。最後にpairを削除し、秘密を含まない結果だけを残す。

DB readinessは経過45秒、1probe最大5秒で制限する。他のDockerコマンドは最大60秒、cleanupは作成前に登録した正確な資源名を再検査して所有label/IDを照合し、削除後にも全attempt資源の不存在を確認する。WSL/Docker timeout・出力上限超過・signal/強制終了ではLinux子プロセスの完了を証明できないため、後の一覧が空でもcleanup成功とは報告しない。失敗・未知の実行を無条件で再実行せず、新generationの実行は所有者が結果と残資源を確認した後に承認する。

`node ops/pc-host/backup-review/run.mjs --check` は計画だけを返し、Docker/DB/鍵/ファイルへ触れない。`--execute` だけが、cached imageの正確なIDを確認して `codex-backup-review-<new GUID>-source/restore` と専用volume/internal networkを新規作成する。既存 `supabase-db`、`tuat-review-*`、`codex-auth-dbreview-*` を読取/変更/削除しない。実env、秘密、既存backup、R2、部員データ、Surface/SSH/sudoは使用しない。外部資格情報を継承した環境を拒否する。

合成sourceへcached GoTrue77/Storage67と全candidate migrationを適用し、合成UUID/許可・不許可identity/note/画像参照/退役barrier/旧queueを作る。現行backupと同じ `pg_dump --format=custom --schema=public --schema=auth --schema=storage` と既存 `TUATPC01` AES-256-GCM関数を使用する。別の新規containerではplatform roles/extensionsを用意し、初期auth/storageの重複を取り除いてからcustom archiveをtransactionで復元する。table/schemaのownerとACL、列定義/列ACL/default ACL、RLS policy/function/trigger/constraint、全対象tableの件数・全columnのdigest（UUIDを含む）、部員保存・不許可session・許可取消・退役画像復活拒否を確認する。Vaultは復号済みの合成値から新しいVaultへ登録し、cronは停止状態で復元する。SQL受入操作はrollbackする。誤鍵・改変・別instance・別dumpの組合せはDBへ送る前に拒否する。

**archiveとは別のcold初期設定:** 現行allowlist migrationの `ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_login_access'` はcluster role設定なので、このschema dumpには入らない。fresh targetに無いことを確認した後、レビュー済みのこの非秘密設定だけを明示して復旧し、他のrole設定を変えずに正しい値をassertする。また完全なschema復元のためfresh baselineのpublicを削除すると、initdb既定のPUBLIC USAGEが失われる。archiveはこの既定権限を再出力しないため、sourceのowner=`pg_database_owner`/PUBLIC USAGEをassertして、sourceと同じschema USAGEだけを復旧する（table/function権限は付与しない）。これらはplatform roles/extensionsとともに、archiveだけでは復元できない前提として扱う。ここでのSQL呼出しはPostgREST実HTTP起動の証明ではない。

`.private` の親ACLをowner+SYSTEMへ保護・検査してから合成暗号化archiveを書く。鍵はメモリだけに保持し、終了時にarchiveを削除する。失敗診断も同じprivate領域へ保存し、標準出力には件数/booleanと非秘密の新証拠pathだけを返す。各generationの `result.json` は秘密/行内容/鍵を含まない合成証拠。cleanupは今回のgeneration label、正確なname/ID/path/internal networkを再照合した資源だけを対象とし、不一致なら保持して失敗とする。

これは同じhost上の合成DB復元であり、本番backupの鮮度・完全性、実R2 download、別媒体、別端末、cloud Auth、実Push、OS再起動の証明ではない。本番を読む既存 `backup-backend.mjs` / `handoff-restore.mjs` CLIは呼ばない。新しい本番backup scheduler/復元ツールを追加するものでもない。

現行backupに入るのはPCのpublic/auth/storage（AuthはPC shadow UUID。cloud Auth accountは別）、schema内のtable/function/trigger/policy/grant、および組になったVault復号値/Push env/cron metadata。cluster role定義、stack/JWT trust設定、固定host releaseとenv、Server Actions/Drive token暗号鍵、R2資格情報、Auth-only syncのconfig/snapshot/journal、JobsのactivateAt/uncertain/sheetWritesBlocked/履歴、R2画像本体はこのDB archiveに含まれない。画像はR2に別保管され、鍵と最終bucket/prefixを別に復旧する必要がある。

本番のcold/offdevice復元は、対象と専用accountを決めた後で以下を個別確認する。

1. 書込み/Jobs/Auth連携を停止してin-flight操作をdrainし、DB backup時点とjournal/config時点を揃える。結果不明を消去・success化・再送しない。最後のDB/復旧設定pairと各stateをprivate snapshotへ保存し、元hostを保持する。
2. 暗号化pair、固定commit/lockfile/stack imageと配置手順、必要なprivate設定・journalを別媒体へ移す。復号鍵はarchiveとは別の所有者管理経路へ保管し、旧cloud service keyからの派生元を廃棄/変更する前に独立回収を確認する。媒体と秘密のACLを読取前に確認する。
3. 別端末の新規DBへroles/extensionsとpublic schema既定権限→DB→レビュー済みのPostgREST pre-request role設定→Vault/Push→停止cronの順で復元する。cloud Auth issuer/JWKS、PC鍵、同じUUID、allowlist/RLSとREST経由の既存許可取消拒否を照合する。DB中の画像pathからR2 bucketへ対応させる。cloud業務予備・書戻しは復活させない。
4. 固定releaseを対象OS上で `npm ci`/buildして新receiptを作り、env/releaseId/versionを照合する。古いWindows依存/receiptをLinuxへ流用しない。専用accountのACL、S4U/OS再起動、backup-onlyの15分保存と35分鮮度判定、Jobsの旧履歴保持を確認する。
5. 認証・通常読書き・画像・Pushを対象端末で確認してから唯一の公開入口/書込み先/Jobsを有効にする。停止中の書込みや復帰時の書戻しを再開しない。復元後の新しいbackupが回収可能になるまで旧host/backupを保持する。

現行 `SERVER-HANDOFF.md` はPC Auth/Vercel前提の保存手順であり、10/2注記どおりそのまま現構成へ実行しない。現在のbackup起動/15分tickとheartbeatは旧 `run-backend.mjs` が担当する一方、shared-pc Jobsもそのheartbeat/35分backupを要求する。旧backendの廃止前にbackup-onlyと新しいreadinessの担当を確定する必要がある。本試験はこのlive wiringを変更しない。
