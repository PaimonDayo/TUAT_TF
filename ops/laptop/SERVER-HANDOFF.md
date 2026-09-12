# サーバーを別のPCへ引き継ぐ

現在の本番はVercel（アプリ）＋所有者PCのWSL内Supabase（DB/Auth）＋R2（画像）。
この文書は**DB/Authを別のWindows PCへ移す**手順。アプリのURL（https://tuat-tf.vercel.app ）は変えない。

先に [PC-PRODUCTION-HANDOFF.md](PC-PRODUCTION-HANDOFF.md)（現行構成）と
[RETURN-TO-SUPABASE.md](RETURN-TO-SUPABASE.md)（クラウドへ戻す道）を読む。
**クラウドへ戻せるならそれが本筋**で、この手順はPCを使い続けると決めたときのもの。

- 新PCと旧PCで**同時にDBを書かない**。切替は「旧を止める → 移す → 新を上げる」の順で、重なる時間を作らない。
- DB・環境変数・デプロイを複数のエージェント/端末から同時に触らない。
- 秘密値をチャット・Git・ログへ貼らない。受け渡しは所有者の安全な経路で。

## 0. 用語

| もの | 実体 | 引き継ぎでどうするか |
|---|---|---|
| スタック | WSL内 `/opt/tuat-tf-supabase` のDocker一式 | 新PCで作り直す |
| instanceId | `.contingency/backend/config.json` | **新PCは新しい値**。旧の値はバックアップの置き場所を指すので控えておく |
| bridgeKey | 同上 | 新PCで新規生成し、Vercelへ登録し直す |
| backupKey | 旧クラウドのservice-roleキーから決まる | **生成しない**。`.env.local` があれば同じ値が再現する |
| スタックの `.env` | WSL内 `/opt/tuat-tf-supabase/.env` | 下の「鍵をどうするか」を参照 |

### 鍵をどうするか（先に決める）

`initialize-wsl.sh` は毎回**新しいJWT鍵**を作る。どちらを選ぶかで部員への影響が変わる。

- **A. 旧PCの `.env` を持ち込む（推奨）** — anon/serviceキーとJWT秘密が変わらないので、
  Vercel側のキー差し替えが要らず、**部員のログインもそのまま**。移すのは所有者の安全な経路で。
