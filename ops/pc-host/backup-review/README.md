# 切替前の合成暗号化DB復元試験

`node ops/pc-host/backup-review/run.mjs --check` は計画だけを返し、Docker/DB/鍵/ファイルへ触れない。`--execute` だけが、cached imageの正確なIDを確認して `codex-backup-review-<new GUID>-source/restore` と専用volume/internal networkを新規作成する。既存 `supabase-db`、`tuat-review-*`、`codex-auth-dbreview-*` を読取/変更/削除しない。実env、秘密、既存backup、R2、部員データ、Surface/SSH/sudoは使用しない。外部資格情報を継承した環境を拒否する。

合成sourceへcached GoTrue77/Storage67と全candidate migrationを適用し、合成UUID/許可・不許可identity/note/画像参照/退役barrier/旧queueを作る。現行backupと同じ `pg_dump --format=custom --schema=public --schema=auth --schema=storage` と既存 `TUATPC01` AES-256-GCM関数を使用する。別の新規containerではplatform roles/extensionsを用意し、初期auth/storageの重複を取り除いてからcustom archiveをtransactionで復元する。table/schemaのownerとACL、列定義/列ACL/default ACL、RLS policy/function/trigger/constraint、全対象tableの件数・全columnのdigest（UUIDを含む）、部員保存・不許可session・許可取消・退役画像復活拒否を確認する。Vaultは復号済みの合成値から新しいVaultへ登録し、cronは停止状態で復元する。SQL受入操作はrollbackする。誤鍵・改変・別instance・別dumpの組合せはDBへ送る前に拒否する。

**archiveとは別のcold初期設定:** 現行allowlist migrationの `ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_login_access'` はcluster role設定なので、このschema dumpには入らない。fresh targetに無いことを確認した後、レビュー済みのこの非秘密設定だけを明示して復旧し、他のrole設定を変えずに正しい値をassertする。また完全なschema復元のためfresh baselineのpublicを削除すると、initdb既定のPUBLIC USAGEが失われる。archiveはこの既定権限を再出力しないため、sourceのowner=`pg_database_owner`/PUBLIC USAGEをassertして、sourceと同じschema USAGEだけを復旧する（table/function権限は付与しない）。これらはplatform roles/extensionsとともに、archiveだけでは復元できない前提として扱う。ここでのSQL呼出しはPostgREST実HTTP起動の証明ではない。

`.private` の親ACLをowner+SYSTEMへ保護・検査してから合成暗号化archiveを書く。鍵はメモリだけに保持し、終了時にarchiveを削除する。失敗診断も同じprivate領域へ保存し、標準出力には件数/booleanだけを返す。`result.json` は秘密/行内容/鍵を含まない合成証拠。cleanupは今回のgeneration label、正確なname/ID/path/internal networkを再照合した資源だけを対象とし、不一致なら保持して失敗とする。

これは同じhost上の合成DB復元であり、本番backupの鮮度・完全性、実R2 download、別媒体、別端末、cloud Auth、実Push、OS再起動の証明ではない。本番を読む既存 `backup-backend.mjs` / `handoff-restore.mjs` CLIは呼ばない。新しい本番backup scheduler/復元ツールを追加するものでもない。

現行backupに入るのはPCのpublic/auth/storage（AuthはPC shadow UUID。cloud Auth accountは別）、schema内のtable/function/trigger/policy/grant、および組になったVault復号値/Push env/cron metadata。cluster role定義、stack/JWT trust設定、固定host releaseとenv、Server Actions/Drive token暗号鍵、R2資格情報、Auth-only syncのconfig/snapshot/journal、JobsのactivateAt/uncertain/sheetWritesBlocked/履歴、R2画像本体はこのDB archiveに含まれない。画像はR2に別保管され、鍵と最終bucket/prefixを別に復旧する必要がある。

本番のcold/offdevice復元は、対象と専用accountを決めた後で以下を個別確認する。

1. 書込み/Jobs/Auth連携を停止してin-flight操作をdrainし、DB backup時点とjournal/config時点を揃える。結果不明を消去・success化・再送しない。最後のDB/復旧設定pairと各stateをprivate snapshotへ保存し、元hostを保持する。
2. 暗号化pair、固定commit/lockfile/stack imageと配置手順、必要なprivate設定・journalを別媒体へ移す。復号鍵はarchiveとは別の所有者管理経路へ保管し、旧cloud service keyからの派生元を廃棄/変更する前に独立回収を確認する。媒体と秘密のACLを読取前に確認する。
3. 別端末の新規DBへroles/extensionsとpublic schema既定権限→DB→レビュー済みのPostgREST pre-request role設定→Vault/Push→停止cronの順で復元する。cloud Auth issuer/JWKS、PC鍵、同じUUID、allowlist/RLSとREST経由の既存許可取消拒否を照合する。DB中の画像pathからR2 bucketへ対応させる。cloud業務予備・書戻しは復活させない。
4. 固定releaseを対象OS上で `npm ci`/buildして新receiptを作り、env/releaseId/versionを照合する。古いWindows依存/receiptをLinuxへ流用しない。専用accountのACL、S4U/OS再起動、backup-onlyの15分保存と35分鮮度判定、Jobsの旧履歴保持を確認する。
5. 認証・通常読書き・画像・Pushを対象端末で確認してから唯一の公開入口/書込み先/Jobsを有効にする。停止中の書込みや復帰時の書戻しを再開しない。復元後の新しいbackupが回収可能になるまで旧host/backupを保持する。

現行 `SERVER-HANDOFF.md` はPC Auth/Vercel前提の保存手順であり、10/2注記どおりそのまま現構成へ実行しない。現在のbackup起動/15分tickとheartbeatは旧 `run-backend.mjs` が担当する一方、shared-pc Jobsもそのheartbeat/35分backupを要求する。旧backendの廃止前にbackup-onlyと新しいreadinessの担当を確定する必要がある。本試験はこのlive wiringを変更しない。
