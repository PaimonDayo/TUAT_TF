# 大会・記録会の結果の入力統一（設計と既存データの修正方針）

オーナー確定（2026-09-09）。実装は 20260909010000 の migration と、大会・種目マスタ、
結果フォームの作り直しまで完了。**既存データの正規化はまだ実行していない。** ここに手順を残す。

## 確定した仕様

| 項目 | 決定 |
|---|---|
| PB | 生涯自己ベスト。**種目ごとに1件だけ**（DBトリガーで、新しく付けた行が勝つ） |
| UB | 大学ベスト。PB と連動させない（自動で付けない・自動で外さない） |
| 大学以前 | `stage='pre_university'`。日付は不要で、一覧では年をまたいで「大学以前」にまとめる |
| 種目 | `competition_events` マスタから選択＋「その他」自由入力（一般部員も可） |
| 大会 | `competitions` マスタから選択（選ぶと初日が記録日に入る）＋記録会などは自由入力 |
| 記録 | 種目の `measure_type` で入力欄が変わる（時間 1/100 秒・距離 cm・得点）。風速あり、順位なし、DNS/DNF/DQ/NM あり |
| 権限 | マスタの管理と、他の部員の結果の編集はシステム管理者のみ |

## いま DB がどうなっているか

- 追加した列だけを使い、`event_name` / `record` / `meet_name` / `recorded_on` は**そのまま残している**。
- 新しい保存では `value_cs` / `value_cm` / `value_points`（または `result_status`）が入り、
  `record` にはそこから組み立てた表示文字列が入る。
- 旧データは値の列が NULL のままなので、表示は従来どおり `record` の文字列を出す。
  つまり**放置しても壊れない**。並べ替えや自動判定に使えないだけ。

## 既存データの修正方針（未実行）

1. **スナップショット**: service role で `pb_records` を全件 JSON/CSV でローカルへ退避する
   （本番 DB は PITR 無し。厳守ルールどおり、これを取るまで何も書かない）。
2. **dry-run**: `npx tsx --env-file=.env.local scripts/dryrun-pb-normalize.ts`
   - 種目名を `competition_events` と突き合わせ、「一致」「NFKC などの正規化で一致」「不一致」に分ける。
   - `record` の文字列を `parseRecordText()` に通し、読めた件数と読めなかった行を出す。
   - **何も書き込まない。** 出力を見て、正規化辞書に足す表記を決める。
3. **適用（分割して）**
   - a. 種目名: dry-run で「正規化で一致」した行だけを更新。判断の要る表記は
     /events の「未登録の種目 → 既存の種目にまとめる」から管理者が1件ずつ寄せる。
   - b. 記録値: パースできた行だけ `value_*` を埋める migration を書く（`record` は上書きしない）。
   - c. 残りは /members/[id] からシステム管理者が手で直す（そのために編集権限を付けた）。
4. **PB / UB の整理**: 旧データには同じ種目に複数の `is_pb` が立っている行がありうる。
   トリガーは新しい保存にしか効かないので、一覧を見て本人か管理者が1件に絞る。
5. **大学以前**: 既存行はすべて `stage='university'` で入っている。高校時代の記録は
   本人か管理者が編集して「大学以前」に変える（自動判定はしない）。

いずれの段階でも、`record` の元テキストは消さない。読み違えが後から分かっても戻せるようにするため。

## まだやっていないこと

- 上記の正規化（1〜5）。本番 DB への書き込みは一切していない。
- 実機（iOS PWA）での確認。
- 目標と結果の突き合わせ（同じ `competition_id` を持つので、後から「目標 4'00" / 結果 4'02"」の
  振り返りを作れる）。

## 引き継ぎ（Supabase 側の作業。2026-09-09 Claude Opus 5 → Codex）

コードは `claude/competition-record-input-standardization-0bca68` に3コミット（`a805f96` / `c925b3c` / `59d318e` / `e238490`）。
tsc・全214テスト・対象eslint・build（ダミーSupabase設定）は通っている。**本番DBには何も適用していない。**
このセッションには接続情報が無く `supabase login` も未認証だったため、以下は未実施。

1. **migration の適用**（先にこれ。適用前に master へ入れると、大会・種目・目標の一覧が空表示になり結果の保存がエラーになる）
   - `supabase/migrations/20260909010000_competition_results_v2.sql`
   - `"Y" | npx --yes supabase db push`
   - 内容は列追加とポリシー・トリガー追加のみで、既存行の書き換えは
     `competitions.is_countdown`（27大戦を1件 true）と `competition_events.measure_type`（跳躍投擲=distance・混成=points）だけ。
   - 追加されるもの: `competitions`(ends_on/sort_order/is_countdown＋INSERT・DELETEポリシー),
     `competition_events.measure_type`, `pb_records`(competition_id/stage/date_precision/result_status/wind/value_cs/value_cm/value_points),
     PB・UBを種目ごと1件にするトリガー, 種目名変更を結果へ伝播するトリガー, pb_records の update/delete を
     `auth.uid()=user_id OR can_manage_system()` へ緩和。
2. **master へ fast-forward して push** → Vercel Production が READY になるまで確認。
3. **既存データの正規化**（上の「既存データの修正方針」の1〜5）。まだ何も実行していない。
   `npx tsx --env-file=.env.local scripts/dryrun-pb-normalize.ts` が書き込みなしの確認用。
4. iOS 実機確認（結果フォームの種目・記録の入力欄の切替、大会選択で記録日が入ること、
   /events・/competitions のドラッグ並べ替え、目標ページのPB併記）。
