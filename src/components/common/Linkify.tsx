import { Fragment } from "react";

const URL_RE = /(https?:\/\/[^\s]+)/g;

// 末尾に付きがちな句読点・閉じ括弧はリンクから除外する
function splitTrailing(url: string): [string, string] {
  const m = url.match(/[)\]｝」』。、，．,.!?！？]+$/);
  if (!m) return [url, ""];
  const trail = m[0];
  return [url.slice(0, url.length - trail.length), trail];
}

/** 自由文中の URL を自動でリンク化して表示する（改行は呼び出し側の whitespace で保持） */
export function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          const [url, trail] = splitTrailing(part);
          return (
            <Fragment key={i}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline break-all"
              >
                {url}
              </a>
              {trail}
            </Fragment>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
