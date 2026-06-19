-- ═══════════════════════════════════════════════════════════════
-- 練習場所（会場）をDB管理化。管理者/担当者が追加でき、
-- pinned=true の会場が予定作成の場所リストに出る。既存9会場を投入。
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS venues (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,        -- 正式名
  short      TEXT,                 -- 略称（カードのタイトル表示用）
  access     TEXT,                 -- アクセス（改行区切り）
  fee        TEXT,                 -- 参加費
  url        TEXT,                 -- 地図URL
  pinned     BOOLEAN NOT NULL DEFAULT TRUE,  -- 選択リストに出すか
  sort       INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "venues_select" ON venues;
DROP POLICY IF EXISTS "venues_insert" ON venues;
DROP POLICY IF EXISTS "venues_update" ON venues;
DROP POLICY IF EXISTS "venues_delete" ON venues;
CREATE POLICY "venues_select" ON venues FOR SELECT USING (TRUE);
CREATE POLICY "venues_insert" ON venues FOR INSERT WITH CHECK (public.can_create_schedule());
CREATE POLICY "venues_update" ON venues FOR UPDATE USING (public.can_create_schedule());
CREATE POLICY "venues_delete" ON venues FOR DELETE USING (public.can_create_schedule());

-- 既存9会場の投入（重複投入を避けるため、空のときだけ）
INSERT INTO venues (name, short, access, fee, url, pinned, sort)
SELECT * FROM (VALUES
  ('農学部グラウンド', '農部', '北府中駅から徒歩16分' || chr(10) || '府中駅から徒歩25分' || chr(10) || '国分寺駅から徒歩30分', NULL, 'https://maps.app.goo.gl/GYYNeaxw1dZ6gF2x7?g_st=ic', TRUE, 1),
  ('工学部トレーニングルーム・グラウンド', '工部', '東小金井駅から徒歩8分', NULL, 'https://maps.app.goo.gl/bgkgVcUe5Gx7Dde19?g_st=ipc', TRUE, 2),
  ('府中市民陸上競技場', '府中', '北府中駅から徒歩7分' || chr(10) || '府中駅から徒歩15分', '府中市民50円、府中市外100円', 'https://maps.app.goo.gl/YgmvyKWSzgmiRVWp9?g_st=com.google.maps.preview.copy', TRUE, 3),
  ('東京外国語大学 陸上競技場', '外大', '多磨駅から徒歩11分' || chr(10) || '飛田給駅から徒歩22分' || chr(10) || '武蔵野台駅から徒歩22分', NULL, 'https://maps.app.goo.gl/v9WX5EeRfrsWqb2u5', TRUE, 4),
  ('武蔵野陸上競技場', '武蔵野', '三鷹駅から徒歩25分（バス8分）' || chr(10) || '東伏見駅から徒歩20分', '100円', 'https://maps.app.goo.gl/pw5YHpi3B4UaJPiV8?g_st=ic', TRUE, 5),
  ('駒場運動公園陸上競技場', '駒場', '浦和駅から徒歩25分', '100円/1時間', 'https://maps.app.goo.gl/MptB9nNKj5DtEHVF6?g_st=ic', TRUE, 6),
  ('東大和南公園', '東大和', '玉川上水駅から徒歩10分', '無し', 'https://maps.app.goo.gl/Dz4Y64AHBN4cfdnG8?g_st=ic', TRUE, 7),
  ('和田堀公園 第二競技場 (済美山運動場)', '済美山', '方南町駅(丸ノ内線)から徒歩12分' || chr(10) || '永福町駅(井の頭線)から徒歩17分', '無し', 'https://maps.app.goo.gl/TYtmyjJD8RWGxiTp8?g_st=com.google.maps.preview.copy', TRUE, 8),
  ('代々木公園陸上競技場 (織田フィールド)', '織田', '原宿駅(JR)から徒歩10分' || chr(10) || '代々木公園駅(千代田線)から徒歩7分' || chr(10) || '代々木八幡駅(小田急線)から徒歩9分', NULL, 'https://www.google.com/maps/search/?api=1&query=代々木公園陸上競技場', TRUE, 9)
) AS v(name, short, access, fee, url, pinned, sort)
WHERE NOT EXISTS (SELECT 1 FROM venues);