- **B. 新しく生成する** — 鍵が変わるため**全員が再ログイン**、Vercelの
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` も差し替える。
  旧PCの `.env` を取り出せないときだけ。

## 1. 新PCの用意（旧PCは動かしたまま・切替なし）

1. Git・Node・WSL2を入れ、このリポジトリをクローンする。**フォルダ名は自由**
   （スクリプトはチェックアウト位置を自分で解決する。旧PCの `C:\Paimon Dayo\TUAT_TF` に合わせる必要はない）。
2. WSLのディストリ名が `Ubuntu` 以外なら `.contingency/server.json` を作る:

   ```json
   { "wslDistro": "Ubuntu-24.04" }
   ```

   `stackDir` と `composeProject` も同じファイルで変えられる（通常は既定のままでよい）。
3. 所有者の安全な経路で次を新PCへ置く。**中身は表示しない**:
   - `.env.local`（R2の資格情報と、backupKeyの元になる旧クラウドキー）
   - `.contingency/local-app.env`（PC側Supabaseのキー）
   - 選択Aなら旧PCの `/opt/tuat-tf-supabase/.env`
4. WSL側の下ごしらえ:

   ```powershell
   node ops/laptop/prepare.mjs                 # .contingency/runtime のひな形を用意
   wsl -d <distro> -u root -- sh "$(wsl -d <distro> -- wslpath -a "$PWD")/ops/laptop/install-wsl.sh"
   wsl -d <distro> -u root -- sh "$(wsl -d <distro> -- wslpath -a "$PWD")/ops/laptop/install-cloudflared-wsl.sh"
   wsl -d <distro> -u root -- sh "$(wsl -d <distro> -- wslpath -a "$PWD")/ops/laptop/initialize-wsl.sh" "$(wsl -d <distro> -- wslpath -a "$PWD")/.contingency/runtime"
   ```

   `initialize-wsl.sh` の引数はこのチェックアウトの `.contingency/runtime`。
   選択Aなら、この直後に旧PCの `.env` を `/opt/tuat-tf-supabase/.env` へ `install -m 0600` で置き換える。
5. 準備できたか確認する（読み取りだけ）:

   ```powershell
   node ops/laptop/handoff-preflight.mjs
   powershell -NoProfile -File ops/laptop/preflight.ps1
   ```

   `ready: true` になるまで次へ進まない。

## 2. データを移す前のリハーサル（本番はまだ触らない）

旧PCのinstanceIdを調べ、最新のバックアップを取り出せることを**新PCで**確かめる:

```powershell
node ops/laptop/handoff-restore.mjs --list
node ops/laptop/handoff-restore.mjs --from-instance <旧PCのinstanceId>
```

`.contingency/backend/handoff-restore.dump` ができ、チェックサムと復号（AES-256-GCM）が通れば、
新PCから旧PCのデータを復旧できることの証明になる。ここで失敗するなら `.env.local` の持ち込みを疑う。

**この `.dump` は部員の個人情報そのもの。** 復元し終えたら必ず消す。

## 3. 切替（ここから停止時間が発生する）

1. 部員へ停止時間を知らせる。
2. **旧PC**: 書き込みを止める。

   ```powershell
   node ops/laptop/control-backend.mjs maintenance-on
   ```

3. **旧PC**: 最後のバックアップを取り、R2に上がったことを確認する。

   ```powershell
   node ops/laptop/backup-backend.mjs
   node ops/laptop/control-backend.mjs status
   ```

4. **旧PC**: 中継を止める（DBは消さない）。

   ```powershell
   powershell -NoProfile -File ops/laptop/runtime.ps1 stop
   ```

   Windowsタスク **TUAT PC Backend Temporary** も無効化する。ここを忘れると新旧が同時に動く。
5. **新PC**: 手順2をやり直して**最後の**バックアップを取り出す（手順2で取ったものは古い）。
6. **新PC**: DBへ流し込む。`restore-wsl.sh` はWSL内 `/opt/tuat-tf-supabase/backups/<日時>/` の
   SQL一式を前提にしているので、`handoff-restore.dump`（custom形式）を入れるときは
   `pg_restore` を直接使う:

   ```powershell
   node -e "const{execFileSync}=require('child_process');execFileSync('wsl',['-d','Ubuntu','-u','root','--','docker','exec','-i','supabase-db','pg_restore','-U','supabase_admin','-d','postgres','--no-owner','--single-transaction'],{input:require('fs').readFileSync('.contingency/backend/handoff-restore.dump'),stdio:['pipe','inherit','inherit']})"
   ```

   失敗したらロールバックされる。SQLエラーを無視しない。
   `public.profiles` が既にあるなら、それは初期化済みのスタック＝**先に作り直す**。
7. **新PC**: 自分のconfigを作り、Google認証とVercelを合わせる。

   ```powershell
   node ops/laptop/prepare-backend.mjs
   node ops/laptop/configure-backend-auth.mjs
   ```

   `configure-backend-auth.mjs` はGoogleのcallbackを設定する。Google Cloud Console側の
   リダイレクトURIも合わせる。
8. **新PC**: 監視付きで起動する。

   ```powershell
   powershell -NoProfile -File ops/laptop/install-backend-task.ps1
   node ops/laptop/control-backend.mjs status
   node ops/laptop/audit-backend.mjs
   ```

9. **新PC**: 本番を向ける前に、Previewで確かめる。

   ```powershell
   node ops/laptop/stage-backend-preview.mjs
   node ops/laptop/verify-backend-preview.mjs
   ```

10. 問題なければ本番のVercel環境変数を差し替え、再デプロイする（`save-preview-env.mjs --production`）。
    `PC_BACKEND_BRIDGE_KEY` と `PC_BACKEND_INSTANCE_ID` は**新PCの値**。選択Bならキー2本も。
11. `node ops/laptop/control-backend.mjs maintenance-off` で書き込みを再開する。
12. 実機（iOS PWA）でログイン・記録入力・出欠・通知を通しで確認する。
    デスクトップとビルド成功を実機確認の代わりにしない。

## 4. 切り戻し

新PCで問題が出たら、**新PCを止めてから**旧PCの中継とタスクを戻し、Vercelの環境変数を旧PCの
bridgeKey/instanceIdへ戻す。旧PCのDBは消していないので、切替後に新PCへ入った書き込みだけが失われる。
失う量を小さくするため、切替直後は長く様子を見る。

## 5. 引き継ぎ後のかたづけ

- 旧PCの `.contingency/backend/` の秘密ファイルと残った `.enc` を、新PCの運用が安定してから消す。
- R2の旧instanceId配下のバックアップは、**新PCで数日分の控えが貯まるまで残す**。
- Windowsタスクを旧PCから削除する（`Unregister-ScheduledTask -TaskName 'TUAT PC Backend Temporary'`）。

## 付録: PC固有の値がどこにあるか

以前は `Ubuntu` や `/mnt/c/Paimon Dayo/TUAT_TF` がスクリプトに直接書かれていて、
別のPCでは動かなかった。今は次の2つに集約してある:

- `ops/laptop/server-profile.mjs` … Node側
- `ops/laptop/server-profile.ps1` … PowerShell側

どちらも既定値は現行PCと同じで、`.contingency/server.json` があればそれで上書きする。
チェックアウト位置は `wslpath -a` で毎回解決するので、フォルダ名は自由。
