# ito ゲーム機能 実装計画

合宿などで40〜50人が同時に遊ぶ ito 形式のゲームを TUAT_TF アプリ内に追加する。
本書はオーナー確定事項（2026-08-10）を含む実装の基準。細部で迷ったら AGENTS.md と既存実装を優先する。

## 0. 前提（オーナー確定 2026-08-10）

| 論点 | 確定 |
| --- | --- |
| 進行役の権限 | `manage_system` 保持者。ito 専用の権限列は追加しない。進行役はゲームに参加しない |
| グループ最小人数 | 各通常グループは最低2人（代表者1＋通常回答者1以上）。満たせない構成はラウンドを開始できない |
| グループ数 | 最低2グループ。実質の最低参加人数は4人。小規模利用を過度に最適化しない |
| 未回答者 | 受付終了でそのラウンドの対象から外すが、`declined`（明示辞退）と `pending`（未回答のまま締切）はデータ上区別する。未回答を自動で辞退に書き換えない |
| 再招待 | 辞退者・未回答者も、次ラウンド準備で改めて招待できる |
| 代表者チーム | 代表者は自分の数字を知っている前提。採点は通常グループと同じ（正位置1人=1点、完全一致=N×2点）。数字を口頭で教え合わないのはゲームルールで担保し、アプリでは防がない |
| 過去の秘密数字 | 結果発表後はそのラウンドの参加者が閲覧可（数字・代表者名・自由回答・各グループの予想・正解・得点）。発表前の秘匿だけを厳密に守る |

### 0.1 追加確定事項（2026-08-10 追加分）

| 論点 | 確定 |
| --- | --- |
| モード | `ito_games.mode`（`team` / `solo`）。`team` は既存どおり各グループ最低2人（代表者1＋回答者1以上）。`solo` はソロプレイ・代表のみのグループ（回答者がいないグループ）を認め、各グループ最低1人まで許容する。ゲーム作成時に最初に選ぶ |
| お題 | `ito_games.theme`（任意、60文字まで）。システム管理者がいつでも設定・変更できる（draft 限定にはしない。ラウンドごとに変えたい運用を想定） |
| 進行役の参加 | `ito_games.admin_participates`。オンにすると、そのゲームを作成したシステム管理者本人だけが招待対象に含まれる（ロール・管理権限による除外の例外）。他の進行役は引き続き対象外 |
| 秘密数字の閲覧（進行役） | システム管理者は、**自分がそのラウンドの参加者でない限り**、誰に何の番号が割り当てられたかをいつでも見られる（結果発表前でも可）。自分がそのラウンドの参加者である場合は、これまでどおり自分の分しか見えない（自分の得点に関わるための自己防止）。RLS の追加ポリシーで担保し、UI 側の制御には頼らない |

## 1. 全体方針

- **専用ゲームサーバーは追加しない。** Supabase(Postgres + Realtime) と Next.js の既存構成だけで完結させる。
- **サーバーが正。** クライアントの状態は表示用。フェーズ遷移・共有編集・採点はすべてサーバー側で検証する。
- **アクセス制御は RLS が最終防衛線。** UIガードは併用するが、UIだけに頼らない（AGENTS.md 厳守ルール）。
- **得点は履歴から再計算できる形で持つ。** 累計値を破壊的に更新しない。
- **既存ナビゲーションを変えない。** BottomNav・FAB は触らない。導線はホームのカードとマイページ管理メニュー。

## 2. 状態モデル（ゲーム状態とラウンド状態を分離）

13フェーズを1つの列に押し込まず、ゲーム全体とラウンド内で分ける。

### 2.1 ゲーム状態 `ito_games.status`

```
draft ──▶ entry ──▶ active ──▶ finished
```

| status | 意味 | 対応する仕様フェーズ |
| --- | --- | --- |
| `draft` | 作成直後。名前・対象ロール・グループ数・最大人数を編集できる | 1. ゲーム作成 |
| `entry` | 初回エントリー受付中 | 2. エントリー受付 |
| `active` | ラウンドを回している。ラウンド間の準備期間もここ | 12. 次ラウンド準備 |
| `finished` | 終了。閲覧のみ | 13. ゲーム終了 |

