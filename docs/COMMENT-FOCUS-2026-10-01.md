# コメント入力の青い枠（2026-10-01）

コメントのTextareaには通常版のfocus:border-accentと、新UI共通のfocus-visibleによる青いborder/outlineが適用される。テキスト欄はタッチからの入力でもfocus-visibleになるため、入力中に青い縁と外枠が重なる。

CommentSectionに専用の範囲指定を加え、コメント入力・編集はフォーカス時も外枠を増やさず、既存の1pxの縁を灰色へ変更。送信・保存等のキーボードフォーカスは灰色の内枠で維持し、強制配色ではHighlightに従う。新旧UIとも対象。他のフォーム、送受信処理、DB、GAS、PC定期処理は変更なし。

## 検証

- 632テスト（91ファイル）、対象eslint成功。
- Next 16.3.6隔離合成build・tsc --noEmit成功。本番の認証情報・データは使用しない。
- 実React部品の合成画面でChrome/WebKit × 320/390/1440px × 新旧UIの12条件成功。タッチ入力中のoutlineなし・灰色border、入力前後の寸法位置一致、Tabで送信に移動して灰色フォーカス、送信失敗時の本文保持、再送成功時の追加と入力クリア、横はみ出しなしを確認。
- ローカル資料: `.contingency/comment-focus-ui/`、`verify-comment-focus.cjs`、`comment-focus-*.png`。Chrome 390px新UIの画像を目視確認。
- iPhone/Android実機は未確認。

## 反映

検証済みの関連変更のみmasterへ1回pushし、本番の公式デプロイ状態・公開SHAを確認する。
