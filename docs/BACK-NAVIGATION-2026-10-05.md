# 戻る操作の改善（2026-10-05）

担当: Codex。共通の戻るボタン、見出し、OB画面の戻る操作を担当。修正先は最新 `origin/master` を基準に親担当が作成した `ob-member-production-20261005`。本番DB・commit・pushは親担当へ集約する。

## 受入条件

- 直接URLを開いた場合、空のタブ・アプリ外の履歴へ戻らず、その画面の既存の戻り先へ進む。
- ホーム等のアプリ画面から開いた場合は、その直前の画面へ戻る。運営/参加者の内部切替に `replace` を使っても、元のホームへの戻りを維持する。Navigation API未対応で前画面の根拠が足りない場合は、既存の画面別fallbackへ戻す。
- 戻る操作が無反応の場合の既存fallbackを維持し、正常に戻った後に別の移動を重ねない。
- 320pxでも戻る・右操作・長い題名が重ならず、操作領域を保つ。最新指示のガラス標準表示は親担当が反映し、こちらでは切替機能を増やさない。
- 記録・組分け・エントリー編集は、開いた元へ戻る。未保存の入力は既存の確認から編集を続けられ、破棄時だけ閉じる。保存中・結果不明の保護と既存権限を維持する。

## 修正前の確認

専用Auth/DBの合成アカウントでloopback18010をChrome320/WebKit320から確認。ブラウザの保存通信は遮断し、記録の入力変更は破棄した。本番は操作していない。

- 新しいタブへOB運営URLを直接開くと、`history.length=2` に初期 `about:blank` が含まれる。既存BackButtonはこれを戻れる履歴と判定し、両ブラウザとも `about:blank` へ離脱した。URL自体が変わるので500msの無反応対策も働かなかった。
- 運営→参加者の `replace` 後も同じ問題を再現。両ブラウザのNavigation APIは、この状態を `canGoBack=false`、現在entry index=0と報告した。
- 記録・組分けの戻るボタンは、280msの入場アニメーション完了後は両ブラウザでx=8px、幅68px（旧ガラスoff）、画面内かつタップ可能だった。開始直後の移動途中のrectは、恒常的な欠けとして扱わない。共通FullScreenの閉じる操作は動作済みなので作り直さない。
- 記録を変更→戻る→編集継続で入力を保持し、再度戻る→保存せずに閉じるで元の運営画面へ戻れた。
- 旧 `?edit=mine` は閉じてもURLにedit指定が残り、再読み込みで編集が開き直ることを両ブラウザで再現。OB入口・自分登録の整理は親担当へ報告した。

既存の共通見出し改善は別worktreeで実コンポーネント検証済み。そこから見出しの幅制約だけを限定転用し、部員画面の `sideWidth=120` を保持する。公開範囲は[現役生向け運営と本番反映](OB-MEMBER-PRODUCTION-2026-10-05.md)で確認する。

Next 16同梱のuseRouter・Link・linking and navigatingガイドを読み、push/replace/backの履歴動作を確認した。履歴を保持する独自の永続ストアやhistoryの上書き層は追加せず、利用可能なNavigation APIの前entry判定と、未対応端末向けの同origin参照元/同文書内移動の根拠で判断する。

## 終了時記録

- `BackButton` は、利用可能なNavigation APIの `canGoBack` を優先し、新規タブの `about:blank` をアプリの前画面と扱わなくした。未対応時は同origin参照元または同文書内の移動の根拠を使い、判定できない場合は画面別fallbackへ進む。既存の明示fallback・500msの無反応対策を維持した。
- `SubHeader` の競合を解消し、検証済みのflex・8pxの間隔・題名の幅制約を限定転用した。部員画面の右操作の `sideWidth=120` は最小幅として保持する。`FullScreen` は既存の戻ると未保存確認が有効だったため変更していない。
- 対象の戻る操作テストは修正前14件中8件が失敗、修正後14件が成功。対象BackButton/テスト/SubHeaderのeslintと空白検査を通過した。
- 新releaseの実BackButton・SubHeader・FormModal・OB編集部品をChrome/WebKitの320/390/1024pxで合成確認した。共通ヘッダーの戻るは44px、題名の両側の間隔は各8px、右操作は120px以上、横はみ出しなし。長い全画面見出しの戻るも44pxで画面内・タップ可能だった。320pxと1024pxの画像を目視確認した。
- 直接URL→fallback、ホーム→プログラム→参加者へのreplace→戻る、未保存入力→編集継続→入力保持→破棄を両ブラウザで確認。Navigation APIを検証側で無効にした条件でも、直接URLのreplace後のfallbackとホームからのSPA往復が成功した。
- 両ブラウザ320pxで記録のclean/dirty、組分けのDNS変更と編集継続/破棄、組分け→当日登録→戻る→組分け、参加者登録/詳細→編集→戻る、補助員担当者→戻る→補助員一覧→戻るを確認した。既存の参加者詳細から編集した後の戻り先は参加者一覧。部品には合成propsを渡し、保存actionを禁止したため、スタッフ権限・実DB保存の確認とは区別する。pageerrorは全条件0だった。

証拠は私有の `.contingency/ob-back-audit-20261005.json`（旧実Next）と `.contingency/back-navigation-20261005/verification.json`・画像・合成assetに保管。文書索引の入口は親担当が追加済み。

Navigation API未対応かつ参照元が失われた状態では、前画面を推測して戻さず画面別fallbackを使う。このため全端末で履歴を完全に復元したとは報告しない。親担当の判断に従い、app-wideの新しい履歴marker/永続ストア/history上書き層は追加していない。

実iOS PWA・Androidの戻る/タッチ/キーボード、旧端末のNavigation API非対応動作は未確認。全型検査・build・新releaseの実Nextでの最終受入確認と本番公開は親担当へ集約。この担当は本番DB変更・commit・push・Production反映を行っていない。