### 2.2 ラウンド状態 `ito_rounds.phase`

```
grouping ─▶ leader_select ─▶ numbers ─▶ leader_answers ─▶ ordering ─▶ locked ─▶ revealed ─▶ result ─▶ finished
                                                              ▲          │
                                                              └──────────┘  (回答受付の再開のみ後戻り可)
```

| phase | 意味 | 仕様フェーズ |
| --- | --- | --- |
| `grouping` | グループ編成・手動移動 | 3 |
| `leader_select` | 代表者選択（グループ共有・受付中は変更自由） | 4 |
| `numbers` | 秘密数字を配布し、各代表者が自分の数字を確認 | 5 |
| `leader_answers` | 代表者の自由回答を管理者が手入力 | 6 |
| `ordering` | 並び替え・回答受付 | 7 |
| `locked` | 回答受付終了。参加者は編集不可 | 8 |
| `revealed` | 予想公開（秘密数字はまだ出さない） | 9 |
| `result` | 結果発表（秘密数字と正解を公開） | 10 |
| `finished` | ラウンド結果確定・得点反映済み | 11 |

- 遷移は RPC `ito_advance_phase(round_id, to_phase)` だけが行い、許可表にない遷移は例外にする。
- 許可される後戻りは `locked → ordering`（回答受付の再開）のみ。`revealed` 以降は戻せない。
- 同じ許可表を `src/lib/ito-phase.ts` にも持ち、テストで SQL 側と同じ内容であることを担保する。

## 3. データモデル

```
ito_games          id, name, target_role_id, group_count, max_group_size, status,
                   created_by, created_at, updated_at
ito_invitations    id, game_id, profile_id, round_no, status(pending/joined/declined),
                   invited_by, invited_at, responded_at   -- UNIQUE(game_id, profile_id, round_no)
ito_participants   game_id, profile_id, status(active/excluded), joined_round, left_round
                   -- PK(game_id, profile_id)。現在のプールだけを持つ可変テーブル
ito_rounds         id, game_id, round_no, phase, created_at, started_at, ended_at
                   -- UNIQUE(game_id, round_no)
ito_groups         id, round_id, name, is_leader_team, sort_order
ito_group_members  id, round_id, group_id, profile_id, is_leader
                   -- UNIQUE(round_id, profile_id)
ito_secrets        round_id, profile_id, number(1..100), assigned_at, confirmed_at
                   -- PK(round_id, profile_id), UNIQUE(round_id, number)
ito_leader_answers round_id, profile_id, answer, updated_by, updated_at
ito_group_orders   group_id PK, round_id, order_ids uuid[], revision, submitted,
                   updated_by, updated_at
ito_round_scores   group_id PK, round_id, correct_count, points, is_perfect, computed_at
ito_point_events   id, game_id, round_id, profile_id, points, source(group/leader_team)
                   -- UNIQUE(round_id, profile_id)
```

設計上の要点:

- **招待履歴は不可逆に積む。** `ito_invitations` は「game × profile × 招待ラウンド」で1行。Round 3 で招待→辞退、Round 5 で再招待、が両方残る。現在の参加プールは `ito_participants` が持ち、招待への応答 RPC が更新する。過去の招待行は書き換えない。
- **代表者チームの所属行は作らない。** 代表者は自分の通常グループに `is_leader = true` で1行だけ持つ。代表者チームは `ito_groups.is_leader_team = true` の1行として存在し、メンバーは「そのラウンドで `is_leader` の人」から導出する。これで `UNIQUE(round_id, profile_id)` を保てる。
- **ラウンドごとに構成をスナップショットする。** `ito_group_members` はラウンド単位で丸ごと保存するので、後から参加者を除外しても過去ラウンドは不変。
- **得点は `ito_point_events` の履歴が正。** 累計は SUM で算出し、`total` 列は持たない。管理者の入力ミスがあれば該当ラウンドを修正して再採点し、そのラウンドの行だけ差し替える。
- **共有編集テーブルには `round_id` を非正規化で持たせる。** Realtime の filter が JOIN を辿れないため（§5）。

