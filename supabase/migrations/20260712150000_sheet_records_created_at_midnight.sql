-- スプシ由来(from_sheet=true)の練習記録は「練習日の0時(JST)に投稿された」扱いにする
-- (オーナー確定 2026-07-12)。
-- 背景: created_at=取込時刻だと、毎時同期やまとめ取込のたびにタイムラインの先頭へ
-- 数日分が団子で並び、順番が荒れる。練習日0時に揃えれば日付順に自然に混ざる。
-- 以後の新規取込は sheet-sync.ts 側で insert 時に created_at を設定する。
-- 冪等: 既に0時(JST)になっている行は WHERE で除外されるため再実行しても無害。
UPDATE practice_records
SET created_at = (recorded_date::text || ' 00:00:00+09')::timestamptz
WHERE from_sheet = TRUE
  AND created_at IS DISTINCT FROM (recorded_date::text || ' 00:00:00+09')::timestamptz;
