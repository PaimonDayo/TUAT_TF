# OB共有スプレッドシートへの公開

2026-10-10。アプリから、既にOBへ共有した `188DwdYDpRuk4a27whOiu5lhhNK4MDaSeYRfXTHDhBAw` へ組・記録・出場状況を反映する独立GAS。編集権限を持つ人は出場状況と「エントリー編集」タブの組・レーン・追加を変更でき、編集時にPCへ保存する。5分同期は取りこぼし確認とアプリ側の更新取得に残す。既存の合体版・PC Jobs・Vercel cronは維持する。

## 導入順

1. 共有スプシの全タブ・セル・書式を退避し、アプリの専用APIを本番反映する。共有スプシに紐付けず、所有者だけが編集できる独立Apps Scriptプロジェクトへ `Code.js` と `appsscript.json` を置く。Sheets v4の拡張サービスを有効にする。
2. Script Propertiesの `OB_RESULTS_READ_TOKEN` へ、既存 `SHEET_SYNC_SECRET` を鍵としたHMAC-SHA256（hex）を設定する。署名対象は改行なしのJSON `['ob-results-v1','ob-2026','188DwdYDpRuk4a27whOiu5lhhNK4MDaSeYRfXTHDhBAw']`（実際のJSONはダブルクォート）。正確な実装は `src/lib/ob-results-feed-auth.ts` の `obResultsFeedToken`。元鍵やトークンをログ・git・共有スプシへ書かない。トークンは対象年/Sheet用の読取りだけに使え、元鍵の回転で失効する。
3. 原本を確認し、12タブの「アプリが生成した部分」の範囲だけを `OB_RESULTS_INITIAL_RANGES` に設定する。形式は `[ {"sheetId":123,"rows":20,"columns":5}, ... ]`。行数は見出し・組間空行を含む。元の生成領域にない独自追記の列・下の行を含めない。既存タブ名/IDは保持する。初回範囲なしでは一切書けない。
4. `dryRunObResultsPublish()` を実行し、対象12タブ・参加登録件数・各タブの前後行列数を確認する。氏名・記録・秘密はdryRun結果に含まれない。承認済みの生成範囲を確認してから `publishObResults()` を1回実行する。
5. `20261010110000_ob_sheet_status.sql` を本番PCへsnapshot/dryRun後に適用する。書戻しはservice_role専用・OB2026固定で、署名済み登録ID/種目/登録版/運営版を照合する。Script Propertiesの `OB_RESULTS_WRITE_TOKEN` に `obResultsStatusToken` の専用HMACを保存する。読取り鍵とは別権限で、元鍵・署名対象は同関数に従う。
6. `20261010130000_ob_sheet_edits.sql` を同じPCへsnapshot/rollback dryRun後に適用する。`installObResultsTrigger()` は既存5分trigger1本を再利用し、同じSheetの編集時/行追加削除時triggerを各1本作る。既存の認可範囲を使い、共有権限は変更しない。Google側の起動・通信時間があるので正確な秒数は保証しない。

## 編集の操作

- 組移動: 「エントリー編集」の組（例：混合2組）とレーン・試技順を変更する。記録開始済み/確定済みの配置移動とレーン衝突は拒否し、入力を残す。
- 既存の人の種目追加: 行をコピーして種目を選ぶ。参加者番号・氏名・学年・区分を保つ。種目変更も追加として扱い、元の登録は残る。
- 人の追加: 空行へ氏名・学年・区分・種目を入力し、参加者番号は空欄にする。登録後に番号が付く。同じ新規人物の複数種目は一括で1人へ統合する。既存名との重複は拒否する。
- 大会種目そのものの新設、行削除による登録取消、既存氏名の修正はこの入力の対象外。実施済みの11種目への出場追加とDNSを使う。
- 番号は氏名や実DB UUIDから復元できないHMAC別名。署名と原IDは私有Propertiesだけに置く。連絡先・プロフィール・懇親会は読まない。
- アプリと競合した場合は変更した行を元へ戻して最新を取り直す。保存結果不明は同一UUIDの要求だけを再確認する。GoogleのAPI書込は編集triggerを起動せず、同じ版の同期は書込0で止まる。

初回準備を親担当が済ませた場合は、非共有プロジェクトに一時的なprivate `bootstrap.js` を置き、`var OB_RESULTS_BOOTSTRAP = { readToken: '<専用token>', initialRanges: [...] };` を渡せる。このファイルはgitへ入れない。所有者は関数選択の `initializeObPublisher` を1回実行し、Googleの認可を行う。認可後はPropertiesへの保存、取得/範囲検証、公開1回、5分トリガーの導入まで進む。失敗すればトリガーは作らない。完了後は一時bootstrapをGASから削除しても、Propertiesとトリガーは継続する。

## 保持と失敗時

- 先頭の組名・組間空行・1500m/3000mの番号なし・プログラムを維持。「大会参加」は撤去し、「出場状況」だけで出場/DNS/DNF/DQを表示する。欠席も未記録ならDNS表示。記録欄は常時あり、試技欄は記録入力後に増える。取消/欠席後の保存記録を保持する。
- スプシから戻すのは出場状況のみ。DNSは該当種目の欠場。出場/DNF/DQを選ぶと大会全体の欠席も取り消す（登録種目や試技は削除しない）。登録取消の人・参加情報なし・空行にはプルダウンを付けない。名前・組・記録のスプシ編集や行の並べ替えは対象を取り違えないため同期を停止する。
- アプリで同じ種目/登録の版が変わっていれば変更全件をロールバックし、スプシ入力を保持してセルに未保存の注記を付ける。注記の元の値へ戻すと次回にアプリの最新を取得できる。結果不明は私有Propertiesに同じrequestIdを保持し、DBの原子的な保存履歴で二重反映を防ぐ。
- 公開Sheetのセル/metadataに登録ID・書戻し鍵・行署名を置かない。行対応は私有Propertiesに分割保存し、出力batchの結果不明もmetadataと照合して復旧する。リンク全員の閲覧権限は維持する。
- 取得失敗・不完全な取得・対象違い・初回範囲未確認・タブの消失/改名では上書きしない。既存の名簿を0件へ置換する結果も拒否する。
- 全タブを1回の `spreadsheets.batchUpdate` で更新する。書込みセルは既知の生成範囲だけで、数式ではなく文字列/数値として指定する。独自タブ、右の独自列、下の追記、既存セルの注釈は消さない。生成領域が広がると境界へ行/列を挿入し、独自追記を外へ動かして保持する。アプリ行の並びが変わるため、右の独自列を特定の参加者に結び付ける用途には使わない。
- 同じbatch内に版と生成範囲のdeveloper metadataを保存する。応答が失われても、次回は実際の版を読み、適用済みの列挿入を繰り返さない。単なるScript Propertiesの「成功」では適用を推定しない。
- 日時はスプシのtimezoneに依存せずAsia/Tokyoで表示する。障害時は前回の共有内容が残る。停止はこのプロジェクトの `stopObResultsTrigger()` のみ。既存同期トリガーには触れない。

仕様確認: [Sheets batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)、[updateCells](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#UpdateCellsRequest)、[Apps Script Sheets拡張サービス](https://developers.google.com/apps-script/advanced/sheets)。
