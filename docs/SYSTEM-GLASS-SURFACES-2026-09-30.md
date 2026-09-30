# システム限定：タブ以外のガラスUI試作

ChatGPTのような控えめな透明感と丸みを、推奨箇所へシステム限定で試したいという依頼に対応。

- 上部ヘッダー（Header/SubHeader/ScrollAwareSubHeader）：半透明の白、24pxの丸み、細い縁、薄い影。
- 右下の作成ボタン：白いガラス面と濃いアイコン、押下とキーボードフォーカスの表示。
- 作成メニュー（ホーム/タイムライン、ノート、フォルダ内）：少し濃い白のガラス面と24pxの丸み。

既存のAuthenticatedFabで取得するgetCurrentProfileの実効rolesを使い、manageSystemがある場合だけ非表示マーカーを出す。CSSはそのマーカーを直下に持つapp-main内の指定箇所だけへ適用する。管理者のみ・一般部員・一般部員プレビューでは有効にならない。追加DB問い合わせ、権限テーブル、認証の変更はない。

追加箇所はCSS backdrop-filterのみで、画像化・WebGL・ポーリングを追加しない。ヘッダーの高さは権限判定前後で維持。透明度低減・コントラスト強調・forced colorsでは不透明にし、backdrop-filter非対応時も不透明表示へ戻す。入力フォームと本文、既に全員へ公開した下部タブはそのまま。

## 検証

- 全524テスト、TypeScript、対象eslint、Next16.3.6の隔離合成本番設定build成功。
- Chrome/WebKitで320・390・1440pxの実コンポーネントを確認。システム/一般部員/管理者/プレビュー切替、開いたメニューのスタイル解除、ヘッダー高不変、横はみ出しなし。
- 作成メニューの開閉と練習記録ダイアログへの移動、ノートのフォルダ作成メニュー、Enter操作、コントラスト強調、スクロールヘッダーを確認。フォーム本文は合成検証用スタブ、DB通信は行わない。
- 検証スクリプト・画像は `.contingency/build-system-glass-ui.mjs`、`test-system-glass-ui.cjs`、`system-glass-*.png`。

iPhone/Android実機の確認は未実施。DB・GAS・PC定期処理に変更なし。
