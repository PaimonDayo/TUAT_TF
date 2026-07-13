"use client";

import { Check, Users } from "lucide-react";
import { PeopleFilterButton } from "@/components/features/PeopleFilterButton";
import { PersonPicker } from "@/components/features/PersonPicker";
import { cn } from "@/lib/utils";
import type { AppRole, AuthorMini, Block } from "@/types";

export function RecipientPicker({ people, roles, all, roleIds, personIds, blocks, grades, onAllChange, onRoleIdsChange, onPersonIdsChange, onBlocksChange, onGradesChange }: {
  people: AuthorMini[]; roles: AppRole[]; all: boolean; roleIds: string[]; personIds: string[]; blocks: Block[]; grades: string[];
  onAllChange: (value: boolean) => void; onRoleIdsChange: (ids: string[]) => void; onPersonIdsChange: (ids: string[]) => void; onBlocksChange: (blocks: Block[]) => void; onGradesChange: (grades: string[]) => void;
}) {
  function toggleRole(id: string) { onRoleIdsChange(roleIds.includes(id) ? roleIds.filter((item) => item !== id) : [...roleIds, id]); }
  const conditionCount = (all ? 1 : 0) + roleIds.length + personIds.length + blocks.length + grades.length;
  return <div className="space-y-4 rounded-xl border border-separator bg-bg/40 p-3">
    <div><p className="section-label">通知先</p><p className="mt-0.5 text-micro text-muted">全員・ロール・ブロック・学年・個人を組み合わせられます</p></div>
    <button type="button" onClick={() => onAllChange(!all)} className={cn("flex min-h-11 w-full items-center rounded-xl border px-3 text-left text-sm font-semibold", all ? "border-accent bg-accent/10 text-ink" : "border-separator bg-card text-muted2")}><span className="flex-1">全員</span>{all && <Check size={18} className="text-accent" />}</button>
    <section><p className="section-label mb-1.5">ロール</p><div className="space-y-1">{roles.map((role) => { const active = roleIds.includes(role.id); return <button key={role.id} type="button" onClick={() => toggleRole(role.id)} className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left", active ? "bg-accent/10" : "active:bg-bg")}><span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent"><Users size={15} /></span><span className="flex-1 text-sm font-semibold">{role.name}</span>{active && <Check size={18} className="text-accent" />}</button>; })}</div></section>
    <section className="flex items-center justify-between gap-3"><div><p className="section-label">所属条件</p><p className="mt-0.5 text-micro text-muted">ブロック・学年を複数指定</p></div><PeopleFilterButton blocks={blocks} grades={grades} onBlocksChange={onBlocksChange} onGradesChange={onGradesChange} /></section>
    <section><p className="section-label mb-1.5">個別指定</p><PersonPicker people={people} value={personIds} onChange={onPersonIdsChange} label="個別に部員を選択" /></section>
    <p className="text-xs font-semibold text-muted">選択条件 {conditionCount}件</p>
  </div>;
}