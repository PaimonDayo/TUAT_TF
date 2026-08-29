"use client";

/**
 * 新着の投稿の目印。タイムラインは新しい順なので、
 * 一覧の先頭に件数を出し、新着が終わる位置に「以前の投稿」を出す。
 */
export function UnreadHeading({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 pb-0.5">
      <span className="shrink-0 text-[12px] font-semibold text-accent">新着の投稿</span>
      <span className="shrink-0 text-[11px] text-accent/80">{count}件</span>
      <span className="h-px flex-1 bg-accent/40" />
    </div>
  );
}

/** 新着がここで終わり、これより下は前回までに表示していた投稿だという区切り。 */
export function SeenDivider() {
  return (
    <div className="flex items-center gap-2 py-1" role="separator" aria-label="以前の投稿">
      <span className="h-px flex-1 bg-separator" />
      <span className="shrink-0 text-[11px] text-muted2">以前の投稿</span>
      <span className="h-px flex-1 bg-separator" />
    </div>
  );
}
