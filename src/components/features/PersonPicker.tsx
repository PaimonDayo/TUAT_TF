"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, RotateCcw, Search } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/ui/button";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { BLOCK_ORDER, BLOCKS, GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { AuthorMini, Block } from "@/types";

export function PersonPicker({ people, value, onChange, label = "対象者", excludeIds = [] }: {
  people: AuthorMini[];
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  excludeIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const filtered = useMemo(() => people.filter((person) => {
    if (excluded.has(person.id)) return false;
    const q = query.trim().toLowerCase();
    return (!q || person.display_name.toLowerCase().includes(q)) &&
      (blocks.length === 0 || (person.blocks ?? []).some((block) => blocks.includes(block))) &&
      (grades.length === 0 || grades.includes(person.grade ?? ""));
  }), [blocks, excluded, grades, people, query]);

  function launch() { setDraft(value); setOpen(true); }
  function toggle(id: string) { setDraft((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); }

  return <>
    <button type="button" onClick={launch} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-separator bg-card px-3 text-left">
      <span><span className="block text-sm font-semibold">{label}</span><span className="text-micro text-muted">{value.length ? `${value.length}人を選択中` : "選択なし"}</span></span>
      <ChevronRight size={17} className="text-muted" />
    </button>
    <FormModal open={open} onOpenChange={setOpen} title={`${label}を選択`} autoFocus={false}>
      <div className="space-y-3 pb-4">
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前で検索" className="pl-9" /></div>
        <div className="flex h-10 items-center"><Button type="button" variant="outline" onClick={() => setFiltersOpen((current) => !current)}>絞り込み{blocks.length + grades.length ? ` ${blocks.length + grades.length}` : ""}</Button><span className="ml-auto text-sm font-semibold tabular-nums text-muted">選択中 {draft.length}人</span></div>
        {filtersOpen && <div className="space-y-3 rounded-xl border border-separator bg-card p-3">
          <div><p className="section-label mb-2">ブロック（複数選択可）</p><div className="grid grid-cols-2 gap-2">{BLOCK_ORDER.map((block) => { const active = blocks.includes(block); return <button key={block} type="button" onClick={() => setBlocks((items) => active ? items.filter((item) => item !== block) : [...items, block])} className={cn("h-9 rounded-lg border text-xs font-semibold", active ? "border-accent bg-accent text-white" : "border-separator text-muted")}>{BLOCKS[block].label}</button>; })}</div></div>
          <div><p className="section-label mb-2">学年（複数選択可）</p><div className="grid grid-cols-3 gap-2">{GRADE_OPTIONS.map((grade) => { const active = grades.includes(grade.value); return <button key={grade.value} type="button" onClick={() => setGrades((items) => active ? items.filter((item) => item !== grade.value) : [...items, grade.value])} className={cn("h-9 rounded-lg border text-xs font-semibold", active ? "border-accent bg-accent text-white" : "border-separator text-muted")}>{grade.short}</button>; })}</div></div>
          <button type="button" onClick={() => { setBlocks([]); setGrades([]); }} className="inline-flex items-center gap-1 text-xs font-semibold text-muted"><RotateCcw size={13} />絞り込みを解除</button>
        </div>}
        <div className="space-y-1">{filtered.map((person) => { const active = draft.includes(person.id); return <button key={person.id} type="button" onClick={() => toggle(person.id)} className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left", active ? "bg-accent/10" : "active:bg-bg")}><Avatar name={person.display_name} avatarUrl={person.avatar_url} blocks={person.blocks} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{person.display_name}</span><span className="text-micro text-muted">{person.grade ?? "学年未設定"}</span></span>{active && <Check size={18} className="text-accent" />}</button>; })}</div>
      </div>
      <FormModalFooter><Button size="lg" onClick={() => { onChange(draft); setOpen(false); }}>完了（{draft.length}人）</Button></FormModalFooter>
    </FormModal>
  </>;
}
