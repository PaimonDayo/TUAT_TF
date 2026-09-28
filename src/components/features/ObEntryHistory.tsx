"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getObEntryHistory } from "@/app/(app)/ob-entries/actions";
import type { ObHistoryItem } from "@/lib/ob-entry-history";

export function ObEntryHistory() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ObHistoryItem[]>([]);
  const [cursor, setCursor] = useState<{ at: string; id: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const result = await getObEntryHistory(cursor ?? undefined);
      if (!result.ok) { setError(result.message); return; }
      setItems(previous => [...previous, ...result.items.filter(item => !previous.some(p => p.id === item.id))]);
      setCursor(result.nextCursor); setLoaded(true);
    } catch { setError("履歴を取得できませんでした"); }
    finally { setLoading(false); }
  }
  return <section className="space-y-3 px-4 pb-8">
    <Button variant="outline" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !loaded) void load(); }}>変更履歴</Button>
    {open && <div className="space-y-3">
      <p className="text-caption">管理者限定。エントリー・資格記録・本人照合・懇親会の変更を新しい順に表示します。</p>
      {items.map(item => <Card key={item.id} className="space-y-2 p-3">
        <p className="break-words text-headline">{item.subject}</p>
        <p className="break-words text-caption">{item.actor} · {new Date(item.changedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
        <ul className="space-y-1 text-body">{item.details.map((detail, i) => <li key={i} className="whitespace-pre-wrap break-words">{detail}</li>)}</ul>
      </Card>)}
      {loaded && !items.length && <p className="text-caption">変更履歴はありません</p>}
      {error && <p role="alert" className="text-caption">{error}</p>}
      {loading ? <p role="status" className="text-caption">履歴を読み込み中…</p> : (error || cursor) && <Button variant="outline" onClick={() => void load()}>{error ? "再試行" : "さらに表示"}</Button>}
    </div>}
  </section>;
}
