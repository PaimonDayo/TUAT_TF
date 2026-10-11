"use client";

import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeEntryName } from "@/lib/entry-identity";

export function ObRecordReplacement({ name, placement, candidates, onSelect, onClose }: {
  name: string; placement: string; candidates: { id: string; name: string; grade: string; placement: string }[];
  onSelect: (id: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const query = normalizeEntryName(search).toLowerCase();
  const filtered = candidates.filter(person => normalizeEntryName(person.name + person.grade).toLowerCase().includes(query));
  return <Sheet open onOpenChange={open => !open && onClose()}><SheetContent autoFocus={false} title="DNSの枠に入れる">
    <div className="space-y-4">
      <p className="text-body">{name} · {placement}</p>
      <p className="text-caption">元の人のDNSと記録は残します。代わりに出場する人を選んでください。</p>
      <Input aria-label="代わりに出場する人の氏名検索" placeholder="氏名を入力" value={search} onChange={e => setSearch(e.target.value)}/>
      <div aria-label="代わりに出場する人の候補" className="divide-y divide-separator overflow-hidden rounded-xl border border-separator">
        {filtered.map(person => <button key={person.id} type="button" aria-pressed={selected === person.id} onClick={() => setSelected(person.id)} className={`flex min-h-14 w-full items-center gap-3 p-3 text-left ${selected === person.id ? "bg-accent/10" : "bg-card"}`}>
          <span className="min-w-0 flex-1"><span className="block break-words text-body font-medium">{person.name}</span><span className="text-caption">{person.grade} · {person.placement}</span></span><span className="text-caption">{selected === person.id ? "選択中" : "選ぶ"}</span>
        </button>)}
        {!filtered.length && <p className="p-4 text-body">候補はいません。種目に未登録の人は、記録画面の「出場者を追加」から登録してください。</p>}
      </div>
    </div>
    <Button className="mt-4 w-full" disabled={!candidates.some(person => person.id === selected)} onClick={() => onSelect(selected)}>この枠に入れる</Button>
  </SheetContent></Sheet>;
}
