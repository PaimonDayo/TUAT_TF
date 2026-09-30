# ガラス背景の位置ずれ修正（2026-09-30）

背景画像化に使うhtml-to-imageが、computed font-sizeを整数へ切り捨て、さらに0.1px縮めていた。ガラス用の画像で文字の幅・右寄せ位置・折返しが元ページと異なる原因になるため、ビルド時のパッチでこの縮小処理を撤去した。

合成画面で16pxが15.9pxになり文字列の幅が約1.8px縮むことを確認。15.5pxの右寄せ文字では14.9pxへ変化し、文字開始位置が10.703125pxずれた。修正後はChrome/WebKitとも元と背景SVGの文字サイズ・開始座標・幅が一致（測定差0px）。ページのCSSが画像側の不足を補わないよう、SVGを独立したiframeへ入れて比較した。

背景取得サイズも整数のoffsetWidth/offsetHeightからgetBoundingClientRectの小数寸法へ変更。幅389.5pxの画面で座標一致を確認。背景の384px制限・1.5倍上限・入力中の取得延期・固定版の屈折シェーダーとガラス素材は維持。vendor URLをv4へ更新した。

## 検証

- 全524テスト、tsc、対象eslint、Next16.3.6の隔離した合成本番設定build成功。
- Chrome/Edge/WebKitの320/390pxで全タブ移動、長押し往復、フォーム前面、全ロール、動きを減らす設定、再マウント、767/768px境界、描画資源解放を確認。
- ChromeのAndroid UAでブラウザタッチ入力、離指時の1回だけの遷移、pending/キャンセル、vendor読込失敗時のCSS表示と移動を確認。
- ローカル検証資産: `.contingency/test-glass-alignment-geometry.cjs`、`test-glass-alignment.cjs`、`test-glass-alignment-touch.cjs`、`build-glass-alignment-app.mjs`。

実際の報告端末・iPhone/Android実機は未確認。DB・GAS・PC定期処理の変更なし。
