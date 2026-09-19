// 引用した投稿の中に小さく出す、練習記録の一行まとめ。

/** 記録の文章欄。DBの行をそのまま渡せるよう、どれも未設定・nullを許す。 */
type SummarySource = {
  menu_text?: string | null;
  result_text?: string | null;
  memo?: string | null;
  focus_text?: string | null;
  strength_text?: string | null;
  /** JSONB列。DBの行をそのまま渡せるよう型は絞らず、中身を見るときに確かめる。 */
  custom?: unknown;
};

/**
 * 練習記録を1行で表す。
 *
 * 記録は項目が部員ごとに違うので、書いてある文章を上から順に1つだけ採る
 * （メニュー→結果→感想→目的→補強→追加項目）。どれも空なら距離だけで伝える。
 * タイムラインの一覧行（CompactFeedRow）と同じ順序にしてある。
 */
export function recordSummaryText(record: SummarySource): string {
  const candidates: unknown[] = [
    record.menu_text,
    record.result_text,
    record.memo,
    record.focus_text,
    record.strength_text,
    ...customValues(record.custom),
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const text = String(candidate).trim();
    if (text !== "" && text !== "0") return text;
  }
  return "";
}

function customValues(custom: unknown): unknown[] {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return [];
  return Object.values(custom as Record<string, unknown>);
}