## 4. 秘密数字の秘匿

UI で隠すだけにしない。多層で守る。

1. `ito_secrets` の SELECT ポリシーは「自分の行」または「そのラウンドが `result` 以降かつ自分がそのラウンドの参加者」または「進行役として見るシステム管理者（自分がそのラウンドの参加者でない場合のみ）」の3条件（§0.1）。**自分がそのラウンドの参加者であるシステム管理者には、結果発表前は数字を返さない。**
2. `ito_secrets` は **Realtime publication に入れない。** postgres_changes 経由の漏洩面を作らない。
3. 管理者コンソールに出すのは「配布済み」「本人確認済み」の真偽値だけ。数字を含まない集計 RPC を使う。
4. サーバーコンポーネントでも、本人向け表示以外は props に数字を載せない（RSC ペイロードは端末に届く前提で扱う）。
5. 配布 RPC `ito_assign_secrets(round_id)` は 1〜100 から重複なしで N 個を抽選。`UNIQUE(round_id, number)` で重複を DB でも防ぐ。

## 5. Realtime 購読設計

- 購読は **ラウンド単位で1チャンネル**。`postgres_changes` の filter は単一カラムの等値比較しか使えず JOIN 先を参照できないため、共有編集系テーブルにはすべて `round_id` を直接持たせる（`ito_group_orders` を含む）。
- publication に入れるテーブル: `ito_games` / `ito_invitations` / `ito_rounds` / `ito_groups` / `ito_group_members` / `ito_group_orders` / `ito_leader_answers` / `ito_round_scores` / `ito_point_events`。**`ito_secrets` は入れない。**
- 招待の検知（アプリ利用中でも気づく）は `ito_invitations` を `profile_id=eq.<self>` で購読し、加えて既存 `notifications` にも1行作る。
- クライアントは変更通知を「再取得のトリガー」としてのみ使い、ペイロードを信用しない。再接続時は必ず全件フェッチし直す。
- ドラッグ中は送信せず、**ドロップ確定時だけ**サーバーへ送る。帯域と競合の両方が減る。

## 6. 共有編集と競合制御

- 更新は RPC `ito_set_order(group_id, order_ids, expected_revision, submit)` のみ。`revision` が一致しなければ拒否し、最新行を返す。クライアントは最新へ同期し直してトーストで知らせる。
- **並び順が変わったら `submitted` は自動的に false に戻る**（仕様11）。
- `updated_by` / `updated_at` を保持し、「最終更新: ○○」を表示する。
- 提出は「サーバーに保存済み」を明示（仕様23）。楽観的に描画してよいが、サーバー応答が返るまで確定表示にしない。
- 編集できるのは phase が `ordering` のときだけ。通常グループはその班の**代表者を除くメンバー**、代表者チームはそのラウンドの代表者全員。RLS とサーバー関数の両方で判定する。

## 7. 採点

`src/lib/ito-score.ts` の純関数で計算し、管理者操作のサーバー側処理が結果を書き込む（SQL 側に採点ロジックを二重実装しない）。

- 正しい位置にいる代表者の人数 = 得点。
- 完全一致のときだけ N×2 点（5人なら10点、10人なら20点）。
- 通常グループの点はその班の**代表者を除くメンバー**へ、代表者にはその班の点を入れない。
- 代表者チームの点は、そのラウンドの代表者全員へ。1ラウンドで1人が受け取るのはどちらか一方。
- 再採点は同じ経路をもう一度通し、そのラウンドの `ito_round_scores` / `ito_point_events` を差し替える（他ラウンドには触れない）。

## 8. グループ編成

`src/lib/ito-grouping.ts` の純関数（乱数は seed 注入でテスト可能に）。

