# システム限定のiOSガラスタブ

2026-09-30、オーナーが試作04-R4の本番アプリへの反映を承認。

- `getCurrentProfile()` の `manageSystem` が有効、かつiPhone/iPadのモバイル幅だけに適用する。一般部員プレビューでは権限が落ちるため従来表示。Android・PC・デスクトップ幅も従来表示。
- 04の光学エンジンとR4の長押し操作を使用。Touch.identifierで指を追跡し、往復・別のpointercancel・別指のtouchcancel・幅変更で保持を解除しない。指を離したときだけ既存のNext Linkをクリックする。
- Next Linkの先読み、読み込み中表示、現在タブの先頭へのスクロール、大会プログラムからのdocument navigationを維持。画面遷移待ちの楕円はLinkのpending状態に追従する。
- 表示対象だけ光学コードを遅延ロード。背景は既存`.app-main`を端末内で描画し、タブはbodyへのPortalで自己参照を避ける。外側のWebGLは1個、選択レンズは小さなSVG。ベンダー障害時はCSSのガラスと通常Linkへフォールバック。
- アンマウント、対象ロール解除、デスクトップ幅への変更でイベント・RAF・observer・WebGLを解放。非表示時やコントラスト/透明度設定に応じてWebGLを停止。動きを減らす設定ではレンズの変形を停止。
- 画面下余白を調整し、共通の作成ボタンとメニューを26px上げて従来と同じ間隔を確保。全画面フォーム・未保存確認はタブより前面のまま。
- MITの固定版を同梱。元ソース、版、既存のResizeObserver対策、依存ライセンスは `public/vendor/liquid-glass/`。AppleのネイティブUIそのものではなく、既存試作のWeb実装。

## 検証

- 全523テスト、TypeScript、対象eslint、本番のPC中継構成を模した合成環境のNext 16.3.6ビルド。
- 実際のBottomNav・Next Link・FormModal・FloatingActionPositionを使う合成React画面をChromiumとWebKitで320/390px確認。Nextサーバー/実認証・DBは合成画面には含めない。
- 全タブ、同じタブの反復通過、capture喪失/無関係cancel/幅変更、所有指の終了、キーボード、遷移pending/ブロック、動きを減らす設定、コントラスト設定、ロール切替/再マウント、横はみ出し、作成ボタン間隔、未保存確認、ベンダー読み込み失敗を確認。
- Chromiumのブラウザ入力経路でも予定→ホーム→マイページ→予定の往復を3回実施し、保持中の画面遷移なし・最後の離指で1回だけ選択を確認。一般部員・管理者・一般部員プレビュー、Android/Windowsで光学コードの要求なし。
- ローカル検証スクリプトは `.contingency/build-glass-ui.mjs`、`test-glass-ui.cjs`、`test-glass-extra.cjs`、`build-glass-app.mjs`。iOS実機・実アカウントでの表示確認は未実施。

DB、GAS、PC定期処理、認証設定の変更なし。作業ブランチをpushせず、検証したコードだけをmasterへまとめて1回pushする。
