# サービス使用量の確認（2026-10-05）

この文書は前回の本人用検証・使用量確認の記録。今回の公開範囲と反映状況は[現役生向け運営と本番反映](OB-MEMBER-PRODUCTION-2026-10-05.md)を優先する。

担当: Codex。所有者の依頼により、Vercel・Supabase・Cloudflare の現在使用量と負荷要因を読み取り確認する。課金プラン、支出上限、Vercel のビルド設定、本番 DB・環境変数・デプロイは変更しない。秘密値・実ユーザーのデータ・アカウントのメールは記録しない。

調査時間: 2026-10-05 10:51～11:06 JST。既存公式 CLI と公式 API を使用。今回の UI ツールへ有効なブラウザは接続されていない。提供元の集計には遅延があるため、照会時刻と最新データ時刻を区別する。過去の文書の料金・残額を現在値として転用していない。

## Vercel

公式 CLI 60.1.3 の `usage --json`、`--breakdown daily`、`--group-by project` を現行チームに指定した。API 認証は CLI 内で使用し、秘密値を出力していない。

- 現行プランは Pro。請求期間は 2026-10-03 16:00 ～ 2026-11-03 17:00 JST。
- 月 $20 の利用クレジットは約 $1.24 消費（6.2%）、約 $18.76 残り。固定 Pro 料金 $20 と、このクレジット内の従量使用を区別する。API が返す約 $21.24 のサービス原価合計を、追加請求 $21.24 と読み替えない。
- 日別の従量原価は 10/3 LA 日付で約 $0.723、10/4 LA 日付の途中で約 $0.513。LA 日付は JST の日付とは一致しない。

| 主な従量項目 | 現在使用量 | 原価概数 |
| --- | ---: | ---: |
| Build CPU | 92 分 | $0.322 |
| Fast Origin Transfer | 0.827 GB | $0.223 |
| Observability | 179,285 events | $0.215 |
| Fluid Active CPU | 0.854 時間 | $0.172 |
| CDN Requests | 36,706 | $0.095 |
| Fluid Provisioned Memory | 5.614 GB-hour | $0.094 |
| Fast Data Transfer | 0.500 GB | $0.080 |
| Function Invocations | 65,225 | $0.039 |

プロジェクト別では現行 `tuat-tf` が約 $1.060、旧 `tuat-tf-pc-preview` が build 52 分だけで $0.182。現行プロジェクトの build は 40 分。別プロジェクトの約 $0.00015 と、プロジェクトに帰属しない固定料金を区別した。

照会時点のクレジット消費を約 1.789 日で割り、請求期間約 31.042 日へ線形延長すると、従量使用は約 $21.6/月、クレジット超過は約 $1.6 となる。これは観測開始後の build 集中を含む短期間の推定で、確定請求でも大会当日の予測でもない。即時の枠枯渇を示す値ではないが、毎修正の build を避けてまとめる既存方針が有効。クレジットの残りは全チームで共有される。

