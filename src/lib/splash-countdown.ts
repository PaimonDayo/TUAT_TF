/** 起動画面に出すカウントダウンの、端末に覚えておく分 */
export type SplashCountdownCache = {
  name: string;
  startsOn: string;
  /** 取り直した日（JST）。1日1回だけ取り直す */
  fetchedOn: string;
};

export const SPLASH_CACHE_KEY = "tuat-countdown";
export const SPLASH_DISABLED_KEY = "tuat-splash-disabled";

export function readSplashCache(raw: string | null): SplashCountdownCache | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SplashCountdownCache>;
    if (
      typeof value?.name !== "string" ||
      typeof value?.startsOn !== "string" ||
      typeof value?.fetchedOn !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.startsOn)
    )
      return null;
    return { name: value.name, startsOn: value.startsOn, fetchedOn: value.fetchedOn };
  } catch {
    return null;
  }
}

/**
 * 起動画面を出すか。アプリを開くたびに、開催前の大会があるときは出す。
 * 見たくない人は設定でオフにできるので、回数では制限しない。
 * 大会が終わっていたり、まだ何も覚えていなければ出さない（初回は静かに覚えるだけ）。
 */
export function shouldShowSplash(input: {
  cache: SplashCountdownCache | null;
  disabled: boolean;
  days: number | null;
}): boolean {
  if (input.disabled) return false;
  if (!input.cache) return false;
  return input.days !== null && input.days >= 0;
}

/**
 * 回転させる数字の並び。桁ごとに 0〜9 を spins+1 周ぶん並べ、
 * 最後の周の該当数字で止める。止める位置は「上へずらすセル数」で返す。
 */
export function reelCells(digit: number, spins: number): { cells: number[]; offset: number } {
  const cells: number[] = [];
  for (let turn = 0; turn <= spins; turn += 1) {
    for (let value = 0; value < 10; value += 1) cells.push(value);
  }
  const offset = spins * 10 + digit;
  return { cells: cells.slice(0, offset + 1), offset };
}
