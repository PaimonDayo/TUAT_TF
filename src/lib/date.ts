/**
 * JST基準の「今日」をYYYY-MM-DD文字列で返す共通util。
 * `new Date().toISOString().slice(0,10)` はUTC基準なのでJST 0〜9時に前日日付を返す実バグがある。
 * サーバー実行環境のタイムゾーンに関わらずJSTで統一するため必ずこちらを使う。
 */
export function jstToday(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** JST基準の「現在時刻」をローカルDateとして扱う（date-fns format等にそのまま渡す用） */
export function jstNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}
