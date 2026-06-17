// 練習場所マスタ（D:\AI\Antigravity\TF のデータを移植）

export interface Venue {
  key: string;
  name: string;
  access: string[];
  fee: string | null;
  url: string;
}

export const VENUES: Venue[] = [
  {
    key: "農部",
    name: "農学部グラウンド",
    access: ["北府中駅から徒歩16分", "府中駅から徒歩25分", "国分寺駅から徒歩30分"],
    fee: null,
    url: "https://maps.app.goo.gl/GYYNeaxw1dZ6gF2x7?g_st=ic",
  },
  {
    key: "工部",
    name: "工学部トレーニングルーム・グラウンド",
    access: ["東小金井駅から徒歩8分"],
    fee: null,
    url: "https://maps.app.goo.gl/bgkgVcUe5Gx7Dde19?g_st=ipc",
  },
  {
    key: "府中",
    name: "府中市民陸上競技場",
    access: ["北府中駅から徒歩7分", "府中駅から徒歩15分"],
    fee: "府中市民50円、府中市外100円",
    url: "https://maps.app.goo.gl/YgmvyKWSzgmiRVWp9?g_st=com.google.maps.preview.copy",
  },
  {
    key: "外大",
    name: "東京外国語大学 陸上競技場",
    access: ["多磨駅から徒歩11分", "飛田給駅から徒歩22分", "武蔵野台駅から徒歩22分"],
    fee: null,
    url: "https://maps.app.goo.gl/v9WX5EeRfrsWqb2u5",
  },
  {
    key: "武蔵野",
    name: "武蔵野陸上競技場",
    access: ["三鷹駅から徒歩25分（バス8分）", "東伏見駅から徒歩20分"],
    fee: "100円",
    url: "https://maps.app.goo.gl/pw5YHpi3B4UaJPiV8?g_st=ic",
  },
  {
    key: "駒場",
    name: "駒場運動公園陸上競技場",
    access: ["浦和駅から徒歩25分"],
    fee: "100円/1時間",
    url: "https://maps.app.goo.gl/MptB9nNKj5DtEHVF6?g_st=ic",
  },
  {
    key: "東大和",
    name: "東大和南公園",
    access: ["玉川上水駅から徒歩10分"],
    fee: "無し",
    url: "https://maps.app.goo.gl/Dz4Y64AHBN4cfdnG8?g_st=ic",
  },
  {
    key: "済美山",
    name: "和田堀公園 第二競技場 (済美山運動場)",
    access: ["方南町駅(丸ノ内線)から徒歩12分", "永福町駅(井の頭線)から徒歩17分"],
    fee: "無し",
    url: "https://maps.app.goo.gl/TYtmyjJD8RWGxiTp8?g_st=com.google.maps.preview.copy",
  },
  {
    key: "織田",
    name: "代々木公園陸上競技場 (織田フィールド)",
    access: [
      "原宿駅(JR)から徒歩10分",
      "代々木公園駅(千代田線)から徒歩7分",
      "代々木八幡駅(小田急線)から徒歩9分",
    ],
    fee: null,
    url: "https://www.google.com/maps/search/?api=1&query=代々木公園陸上競技場",
  },
];

export function findVenue(name: string | null): Venue | undefined {
  if (!name) return undefined;
  return VENUES.find((v) => v.name === name || v.key === name);
}
