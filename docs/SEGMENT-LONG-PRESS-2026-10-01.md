# 共通タブの長押しスライドが戻る不具合（2026-10-01）

管理者の端末別「新UI版」で、全体・短距離などの共通セグメントを長押ししてスライドすると、元の選択へ戻る問題を修正した。

## 再現と原因

共通セグメントはPointerイベントだけを追い、縦へ6pxを超えた時点で、長押し済みかどうかに関わらずスクロールと判断して取り消していた。Chromeのブラウザタッチ入力で、800msの長押し後に横2px・縦8pxぶれてから横へ動かすと、指を離しても元の「全体」のままになることを再現した。

また、Touchは継続したままpointercancelだけを発生させるイベント列でも、旧版は追跡を終了した。下部タブは既にTouch.identifierで追跡しており、この差があった。スライド後の離指許容範囲も共通タブの方が狭かった。

## 修正

- Touch.identifierで同じ指を最後まで追跡し、Touchが生きている間のpointercancelでは取り消さない。実際のtouchcancel、別の指を加えた操作、画面離脱では取り消す。
- 300ms以上押してからの移動はスライドとして扱い、小さな縦ぶれで元へ戻さない。素早く始めた縦スワイプは従来どおりページスクロールへ渡す。
- スライド中に少し外へ指をずらして離しても確定できるよう、下部タブと同じ左右45px・上下70pxの許容範囲にする。遠く離しての取消は維持する。
- 長押しの標準コンテキストメニューとWebKitのcalloutを抑止する。
- 選択は離指時に既存React onClickから1回だけ確定。遅れて届くタッチ由来の互換clickで押し始めのボタンへ戻ることも防ぐ。タップ・キーボード・マウスは維持する。
- preventDefaultが必要なTouchのmove/endリスナーは共通タブ自身に限定。ページ全域へnon-passiveリスナーを追加せず、Touchの元のターゲットを使って範囲外も追う。追加リスナーは既存のdestroy処理で解除する。

下部タブ・vendor・シェーダー・ガラスの見た目・DB/GAS/PC jobsは変更しない。共通SegmentedControlを使う画面に適用し、通常版に新しい操作は追加しない。

## 検証

- 551テスト、変更TypeScriptのeslint、Next 16.3.6隔離合成本番buildとTypeScript検査が成功。
- Chromeのブラウザタッチ入力で、長押し・8pxの縦ぶれ・横移動・50px外への離指を検証。変更後は選択先で1回確定し、ページスクロール位置も維持。
- 通常の縦スワイプはスクロール位置300→375pxとなり、タブの選択は変わらない。
- Chrome/WebKitの320/390/1440pxで、同じ指による往復、指IDの異なる終了、Pointer中断、Touch取消、範囲外取消、2本指、互換click、Portal内の共通タブ、マウス、タップ、Space/Enter、モーション軽減、新旧切替と解除後の再利用を検証。選択面の位置差は最大0.016px。
- 複雑な中断イベント列はDOMイベントを注入して検証し、Chromeでは別途実ブラウザのタッチ入力も使用。Windows WebKitは配置・操作の確認であり、iPhone/Android実機での確認ではない。

ローカル検証資産は `.contingency/segment-touch-ui`、`probe-segment-touch.cjs`、`verify-segment-touch.cjs`、`verify-segment-native.cjs`、`segment-touch-before.json`、`segment-touch-after.json`、`segment-touch-results.json`。本番ユーザーのデータは使用/変更していない。

## 反映

関連差分をまとめてmasterへ1回pushし、Vercel公式チェックと本番 `/api/version` のSHA一致を確認する。反映後の完了記録はローカルに追記する。
