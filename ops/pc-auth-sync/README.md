# 独立Auth連携候補（2026-10-11、未切替）

アプリ/通常DBをPCへ集約し、クラウドSupabase Authを維持するための独立アダプター。業務予備・書戻し・mirror-stateへ触れない。現行 `ops/laptop/cloud-mirror.mjs` と既存タスクはこの準備で変更しない。実データ・本番設定への実行は今回行わない。

対象はPCのAuth shadow identityと最小プロフィール作成、PC正本の `login_email_allowlist` をcloud Authへ配る処理だけ。cloudの業務profiles・roles・投稿等は読まない/写さない。cloud Authで確認済みのGoogleユーザーを、大学メールまたはPCの完全一致許可メールで選び、同じUUIDをPCに作る。同一メールの別UUID・同一UUIDの別メールは自動修正せず停止する。許可取消後は新規provisioningを止めるが、既存identityやプロフィールを削除しない。既存JWTの拒否はPC正本のallowlist/RLS/認証経路が担当する。

Auth作成時のDB triggerが通常プロフィールを作る。無い場合だけid/emailの最小INSERTを行い、現在のDB登録既定値を使う。既存プロフィール、role、approved、status、profile_rolesを更新せず、user_metadataや権限はコピーしない。即時の初回ログインはアプリcallbackの同UUID provisioningを保持し、定期同期だけに依存しない。

設定は `config.example.json` と専用private envに分ける。PCは明示loopback、cloudはproject refと一致するHTTPS Auth URLだけ。従来mirrorやrollback envを暗黙に読まず、`PC_AUTH_SYNC_SERVICE_ROLE_KEY` / `CLOUD_AUTH_SYNC_SERVICE_ROLE_KEY` の専用用途credential名を使う。公開Gitへ実値を置かず、本番専用実行ユーザーのACLでenv/config/stateを保護する。例はdisabled。stateは新規作成時にowner+SYSTEMだけへ保護し、そのACLを確認してからlock/snapshot/journalを作る。既存stateの継承権限・他principalの明示権限・junctionは書込み前に拒否する。snapshot保存時も親ACLを再検証し、排他的な新規tempを使う。

```powershell
node ops/pc-auth-sync/run.mjs --check <private-config.json>
node ops/pc-auth-sync/run.mjs <private-config.json>
# enabled=trueの承認済み設定で、fresh dry-runの直後だけ実行する
node ops/pc-auth-sync/run.mjs --apply <private-config.json>
node ops/pc-auth-sync/run.mjs --reconcile <private-config.json>
```

省略時はdry-run。全ページを読み、競合を検査して件数だけを標準出力へ返す。対象の変更前snapshotとplanは専用stateへ非公開保存する。秘密はsnapshotへ入れない。`--check` は設定の検査だけでネットワーク/行読取なし。`--apply` はenabled=true、同じtarget/sourceId、10分以内で現在差分/対象が一致するdry-runとsnapshotが必要。各操作の直前にも現状を読み、許可取消やcallbackによる先行作成を確認する。cloud allowlistは旧guardとの互換のため `x-tuat-mirror: 1` を付け、取消→追加の順で反映する。

専用lockを取得し、journalへrunningを保存してから1件ずつdispatchする。対象件数とUUID/email/audit列の一致を確認する。HTTP失敗・応答消失・malformed・0件更新は保守的にuncertainへ保存し、以後の書込みを止める。再起動でrunningをuncertainにし、無条件に再送しない。`--reconcile` は書込み要求を送らず、元planの正確な結果が読めたものだけをsuccessにする。未反映/競合の項目はuncertainのまま保持し、snapshot/journal/現状を運用者が照合する。stale lockは自動回収しない。

業務mirrorを将来廃止する前に、独立連携の大学/許可外部初回ログイン・プロフィール・本人JWT/RLS・取消後の既存session拒否を確認し、旧mirrorのAuth/allowlist担当をdrainしてからこちらを定期起動する。定期起動では同じ専用stateを使い、各回dry-run→結果確認→applyを組み合わせる。旧mirrorと同時にallowlistを書かず、未解決の業務書込みとmirror-stateも先に照合する。タスク登録/本番適用はこの候補に含めない。

`node --test ops/pc-auth-sync/sync.test.mjs` は合成データ/transportだけで、許可外部メール、UUID競合、profile trigger、取消、全ページ、取得失敗、dry-run既定、保存前journal、応答消失と照合、0件結果、変更中の許可を検証する。本番Auth/RLS実機操作や運用定時実行の証明ではない。