- 最大人数を超えない。人数はできるだけ均等。
- **各グループはモードごとの最少人数以上**を必ず満たす（`team`=2人以上、`solo`=1人以上。§0.1）。満たせない構成は編成を実行せず、管理者へ理由つきで警告する。
- 再編成時は、過去ラウンドの同席ペアにペナルティを与え、貪欲配置＋局所改善で同席の再発を減らす（best effort）。
- 編成後は管理者が手動で移動できる。移動でも「最大人数」「最低2人」を満たさない場合は警告する。
- ラウンド開始後（`leader_select` 以降）はそのラウンドの編成を固定する。

## 9. 画面

- `/ito`（参加者）… 現在のラウンドとフェーズで出し分ける単一画面。招待への回答 → 代表者選択 → 自分の数字 → 並び替え → 予想公開 → 結果 → ランキング。
- `/ito/admin`（`manage_system` のみ）… ゲーム作成、エントリー集計（対象/参加/不参加/未回答）、グループ編成と手動移動、代表者受付終了、数字配布、代表者回答の手入力、提出状況（`10 / 11 回答済み`）、受付終了・予想公開・結果発表、ラウンド結果、次ラウンド準備、ゲーム終了。
- 導線… ホームに「参加中の ito」カード（未回答の招待があれば参加/不参加）。マイページ管理メニューに `/ito/admin`。**BottomNav・FAB は変更しない。**
- 不可逆操作（エントリー受付終了・代表者受付終了・秘密数字配布・回答受付終了・予想公開・結果発表・ゲーム終了）は既存 `ui/confirm-dialog.tsx` で確認する。結果発表は特に強い確認文言にする。
- 人物一覧の並びは**学年 → 名前**に統一。共通処理を `src/lib/member-sort.ts` に切り出して ito と既存箇所で共用する（既存の見た目は変えない範囲で）。
- 並び替え UI は既存 `ui/reorder-list.tsx`（dnd-kit）を流用しつつ、**「上へ／下へ」ボタンを併設**する（iOS PWA でドラッグとスクロールが競合しやすいため）。

## 10. 実装順（1タスク＝1コミット）

1. 本計画書
2. migration（テーブル・RLS・publication・RPC）＋型定義＋純関数（フェーズ表・採点・編成）＋ユニットテスト
3. ゲーム作成／エントリー（招待通知・集計）
4. グループ編成（自動＋手動移動）
5. 代表者選択（共有状態・Realtime）
6. 秘密数字配布と本人表示（秘匿の検証）
7. 代表者回答入力（管理）＋並び替え共有編集（revision 競合制御）
8. 受付終了・予想公開・結果発表（確認ダイアログ）
9. 採点・ラウンド結果・累計ランキング
10. 次ラウンド準備（追加招待・除外・再編成）
11. 再採点（管理者の入力ミス修正用）

## 11. 懸念点

1. **postgres_changes の RLS 評価コスト。** 購読者ごとにポリシーが評価される。ドロップ時のみ送信＋ラウンド1チャンネルで足りる見込みだが、実測で厳しければ DB トリガからの Broadcast へ切り替える（テーブル設計は変えずに済む）。
2. **合宿先の回線。** 切断表示・再接続時の全件再取得・「サーバーに保存済み」の明示は必須。
3. **iOS PWA のドラッグ。** dnd-kit がタッチを奪う疑いが過去に記録されている。上下ボタン併設で回避する。
4. **`cacheComponents` / `experimental.staleTimes` は再導入禁止**（AGENTS.md の解決済みインシデント）。ito 画面でも使わない。
5. **本番DBは PITR・バックアップなし。** 新規テーブル中心だが、`notifications` の CHECK 制約拡張だけは既存に触る。migration は冪等にし、本番適用前に確認する。
6. **Vercel 関数は hnd1 固定を維持**（`vercel.json` を触らない）。
7. **E2E 基盤がない。** 複数端末同期は手動確認になる。管理者1・参加者2の3セッションで、代表者選択・並び替え・提出・公開を通しで確認する。
