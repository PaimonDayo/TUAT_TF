# 巨大ファイルの分割計画（2026-09-13）

## 「オブジェクト指向にする」をこの構成でどう解釈するか

先に率直なところを書く。**このアプリでファイル全体をclassで書き直すのは、ほぼ全部が改悪になる。**

- React Server Component / Client Component は関数であることが前提で、classにすると
  Suspense・Server Actions・`use client` の境界が使えなくなる。React自身が2019年に
  class componentから離れている。
- `queries.ts` の取得関数は状態を持たない。`class QueryService { async getFeed() {...} }`
  にしても、`new` する手間が増えるだけで、隠せる状態は1つも無い。

一方で、オブジェクト指向が本来解こうとしている問題——**関係するデータと手続きを1か所に集め、
外から見える面を小さくし、依存の向きを一方通行にする**——は、この設計に完全に当てはまる。
JavaScriptではその単位が**モジュール**になる。モジュールは「状態を閉じ込め、公開する面を選び、
実装を差し替えられる」という意味で、classと同じ役割を果たす。

なので方針はこう置く:

1. **分割の単位はドメイン**（記録・予定・ノート…）。行数で機械的に割らない。
2. **依存は一方通行**にする。下位（純粋な計算）→ 上位（通信・DB）→ 進行役、の順。循環させない。
3. **入口は変えない**。`@/lib/queries` のまま使えるように再エクスポートを置き、
   呼び出し側100箇所以上を書き換えない。
4. **本物のclassは、状態と手続きが本当に一緒に動くところだけ**に使う（下の Phase 2 参照）。

## 現状（2026-09-13 時点の行数）

| ファイル | 行 | 状態 |
|---|---|---|
| `src/types/database.ts` | 2302 | 生成物。手で触らない・分割しない |
| ~~`src/lib/sheet-sync.ts`~~ | ~~1312~~ | **Phase 1 完了**（9モジュール＋入口） |
| ~~`src/lib/queries.ts`~~ | ~~1183~~ | **Phase 1 完了**（9モジュール＋入口） |
| `src/components/features/ScheduleSheetsManager.tsx` | 1129 | Phase 3 |
| `src/components/cards/ScheduleCard.tsx` | 761 | Phase 3 |
| `src/types/index.ts` | 657 | Phase 4 |
| `src/components/post/ResultForm.tsx` | 613 | Phase 3 |
| `src/components/features/ProfileEditForm.tsx` | 586 | Phase 3 |
| `src/components/post/RecordForm.tsx` | 585 | Phase 3 |
| `src/components/post/MenuForm.tsx` | 556 | Phase 3 |
| `src/components/layout/FAB.tsx` | 506 | Phase 3 |

## Phase 1（実施済み）

### `src/lib/queries.ts` → `src/lib/queries/`

画面から使う取得処理。ドメインごとに分け、`index.ts` が今までと同じ入口を保つ。

```
queries/
  index.ts        入口（再エクスポートのみ）
  internal.ts     select文とソーシャル情報の付与。ここだけ非公開
  feed.ts         タイムライン（記録＋つぶやき）
  records.ts      練習記録・自己ベスト
  schedules.ts    予定・出欠
  notices.ts      お知らせ・個人通知
  members.ts      部員・ロール・お気に入り
  rankings.ts     走行距離ランキング
  venues.ts       練習場所
  notes.ts        ノート・記事・スレッド
  competitions.ts 大会・種目・目標・結果
```

### `src/lib/sheet-sync.ts` → `src/lib/sheet-sync/`

依存が下から上への一方通行になっている（循環なしを確認済み）:

```
types / dates / field-map / gas-client   ← 葉。外から何も呼ばない
        ↓
pull / push / reconcile / replies        ← 葉だけを使う
        ↓
run                                      ← 進行役。毎時同期の本体
```

- `field-map.ts` は通信もDBも触らない純粋な変換なので、単体で試せる。
- `gas-client.ts` がGASへのHTTPを全部引き受ける。シートとの通信はここだけ。
- `run.ts` は「順に呼ぶ」だけの役に近づけた。

**やらなかったこと**: 移動は行単位で、ロジックは1行も書き換えていない。
260テスト・`tsc`・対象ESLintで移動前と同じ結果になることを確認している。

## Phase 2: 本当にclassが効く場所（未実施・要判断）

