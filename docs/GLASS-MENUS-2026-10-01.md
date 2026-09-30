# ガラスメニューと押下動作の再設計

## 依頼・対象

オーナーが提示したChatGPT系アプリの青枠メニュー画像を参考に、新規ガラスUIの質感と押下動作を再設計。下部タブの品質は維持する指示。引き続き実効manageSystemのシステム限定。一般部員・管理者のみ・一般部員プレビューの操作UIは従来表示。

## 調査と判断

- [Apple Meet Liquid Glass / WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/): 押下直後の変形と光の反応、操作元とメニューの連続性、大きなメニューでは拡散を増やし読みやすくする考え方を確認。
- [Apple Menus](https://developer.apple.com/design/human-interface-guidelines/menus) / [Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus): 関連操作の少数提示、共通のアイコン、区切りと破壊的操作の末尾配置を確認。
- [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog): 既存依存のモーダル・フォーカス制御・Esc・onCloseAutoFocusを利用。新依存は追加しない。実装のアクセシブルな意味は「操作を選ぶダイアログ」で、完全なネイティブcontext menuの再実装とは扱わない。
- 添付は暗色の静止画。内部のアルゴリズムや正確なばね係数は推測で断定しない。既存アプリの明色テーマに合わせ、同じような連続した半透明面・薄い縁・静かなアイコン・余白にする。ChatGPT/Appleのネイティブ素材の完全再現や新しい暗色テーマの導入は行っていない。

従来は戻る等のボタンが白82%、作成メニューが白90%で、強い影とアイコン個別の塗りが目立った。押下は共通pressableによるopacity .78中心で、作成メニューの出入りは即時、汎用ActionMenuは画面下から出る別のシートだった。

## 実装

- ボタンは薄い面と軽い影へ変更。押下時は不透明度を維持し、95%の縮小とハイライト、離すと戻る。CSS :activeがタッチ保持中に付かないケースを実ブラウザで再現したため、システム時だけ1組のPointerイベント処理を共有。12pxを超える移動・領域外・cancel・離指・フォーカス喪失・非表示で解除。イベントを横取りせず、スクロールやクリックの成立判断はブラウザへ残す。
- 共通GlassMenuを作り、作成用メニューと編集/共有/ピン/アーカイブ/削除のActionMenuを統一。ボタンから開く200ms、閉じる130msの小さなscale/fade。メニュー自体は一枚の半透明面、行の押下は98.5%縮小＋背景ハイライト。アーカイブの説明と削除確認は保全。
- 実測したトリガー位置から上/下へ配置し、12pxの画面内余白を確保。VisualViewportのオフセット/高さとresizeを反映し、長いメニューは内部スクロール。位置関数を独立して4テストを追加。
- 編集や確認画面は旧メニューの閉鎖・フォーカス解除後に実行。固定の待ち時間で次のダイアログを開かない。共有/コピーだけは直接のユーザー操作中に実行し、ブラウザのactivationを失わない。破壊的操作は既存ConfirmDialogを通す。矢印/Home/End、Tab、Enter、Esc、外側タップとフォーカス復帰を用意。
- 切替タブは選択されたボタンの実幅/位置を測り、260msで一つの選択面を移動。初期HTMLの選択表示を残し、ResizeObserverを解除する。動き低減時は変形/遷移なし、透明度低減/高コントラスト等では不透明fallback。
- サーバーが実効権限で出すマーカーをクライアントの共有状態へ伝達する。追加の認証/DB要求やdocument全体のMutationObserverは不要。購読と押下処理は最後の所有者のunmountで解除。

BottomNav、下部タブのCSS/interaction/mount、vendor、画像化、光学シェーダーは差分0。追加WebGL/ページ画像化なし。DB/GAS/PC jobs/通知/権限の実処理は変更なし。

## 検証と限界

528テスト（88ファイル）・tsc・対象eslint・Next16.3.6の合成環境本番build成功。実コンポーネントのローカルfixtureでは通知データだけmock、フォーム内部はstubで、実データの編集/削除試験ではない。

Chrome/WebKit 320/390/1440pxで、表示位置、行数、矢印/Home/End/Esc、フォーカス復帰、コピー時activation=true、編集へのhandoff、削除確認前には削除しないこと、falseを返す削除後も確認画面を保つこと、選択面の実位置、一般/管理者/プレビュー除外、作成メニュー、動き低減/高コントラスト、外側操作とbodyの操作可能復帰を確認。初回テストで動き低減のCSS優先度不足を発見し修正。

Chromeの実タッチで保持中scale=.95/opacity=1、キャンセルでは操作0回、メニュー行の押下とキャンセル、選択1回で実行1回、高さ300pxへの縮小でもメニューが画面内に収まることを確認。下部タブも先頭/400px/最下部/先頭復帰の背景位置差0px、384px/1.5倍上限の維持をChrome/WebKitで再確認。

**Windows版WebKit 26.5の画像ではCSS背景ぼかしが描画されなかった。** アプリ/React/アニメーションを除いた赤青ストライプ＋backdrop-filter:blur(26px)の最小ページでも、ぼかし有無のPNGが同一。Chrome154ではPNGが変化。したがってWebKitの操作成功をSafariの質感確認済みとは扱わない。[Playwright公式](https://github.com/microsoft/playwright/blob/main/docs/src/browsers.md)もプラットフォームによる機能差とmacOSがSafariに最も近いことを説明している。Chromeの実画像は確認済み。iPhone/Android実機・提示画像の端末の最終的な見え方は未確認。

ローカル検証資材: `.contingency/verify-glass-menu.cjs`、`verify-menu-touch.cjs`、`verify-menu-bottom-regression.cjs`、`probe-static-blur.cjs`。合成画像は同じディレクトリの `glass-menu-{engine}-{width}.png`。ユーザーの添付画像はGitへ含めない。
