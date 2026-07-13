"use client";

import { useMemo } from "react";
import { Check, Users } from "lucide-react";
import { PersonPicker } from "@/components/features/PersonPicker";
import { Disclosure } from "@/components/ui/disclosure";
import { BLOCK_ORDER, BLOCKS, GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { AppRole, AuthorMini, Block } from "@/types";

type RoleAssignment = { profile_id: string; role_id: string };

export function RecipientPicker({ people, roles, roleAssignments, all, roleIds, personIds, blocks, grades, onAllChange, onRoleIdsChange, onPersonIdsChange, onBlocksChange, onGradesChange }: {
  people: AuthorMini[]; roles: AppRole[]; roleAssignments: RoleAssignment[]; all: boolean; roleIds: string[]; personIds: string[]; blocks: Block[]; grades: string[];
  onAllChange: (value: boolean) => void; onRoleIdsChange: (ids: string[]) => void; onPersonIdsChange: (ids: string[]) => void; onBlocksChange: (blocks: Block[]) => void; onGradesChange: (grades: string[]) => void;
}) {
  function toggleRole(id: string) { onRoleIdsChange(roleIds.includes(id) ? roleIds.filter((item) => item !== id) : [...roleIds, id]); }
  const conditionSelectedIds = useMemo(() => people.filter((person) => all || (person.blocks ?? []).some((block) => blocks.includes(block)) || grades.includes(person.grade ?? "") || roleAssignments.some((assignment) => assignment.profile_id === person.id && roleIds.includes(assignment.role_id))).map((person) => person.id), [all, blocks, grades, people, roleAssignments, roleIds]);
  const uniqueRecipientCount = new Set([...conditionSelectedIds, ...personIds]).size;
  const availableGrades = useMemo(() => { const present = new Set(people.map((person) => person.grade).filter((grade): grade is string => Boolean(grade))); return GRADE_OPTIONS.filter((grade) => present.has(grade.value)); }, [people]);

  return <div className="rounded-xl border border-separator bg-bg/40 px-3">
    <div className="py-3"><p className="section-label">通知先</p><p className="mt-0.5 text-micro text-muted">複数の条件を組み合わせられます</p></div>
    <button type="button" onClick={() => onAllChange(!all)} className={cn("flex min-h-11 w-full items-center rounded-xl border px-3 text-left text-sm font-semibold", all ? "border-accent bg-accent/10 text-ink" : "border-separator bg-card text-muted2")}><span className="flex-1">全員</span>{all && <Check size={18} className="text-accent" />}</button>
    <Disclosure title={<span>ロール{roleIds.length > 0 && <span className="ml-2 text-xs text-accent">{roleIds.length}件</span>}</span>}>
      <div className="space-y-1">{roles.map((role) => { const active = roleIds.includes(role.id); return <button key={role.id} type="button" onClick={() => toggleRole(role.id)} className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left", active ? "bg-accent/10" : "active:bg-bg")}><span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent"><Users size={15} /></span><span className="flex-1 text-sm font-semibold">{role.name}</span>{active && <Check size={18} className="text-accent" />}</button>; })}</div>
    </Disclosure>
    <Disclosure title={<span>ブロック{blocks.length > 0 && <span className="ml-2 text-xs text-accent">{blocks.length}件</span>}</span>}>
      <div className="space-y-1">{BLOCK_ORDER.map((block) => <FilterRow key={block} label={BLOCKS[block].label} checked={blocks.includes(block)} onClick={() => onBlocksChange(blocks.includes(block) ? blocks.filter((item) => item !== block) : [...blocks, block])} />)}</div>
    </Disclosure>
    {availableGrades.length > 0 && <Disclosure title={<span>学年{grades.length > 0 && <span className="ml-2 text-xs text-accent">{grades.length}件</span>}</span>}>
      <div className="space-y-1">{availableGrades.map((grade) => <FilterRow key={grade.value} label={grade.short} checked={grades.includes(grade.value)} onClick={() => onGradesChange(grades.includes(grade.value) ? grades.filter((item) => item !== grade.value) : [...grades, grade.value])} />)}</div>
    </Disclosure>}
    <Disclosure title={<span>個別指定{personIds.length > 0 && <span className="ml-2 text-xs text-accent">{personIds.length}人</span>}</span>}>
      <PersonPicker people={people} value={personIds} includedIds={conditionSelectedIds} onChange={onPersonIdsChange} label="個別に部員を追加" />
    </Disclosure>
    <p className="border-t border-separator/70 py-3 text-xs font-semibold text-muted">通知対象 {uniqueRecipientCount}人</p>
  </div>;
}

function FilterRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm", checked ? "bg-accent/10 font-semibold text-ink" : "active:bg-bg text-muted2")}><span className="flex-1">{label}</span>{checked && <Check size={18} className="text-accent" />}</button>;
}