料金の解釈は [公式 Pro プラン](https://vercel.com/docs/plans/pro-plan)、取得方法は [公式 CLI usage](https://vercel.com/docs/cli/usage) を参照。旧 Preview のビルド停止や Ignored Build Step は、今回の読み取り監査では変更していない。

## Supabase

既存 CLI 2.119.0 と Management API により、現対象のクラウドプロジェクトが `ACTIVE_HEALTHY`、組織プランが `free` であることを確認。公式の専用 [read-only query API](https://supabase.com/docs/reference/api/v1-read-only-query) で `pg_database_size(current_database())` の一つの集計だけを取得した。実ユーザーの行は読んでいない。

- DB 容量は 31,132,819 bytes（約 31.1 MB）。公開 Free 枠 500 MB と比較すると約 6.2%。設定 API のディスク割当 2 GB を Free の DB 容量枠と混同しない。
- API 件数の短期窓 2026-10-05 10:47～11:00 JST では、Auth 199 件、REST 8 件、Storage/Realtime 0 件が返った。毎分の Auth 往復は複数あり、検証済み JWT の `getClaims()` で不要な認証往復を省く既存のローカル修正と方向が一致する。この短期件数から MAU や月転送量は推定しない。
- **今請求期の Egress、MAU、Functions 等の使用量とリセット日は未取得。** 公式ダッシュボードの使用量・契約・警告 API は CLI の PAT を受け付けず 401。公開 Management API に組織 usage ルートはなく、対象照会は 404。成功したプロジェクト状態や小さな DB 容量だけを根拠に、月 5 GB の Egress 枠も安全とは断定しない。

公開プラン枠は [公式料金](https://supabase.com/pricing) を照合した。Management API 認証とダッシュボードの認証は別経路。接続可能な管理画面で今期 Usage を読む必要が残る。プラグインのディレクトリも検索し、Supabase 連携は未接続と確認したが、説明されている SQL/プロジェクト機能だけで今回の請求使用量が取得できるとは判断しない。新しい認証・連携・権限は追加していない。

## Cloudflare

既存 Wrangler の通常 OAuth 更新後、公式 GraphQL Analytics で R2 と Workers を読み取った。課金用 API と契約照会は 403 だったため、現在の Workers 契約、請求期間、確定金額は未取得。`default_usage_model: standard` だけでは無料/有料を判定しない。

**R2:** アカウントのバケット一覧は現在一つで、保存量の最新サンプルは 2026-10-05 10:10 JST。362 objects、payload 528,624,236 bytes、metadata 54,785 bytes（計約 0.529 GB）。これは瞬間保存量であり、日別ピークから計算する GB-month の請求使用量そのものではない。

10/1 09:00 JST（10/1 00:00 UTC）～10/5 10:57 JST の成功操作は次のとおり。実際の請求期間が確認できていないので、**カレンダー月の集計**として扱う。

| R2 操作 | 成功件数 | Standard 無料枠との比較 |
| --- | ---: | --- |
| Class A（PutObject + ListObjects） | 21,070 | 100 万/月の約 2.1% |
| Class B（GetObject + HeadObject） | 89,307 | 1,000 万/月の約 0.89% |
| DeleteObject / DeleteObjects | 921 | 従量原価とは別に記録 |

同じ速度が 31 日続く推定では Class A 約 16 万、Class B 約 68 万で、Standard 無料操作枠には余裕がある。現在の保存量が一定なら約 0.529 GB-month となるが、月中の過去ピークや Infrequent Access の実課金量を確認済みとは扱わない。R2 の直接 egress は無料で、操作・保存料金とは別。[公式 R2 料金](https://developers.cloudflare.com/r2/pricing/)、[公式 R2 Analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/) に照合した。

集計には PutObject の `internalError` 4 件もあった。原因・対象 object・当時の利用者影響は未確認。11:02 JST の既存本番 status では心拍 healthy、直近の検証済みバックアップは 10:52 JST。少数の過去エラーが現在の保護停止を示すとは判断しない。

**Workers:** `tuat-pc-rest-relay` の UTC 日別は 10/1 4,221、10/2 3,897、10/3 3,899、10/4 3,709、10/5 途中 274 requests。集計 error は全日 0。仮に Free の 10 万 requests/日で比較しても、一日最大約 4.2% の規模。現在契約を Free と断定せず、`error: 0` を全 REST 操作の成功保証とも扱わない。[公式 Workers 料金](https://developers.cloudflare.com/workers/platform/pricing/)、[公式 Workers Analytics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/) を参照。

## 負荷要因と判断

- Vercel の従量原価は build、SSR/Origin transfer、Observability が中心。ローカル検証を先行し、公開をまとめる方針を継続する。旧 Preview の build も実費を使っているが、設定停止を勝手に適用しない。
- Supabase はクラウド Auth と5分ごとの予備同期。同期の差分 state、通常1日1回の全件照合、失敗行の上書き保護を維持し、負荷軽減を理由に安全な書戻しを止めない。
- R2 は20秒ごとの本番接続先心拍、暗号化バックアップ、画像の GET/HEAD が定常負荷。操作枠は現状の集計と推定では逼迫していない。180秒の接続先有効期間、バックアップ保護、存在確認を弱める変更は行わない。
- 独立検証の Next/gateway は loopback で稼働し、既存 HTTPS トンネル `/login` は 200・専用ログイン文言を確認。接続枠を保持したまま読み取り確認した。旧 Vercel Preview をこの隔離環境と取り違えない。

## 終了状態

読み取り監査とこの公開可能な記録だけを作成。請求書・支払情報・CLI 秘密値・実ユーザーデータは保存/出力していない。原集計と調査用スクリプトは git 無視の独立検証領域へ置いた。commit、push、本番 master 反映、Production deploy、本番 migration、課金/設定変更はなし。DB サイズと API メタデータの読み取り、CLI の通常 OAuth セッション更新は実施した。

未確認: Supabase 今期の月転送量/MAU/リセット日、Cloudflare の現在契約/請求期間/実請求、Vercel の支出上限設定、大会当日のピーク負荷・実回線。これらを 0、無料、または安全と推定して完了報告しない。
