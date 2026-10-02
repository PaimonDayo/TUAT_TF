# ガラス背景の後追い更新調査（2026-10-02）

## 原因

下部タブのみ html-to-image の保存画像を WebGL で重ねている。Source.interacting は操作後240ms休止し、schedule の220ms間隔で再確認するため、通常は約440msと画像化時間を経て屈折表示へ戻る。384pxの保存範囲外ではlive CSSに戻り、停止後に再度WebGLへ切り替わる。内容更新時も画像完成までは旧画像が残る。

既存の追調査記録はChrome 489–498ms、WebKit 521–539msの停止後切替を確認している。今回は現行source/build-vendor/mount-glassと照合した。スクロール中の画像化を増やす変更は、過去に削減したDOMコピー負荷を再導入する。

## 修正

下部タブを既存CSS backdrop-filterの直接透過に統一する変更を、ローカルworktree `.worktrees/glass-live-backdrop-20261002` に実装。mountGlassは選択面の操作処理だけを開始・解放し、画像化/WebGL/vendor読込/route画像無効化を行わない。透明度・ぼかし・縁・影・操作・選択面のばねは維持。不要なvendor用CSSを外す。

**見た目の変更:** 保存画像を屈折させる表現はなくなる。オーナーが追従の自然さを優先する直接透過方式と本番反映を承認済み。

## 検証

- 全642 Vitest、対象eslint成功。
- 実BottomNavを使うReact合成画面、Chrome/WebKit、320/390pxと1440→390px切替の6条件。2/950/1900/0pxの24スクロールで、停止80ms後と800ms追加待機後のガラス部PNGが全て一致。
- ガラス裏を赤から青へ変更すると80ms後のPNGは変化し、さらに800ms後も同一。古い内容の後追い更新なし。
- vendorリクエストとliquid-glass要素は0。1440pxでは下部タブ非表示。mount解除・再mount、リンク/Enter操作成功。pageerrorなし。
- Chrome実ブラウザタッチの長押し10往復、離指1回確定、pending/遷移取消/キーボード成功。合成環境の3秒idleフレームp95 18.1ms、最大18.6ms（実機の性能値ではない）。
- 画像確認: `.contingency/glass-live-chrome-390.png`。試験: `.contingency/build-glass-live-ui.mjs`、`verify-glass-live.cjs`、`test-glass-live-touch.cjs`。結果: `.contingency/glass-live-results.json`。

検証済み、本番反映承認済み。反映結果は完了後に追記する。DB/GAS/PC jobsは変更なし。iPhone/Android実機未確認。

Next16.3.6隔離production build（合成環境変数）と独立の tsc --noEmit も成功。

