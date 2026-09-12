/** 起動画面に出すカウントダウンの、端末に覚えておく分 */
export type SplashCountdownCache = {
  name: string;
  startsOn: string;
  /** 取り直した日（JST）。1日1回だけ取り直す */
  fetchedOn: string;
};

export const SPLASH_CACHE_KEY = "tuat-countdown";
export const SPLASH_DISABLED_KEY = "tuat-splash-disabled";

/** 最初のペイントから画面を覆っておく下地。起動画面と同じ地色。 */
export const SPLASH_COVER_ID = "splash-cover";
const SPLASH_COVER_ON = "is-on";
/** Reactが動かないまま覆いが残り続けないための保険。 */
const SPLASH_COVER_FAILSAFE_MS = 4000;

/**
 * `<body>` の先頭で同期実行する下地の判定。
 *
 * 起動画面を出すかどうかは端末に覚えている内容で決まるので、サーバーでは分からない。
 * Reactの判定は「ハイドレート後」なので、それを待つとホームが一瞬見えてしまう。
 * ここは**本文が描かれる前**に走って、出すと決まったときだけ地色で覆う。
 *
 * 判定は shouldShowSplash / competitionDays / jstToday と同じ。片方だけ直さないこと。
 * 読めない・壊れている・出さないと判断したときは何もしない（＝従来どおり本文が出る）。
 */
export const splashCoverScript = `(function(){try{
var el=document.getElementById(${JSON.stringify(SPLASH_COVER_ID)});if(!el)return;
if(localStorage.getItem(${JSON.stringify(SPLASH_DISABLED_KEY)})==="1")return;
var raw=localStorage.getItem(${JSON.stringify(SPLASH_CACHE_KEY)});if(!raw)return;
var c=JSON.parse(raw);
if(!c||typeof c.startsOn!=="string"||!/^\\d{4}-\\d{2}-\\d{2}$/.test(c.startsOn))return;
var t=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
var d=Math.round((Date.parse(c.startsOn+"T00:00:00+09:00")-Date.parse(t+"T00:00:00+09:00"))/86400000);
if(!(d>=0))return;
el.classList.add(${JSON.stringify(SPLASH_COVER_ON)});
setTimeout(function(){el.classList.remove(${JSON.stringify(SPLASH_COVER_ON)});},${SPLASH_COVER_FAILSAFE_MS});
}catch(e){}})();`;

/** 起動画面がDOMに入った（または出さないと決まった）時点で下地を外す。 */
export function clearSplashCover() {
  document.getElementById(SPLASH_COVER_ID)?.classList.remove(SPLASH_COVER_ON);
}

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
