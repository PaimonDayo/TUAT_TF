-- 新規にスプシ連携した部員は、連携日より前の履歴を一気に取り込まないよう、
-- 連携日(JST)を記録して同期側で個別のカットオフとして使う。
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sheet_linked_at DATE;

-- 既に連携済みの部員は従来どおり全履歴を対象にしてよいので、追加の制限は入れない
-- （sheet_linked_at は NULL のままにし、同期側で SYNC_CUTOFF にフォールバックする）。

CREATE OR REPLACE FUNCTION public.set_sheet_linked_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.sheet_name, '') <> '' AND COALESCE(OLD.sheet_name, '') = '' THEN
    NEW.sheet_linked_at := (NOW() AT TIME ZONE 'Asia/Tokyo')::DATE;
  ELSIF COALESCE(NEW.sheet_name, '') = '' THEN
    NEW.sheet_linked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sheet_linked_at ON profiles;
CREATE TRIGGER trg_set_sheet_linked_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_sheet_linked_at();
