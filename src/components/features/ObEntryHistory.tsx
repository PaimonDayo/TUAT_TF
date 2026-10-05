"use client";

import { useRef, useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getObEntryHistory } from "@/app/(app)/ob-entries/actions";
import type { ObHistoryDetail, ObHistoryItem } from "@/lib/ob-entry-history";

const date = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" });
const time = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ChangeDetails({ details }: { details: ObHistoryDetail[] }) {
  const subjects = new Map<string, ObHistoryDetail[]>();
  for (const detail of details) subjects.set(detail.subject ?? "", [...(subjects.get(detail.subject ?? "") ?? []), detail]);
  return <div className="space-y-4">{[...subjects].map(([subject, changes]) => <div key={subject} className="space-y-2">
    {subject && <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{subject}</p>}
    <ul className="divide-y divide-separator">{changes.map((detail, index) => <li key={index} className="space-y-2 py-3 first:pt-0 last:pb-0">
      <p className="break-words text-sm font-semibold">{detail.label}</p>
      <dl className="grid min-w-0 grid-cols-1 gap-2 text-body sm:grid-cols-2 sm:gap-3">
        {detail.before !== null && <div className="flex min-w-0 gap-2 sm:block sm:space-y-1"><dt className="w-12 shrink-0 text-sm font-medium text-ink/75 sm:w-auto">変更前</dt><dd className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{detail.before}</dd></div>}
        {detail.after !== null && <div className="flex min-w-0 gap-2 sm:block sm:space-y-1"><dt className="w-12 shrink-0 text-sm font-medium text-ink/75 sm:w-auto">変更後</dt><dd className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{detail.after}</dd></div>}
      </dl>
    </li>)}</ul>
  </div>)}</div>;
}

export function ObHistoryList({ items }: { items: ObHistoryItem[] }) {
  const groups = new Map<string, ObHistoryItem[]>();
  for (const item of items) {
    const day = date.format(new Date(item.changedAt));
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return <div className="space-y-5">{[...groups].map(([day, changes]) => <section key={day} className="space-y-2" aria-label={day}>
    <h3 className="text-headline">{day}</h3>
    <ol className="space-y-3">{changes.map(item => <li key={item.id}>
      <Card className="space-y-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <time dateTime={item.changedAt} className="text-sm text-ink/75 tabular-nums">{time.format(new Date(item.changedAt))}</time>
          {item.categories.map(category => <Badge key={category} className="bg-bg text-xs text-ink/75">{category}</Badge>)}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="break-words text-headline [overflow-wrap:anywhere]">{item.subject}</p>
          <p className="break-words text-sm text-ink/75 [overflow-wrap:anywhere]">変更した人：{item.actor}</p>
        </div>
        <ChangeDetails details={item.details} />
      </Card>
    </li>)}</ol>
  </section>)}</div>;
}

export function ObEntryHistory() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ObHistoryItem[]>([]);
  const [cursor, setCursor] = useState<{ at: string; id: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fetching = useRef(false);
  async function load() {
    if (fetching.current) return;
    fetching.current = true; setLoading(true); setError("");
    try {
      const result = await getObEntryHistory(cursor ?? undefined);
      if (!result.ok) { setError(result.message); return; }
      setItems(previous => [...previous, ...result.items.filter(item => !previous.some(value => value.id === item.id))]);
      setCursor(result.nextCursor); setLoaded(true);
    } catch { setError("履歴を取得できませんでした"); }
    finally { fetching.current = false; setLoading(false); }
  }
  return <section className="space-y-3 border-y border-separator py-3" aria-label="OB戦の変更履歴">
    <Button variant="outline" className="w-full justify-between" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !loaded) void load(); }}>
      <span className="flex items-center gap-2"><History size={16} aria-hidden="true" />変更履歴</span>
      <ChevronDown size={16} aria-hidden="true" className={open ? "rotate-180" : undefined} />
    </Button>
    {open && <div className="space-y-4">
      <p className="text-caption">エントリー・本人照合・懇親会、組・順番・競技記録の変更を新しい順に表示します。時刻は日本時間です。閲覧範囲は担当・管理権限によって異なります。</p>
      {loaded && items.length > 0 && <p className="text-micro text-muted">{items.length}件を表示{cursor ? " · 過去の履歴は下から追加できます" : ""}</p>}
      <ObHistoryList items={items} />
      {loaded && !items.length && <p className="text-caption">変更履歴はありません</p>}
      {error && <p role="alert" className="text-caption">{error}</p>}
      {loading ? <p role="status" className="text-caption">履歴を読み込み中…</p> : (error || cursor) && <Button variant="outline" className="w-full" onClick={() => void load()}>{error ? "再試行" : "過去の履歴をさらに表示"}</Button>}
    </div>}
  </section>;
}
