# 操作部中心のガラスUI・メンバー一覧の下部タブ背景

## オーナー指示と適用範囲

2026-10-01、オーナーから上部のホーム/マイページ等のタイトル全体をガラスにする案を取りやめ、Appleでの採用状況を調査してタブ・ボタン中心に整え、システムロールへ反映する指示。透明感の報告対象は上部ではなく、メンバー一覧の下部のホーム/予定等のタブであると訂正。

未公開の `codex/glass-header-top` / `e045705` は取り込まない。今回のデザインと背景修正は既存 `getCurrentProfile` の実効 `manageSystem` に由来するマーカーで限定する。一般部員/管理者のみ/一般部員プレビューは従来表示。以前全員に公開した下部タブの適用範囲自体は変更しない。DB・GAS・PC jobs・認証・追加データ通信の変更なし。

## Apple公式資料と設計判断

調査日2026-10-01。AppleのネイティブAPIそのものではなく、その方針を参考にしたWebの表現であり、外観の完全一致やAppleによる認定は主張しない。

- [Meet Liquid Glass / WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/): ガラスは主に内容の上のナビゲーション層へ使い、内容自体やガラス同士の重ね掛けは避ける。今回、タイトルの大型カプセルを撤去し、内容のカードは従来表示にする判断に利用。
- [Get to know the new design system / WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/): コントロールを機能ごとにまとめ、余計なバー背景に頼らず階層を示す。戻る・通知・作成ボタン/作成メニューへ限定する判断に利用。Appleは上部の操作部にも採用しているため、「上部には一切使わない」という解釈ではない。
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): タブバー、ボタン、セグメントコントロールの採用例を確認。共通SegmentedControlの選択部だけを控えめな半透明・丸み・縁で表し、トラック全体との二重ガラス化を避けた。
- [Buttons / HIG](https://developer.apple.com/design/human-interface-guidelines/buttons): 押下状態と十分な操作領域を確保。今回のモバイル用戻る・通知ボタンは44 CSS px以上、切替タブの高さは44 CSS px以上とし、フォーカス表示を明示。WebのCSS pxとネイティブptの完全同一性は主張しない。

上部ヘッダーは従来の平面とぼかしへ戻し、丸いガラス板・縁・影・左右マージンを撤去。見出しの高さは従来どおり。作成ボタン/メニューのガラスは維持。追加の画像化/WebGLはなくCSSだけで操作部を装飾。高コントラスト/透明度低減/forced-colors/非対応ブラウザは不透明fallbackを維持し、動き低減時は切替の色遷移なし。

## 下部タブの根本原因と修正

軽量な背景画像化のため、範囲外の親要素の子孫を省略していた。メンバー一覧のようにinlineのリンク内へblockのカードを入れた構造では、リンク自体のCSS高さはautoである。カードまで除外するとリンク行が縮み、下の行が上へ詰まった画像になる。停止後のWebGLはその誤った画像の単色部分を表示し、スクロール中の生きたCSS背景との差が不透明化に見えていた。

システムのキャプチャではinline/contentsや寸法がpxで確定しない親の子を保持し、コピー後も幅・高さを保てる箱の内側だけを省略する。30人の実MemberDirectoryの合成画面で、修正前の縦位置差-348pxを修正後0pxに改善。透明度をスクロール位置で変える応急処置ではない。

384pxの画像高さ上限・最大1.5倍の画像化・固定シェーダー・操作中の画像化延期・リソース解放を維持。再生成したvendorはv5。生成元と固定上流SHAは `ops/glass/build-vendor.mjs` / `public/vendor/liquid-glass/SOURCE.md` に記載。

## 検証

- 全524テスト（87ファイル）、tsc、変更TSX/TSのeslint、Next16.3.6合成環境の本番build成功。
- Chrome/WebKitで320/390/1440 CSS px。実MemberDirectory/BackButton/NotificationBell/SegmentedControl/FAB/BottomNavを使用し、通信だけをローカルmockに置換。フォーム内はstubのため実保存試験ではない。
- モバイルのscrollY=0/400/最下部/0で、SVGの独立文書内と元の表示を比較。下部タブ直下のリンク行のx/y/高さの差は全て0px。画像は320px幅で276,480画素、390px幅で336,960画素、高さ384pxを維持。
- 検索、絞込の空表示、一般/管理者/システム名だが権限falseのプレビュー切替、戻る・通知、作成メニュー、キーボード、高コントラスト、動き低減、横はみ出しなしを確認。
- 実WebGL context lossでも下部タブの遷移成功。vendor読込失敗でもCSS表示と遷移成功。Chromeの実ブラウザタッチ入力で3往復保持・離指1回だけの遷移成功。
- ローカルの検証スクリプト `.contingency/verify-glass-controls.cjs` / `.contingency/verify-controls-touch.cjs` と最終画像を保持。iPhone/Androidの実機・報告端末そのものは未確認。
