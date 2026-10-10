# OB共有スプレッドシートへの出力

アプリからOB共有スプシへ一方向で出力する。大学アカウントの独立GASを使い、共有スプシからアプリへの編集取込みは行わない。既存のGAS合体版・PC Jobs・共有範囲は維持する。

## 更新

- アプリの保存成功後、Nextのafterで署名付きの通知を送り、GASが専用APIから最新結果を取得する。通知本文はaction・timestamp・signatureだけで、参加者データを含めない。
- 署名は専用の読取り派生鍵を使うHMAC-SHA256。署名対象はob-publish:にミリ秒timestampを連結した文字列。2分を超える通知と不正署名は取得・書込み前に拒否する。通知URLは認証情報ではない。
- 定期取得は1時間ごとの1本。通知失敗時もDB保存を取り消さず、次の定期取得で追いつく。結果不明のDB保存は再送せず、確認後に通知する。
- 同じ版では書込み0。並行通知はScriptLockで直列化し、busy応答だけ送信側で最大3回まで試す。セルと版metadataを同じatomic batchで保存し、応答喪失後も列/行挿入を繰り返さない。

## 設置と保持

1. 既存の共有スプシの生成範囲を私有退避・確認する。共有Sheetに紐付けず、所有者限定GASへCode.js/appsscript.jsonを保存する。Sheets v4を有効にする。
2. Script PropertiesのOB_RESULTS_READ_TOKENはsrc/lib/ob-results-feed-auth.tsのobResultsFeedTokenで生成する。元のSHEET_SYNC_SECRETと派生鍵をログ/Git/共有Sheetへ出さない。
3. OB_RESULTS_INITIAL_RANGESに確認済み12タブの生成範囲だけを保存する。範囲なし・取得失敗・対象違い・タブ改名/消失・名簿0件化では前回内容を保持する。
4. dryRunObResultsPublishで変更範囲を確認後、publishObResultsで反映する。installObResultsTriggerは旧5分timerを1時間timerへ置換し、旧編集triggerを撤去する。繰り返してもtimerは1本。
5. 保存通知用Webアプリは大学アカウントとして実行し、全員から通信できる入口に署名認証をかける。この公開範囲は所有者の明示承認が必要。コード/Sheet共有範囲は変更しない。通知URLはsrc/lib/ob-results-notify.tsへ設定する。

独自タブ・右/下の追記・過去の記録は保持する。旧エントリー編集タブは管理印と私有baselineが一致した場合だけ生成結果と同じbatchで撤去する。公開出場状況はDNS/DNF/DQを表示し、取消はDNS扱い。順位は男女・種目別に自動計算し、DNS等は順位対象外。停止はこのGASのstopObResultsTriggerのみを使用する。

仕様: [Webアプリ](https://developers.google.com/apps-script/guides/web)、[Sheets batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)。
