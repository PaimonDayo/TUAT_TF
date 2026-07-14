"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, List, Plus, Search, Trash2 } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { PeopleFilterButton } from "@/components/features/PeopleFilterButton";
import { Button } from "@/components/ui/button";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { AuthorMini, Block } from "@/types";

type MemberList = { key: string; name: string; ids: string[] };

const MEMBER_LISTS_KEY = "track-app:target-presets-v1";

function readMemberLists(): MemberList[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(MEMBER_LISTS_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value as MemberList[] : [];
  } catch {
    return [];
  }
}

export function PersonPicker({ people, value, onChange, label = "対象者", excludeIds = [], includedIds = [] }: {
  people: AuthorMini[]; value: string[]; onChange: (ids: string[]) => void; label?: string; excludeIds?: string[]; includedIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [query, setQuery] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [memberLists, setMemberLists] = useState<MemberList[]>([]);
  const [memberListsOpen, setMemberListsOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const included = useMemo(() => new Set(includedIds), [includedIds]);
  const availableGrades = useMemo(() => {
    const present = new Set(people.map((person) => person.grade).filter((grade): grade is string => Boolean(grade)));
    return GRADE_OPTIONS.map((grade) => grade.value).filter((grade) => present.has(grade));
  }, [people]);
  const filtered = useMemo(() => people.filter((person) => {
    if (excluded.has(person.id)) return false;
    const q = query.trim().toLowerCase();
    return (!q || person.display_name.toLowerCase().includes(q))
      && (blocks.length === 0 || (person.blocks ?? []).some((block) => blocks.includes(block)))
      && (grades.length === 0 || grades.includes(person.grade ?? ""));
  }), [blocks, excluded, grades, people, query]);

  function launch() {
    setDraft(value);
    setMemberLists(readMemberLists());
    setMemberListsOpen(false);
    setCreatingList(false);
    setListName("");
    setOpen(true);
  }
  function toggle(id: string) {
    setDraft((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }
  function saveMemberLists(next: MemberList[]) {
    setMemberLists(next);
    localStorage.setItem(MEMBER_LISTS_KEY, JSON.stringify(next));
  }
  function createMemberList() {
    const name = listName.trim();
    if (!name || draft.length === 0) return;
    saveMemberLists([...memberLists, { key: crypto.randomUUID(), name, ids: draft }]);
    setListName("");
    setCreatingList(false);
  }
  function applyMemberList(list: MemberList) {
    const selectable = new Set(people.filter((person) => !excluded.has(person.id)).map((person) => person.id));
    setDraft(list.ids.filter((id) => selectable.has(id)));
    setMemberListsOpen(false);
  }

  return <>
    <button type="button" onClick={launch} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-separator bg-card px-3 text-left">
      <span><span className="block text-sm font-semibold">{label}</span><span className="text-micro text-muted">{value.length ? `個別に${value.length}人を選択中` : includedIds.length ? `${includedIds.length}人が条件で対象` : "選択なし"}</span></span><ChevronRight size={17} className="text-muted" />
    </button>
    <FormModal open={open} onOpenChange={setOpen} title={`${label}を選択`} autoFocus={false}>
      <div className="space-y-3 pb-4">
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前で検索" className="pl-9" /></div>
        <div className="flex min-h-10 items-center gap-2">
          <PeopleFilterButton blocks={blocks} grades={grades} onBlocksChange={setBlocks} onGradesChange={setGrades} availableGrades={availableGrades} />
          <button type="button" onClick={() => { setMemberListsOpen((current) => !current); setCreatingList(false); }} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold", memberListsOpen ? "border-accent bg-accent/10 text-accent" : "border-separator bg-card text-ink")} aria-expanded={memberListsOpen}>
            <List size={16} />メンバーリスト
          </button>
          <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-muted">{draft.length}人</span>
        </div>
        {memberListsOpen && <div className="space-y-2 rounded-xl border border-separator bg-bg p-3">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">保存したメンバーリスト</p>{draft.length > 0 && !creatingList && <button type="button" onClick={() => setCreatingList(true)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent"><Plus size={14} />現在の選択を保存</button>}</div>
          {memberLists.length === 0 && !creatingList && <p className="py-2 text-xs text-muted">保存済みのリストはありません</p>}
          {memberLists.map((list) => <div key={list.key} className="flex min-h-11 items-center gap-2 rounded-lg bg-card px-3">
            <button type="button" onClick={() => applyMemberList(list)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{list.name}</span><span className="text-micro text-muted">{list.ids.filter((id) => !excluded.has(id) && people.some((person) => person.id === id)).length}人</span></button>
            <button type="button" onClick={() => saveMemberLists(memberLists.filter((item) => item.key !== list.key))} aria-label={`${list.name}を削除`} className="rounded-lg p-2 text-muted active:bg-bg"><Trash2 size={16} /></button>
          </div>)}
          {creatingList && <div className="space-y-2 rounded-lg bg-card p-2">
            <Input autoFocus value={listName} onChange={(event) => setListName(event.target.value)} placeholder="例：駅伝メンバー" />
            <div className="flex justify-end gap-2"><button type="button" onClick={() => { setCreatingList(false); setListName(""); }} className="px-3 py-2 text-xs font-semibold text-muted">キャンセル</button><Button type="button" size="sm" disabled={!listName.trim()} onClick={createMemberList}>保存</Button></div>
          </div>}
        </div>}
        <div className="space-y-1">{filtered.map((person) => {
          const explicit = draft.includes(person.id);
          const byCondition = included.has(person.id);
          const active = explicit || byCondition;
          return <button key={person.id} type="button" onClick={() => { if (!byCondition || explicit) toggle(person.id); }} className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left", active ? "bg-accent/10" : "active:bg-bg")}><Avatar name={person.display_name} avatarUrl={person.avatar_url} blocks={person.blocks} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{person.display_name}</span><span className="text-micro text-muted">{explicit ? "個別指定" : byCondition ? "条件で対象" : person.grade ?? "学年未設定"}</span></span>{active && <Check size={18} className="text-accent" />}</button>;
        })}</div>
      </div>
      <FormModalFooter><Button size="lg" onClick={() => { onChange(draft); setOpen(false); }}>完了（個別 {draft.length}人）</Button></FormModalFooter>
    </FormModal>
  </>;
}