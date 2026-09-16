// サーバー移行に伴う計画メンテナンス。DBに一切依存しない時刻比較だけで判定する
// （この期間はバックエンド自体が切替中で不安定なため、DBを読みに行かない経路が必要）。

const MAINTENANCE_START = Date.parse("2026-09-16T06:00:00Z"); // 2026-09-16 15:00 JST
const MAINTENANCE_END = Date.parse("2026-09-17T10:00:00Z"); // 2026-09-17 19:00 JST

export const MAINTENANCE_WINDOW_LABEL = "9月16日(水) 15:00 〜 9月17日(木) 19:00";

export function isMaintenanceWindow(now: Date = new Date()): boolean {
  const t = now.getTime();
  return t >= MAINTENANCE_START && t < MAINTENANCE_END;
}