`run.ts`（381行）の `runSheetSync` は、まだ1つの長い手続きで、
`SyncResult`（inserted/updated/pushed/conflicts/skipped/failed…）を延々と積み上げていく。
ここは**状態と手続きが本当に一緒に動いている**ので、classが素直に効く数少ない場所:

```ts
class SheetSyncRun {
  #result: SyncResult;
  constructor(private admin: SupabaseClient, private options: SyncOptions) {}
  recordFailure(member: string, reason: string) { ... }  // 部分失敗の作法を1か所に
  async pullMember(member) { ... }
  async pushMember(member) { ... }
  finish(): SyncResult { ... }
}
```

利点は「1人の失敗で全体を止めない」「失敗を必ず記録する」という取り決めを、
呼び出しごとに書くのではなく型で守れること。
ただし**毎時の本番同期そのもの**なので、着手するなら本番書き込みの前に
スナップショット取得とdryRunを必ず通す（AGENTS.mdの厳守ルール）。

## Phase 3: 画面（Client Component）

行数が多いのは、ほぼ「1つのファイルに複数の画面が同居している」ため。
classにするのではなく、**同居している別物を隣のファイルへ出す**。

- **`ScheduleSheetsManager.tsx`（1129行）** — 一番効く。
  ①シート登録 ②取込プレビューの編集表 ③曜日の既定値 ④取込の実行と結果、が1ファイルに同居。
  `schedule-sheets/` を作り、`SheetRegistration` / `PreviewTable` / `WeekdayDefaults` /
  `ImportRunner` に分ける。表の状態は1つのフックに寄せる。
- **`ScheduleCard.tsx`（761行）** — 末尾に `MenuCard` / `SheetMenuCard` / `SheetMenuSection` が
  同居している。これらは予定カードの内部事情ではないので `schedule/` へ出す。
  並べ替え用の `menuCompare` / `menuTargetNames` は純関数なので `lib/` へ出してテストを付ける。
- **`ResultForm` / `RecordForm` / `MenuForm` / `ProfileEditForm`** — 共通して
  「入力欄の定義」「下書きの保存と復元」「送信」が混ざっている。
  `DecimalField` / `NumberField` のような入力部品を `components/ui/` へ上げると、
  種目ごとの書き方（分と秒／秒／メートル／得点）の分岐も1か所になる。
- **`FAB.tsx`（506行）** — `ContextualFAB` が画面ごとの分岐を全部持っている。
  画面→項目の対応表をデータとして切り出せば、本体は表を引くだけになる。

順番は **ScheduleSheetsManager → ScheduleCard → 各Form → FAB** を薦める。
上2つで約1900行が動き、以降は同じ型の繰り返しになる。

## Phase 4: 型と、消し残し

- **`src/types/index.ts`（657行）** — 全ドメインの型が1ファイルに入っている。
  `types/` にして `feed.ts` / `schedule.ts` / `note.ts` … に割り、`index.ts` で再エクスポートする。
  `@/types` の書き味は変わらない。`database.ts`（生成物）はそのまま。
- **PC試験版の残骸（未実施・要判断）** — 本人限定の試験は終了しているのに、
  `NEXT_PUBLIC_PC_TRIAL` / `PC_TRIAL_VERCEL` の分岐が
  `next.config.ts` / `src/proxy.ts` / `src/lib/supabase/{client,server,middleware}.ts` /
  `src/lib/supabase/pc-server-options.ts` / `src/lib/pc-vercel-proxy.ts` に残っている。
  本番では常にfalseなので**動きには影響しないが**、認証のcookie名とproxyに触る変更になる。
  **本番稼働中・サーバー移設前の今は触らない**。落ち着いた時期に、
  ①`pc-vercel-proxy.ts` と `pc-server-options.ts` の削除 ②各分岐の削除
  ③`next.config.ts` の `distDir` と tsconfig の `.next-pc-trial` 参照の削除、をまとめて行う。

## 進めるときの約束

- 1フェーズ＝1コミット。移動とロジック変更を同じコミットに混ぜない。
- 分割のたびに `npx tsc --noEmit` / `npx vitest run` / 対象ESLint を通す。
  移動だけなら**テストの結果は分割前と一致するはず**で、一致しないなら移動を間違えている。
- 入口（`@/lib/queries` のような再エクスポート）を消さない。呼び出し側を大量に書き換えない。
- 本番データに触る変更（Phase 2）は、スナップショットとdryRunを先に。
