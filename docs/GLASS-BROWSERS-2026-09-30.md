# ガラスタブのブラウザ制限解除（2026-09-30）

Chromeなどにも同じガラスUIを適用する依頼に対応。BottomNavのiOS端末判定を撤去し、全ロール・全ブラウザで767px以下の下部タブに適用する。768px以上は既存のPCレイアウトを維持し、ガラス描画資源を解放する。古い端末判定関数と専用テスト6件を削除した。

ガラス素材、背景取得の負荷制限、CSSフォールバック、通常のリンクとpending表示、動きを減らす設定は既存のまま。DB・GAS・PC定期処理の変更はない。

## 検証

- 全524テスト、tsc、対象eslint成功。
- Next 16.3.6の隔離した合成本番設定build成功。最初の試行はmainの旧依存を参照して失敗したため、既存リリースの16.3.6依存へ切り替え、新しい隔離ディレクトリで実施した。
- 実ReactコンポーネントをChrome・Edge・WebKitで検証。320/390pxのタブ移動、長押し3往復、フォームとの重なり、全ロール、動きを減らす設定、再マウント、描画資源解放に成功。
- Windows/Android UAの390pxでもガラス描画、マウスドラッグ、Enter移動に成功。767/768px境界で再開/停止、初期1280pxで描画モジュールを読み込まないことを確認。
- Android UAのChromeでブラウザのタッチ入力による往復、離指時の1回だけの移動、pending/キャンセル、vendor読込失敗時のCSS表示と移動に成功。
- 検証資産はローカル `.contingency/build-glass-browsers-ui.mjs`、`test-glass-browsers.cjs`、`test-glass-browsers-touch.cjs`、`build-glass-browsers-app.mjs`。

iPhone/Android実機の確認は未実施。
