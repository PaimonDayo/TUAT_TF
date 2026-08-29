"use client";

/** 「ここまで読みました」の区切り。前回この画面を開いたときの続きの位置に出る。 */
export function UnreadDivider() {
  return (
    <div className="flex items-center gap-2 py-1" role="separator" aria-label="ここまで読みました">
      <span className="h-px flex-1 bg-accent/40" />
      <span className="shrink-0 text-[11px] font-semibold text-accent">ここまで読みました</span>
      <span className="h-px flex-1 bg-accent/40" />
    </div>
  );
}
