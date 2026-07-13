"use client";

import { useState } from "react";
import { Check, Users } from "lucide-react";
import { PersonPicker } from "@/components/features/PersonPicker";
import { cn } from "@/lib/utils";
import type { AppRole, AuthorMini } from "@/types";

export function RecipientPicker({ people, roles, all, roleIds, personIds, onAllChange, onRoleIdsChange, onPersonIdsChange }: {
  people: AuthorMini[]; roles: AppRole[]; all: boolean; roleIds: string[]; personIds: string[];
  onAllChange: (value: boolean) => void; onRoleIdsChange: (ids: string[]) => void; onPersonIdsChange: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<"roles" | "people">("people");
  function toggleRole(id: string) { onAllChange(false); onRoleIdsChange(roleIds.includes(id) ? roleIds.filter((item) => item !== id) : [...roleIds, id]); }
  return <div className="space-y-3 rounded-xl border border-separator bg-bg/40 p-3">
    <div><p className="section-label">通知先</p><p className="mt-0.5 text-micro text-muted">全員、ロール、個人から選択できます</p></div>
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={() => { onAllChange(!all); if (!all) { onRoleIdsChange([]); onPersonIdsChange([]); } }} className={cn("h-10 rounded-xl border text-xs font-semibold", all ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted")}>全員</button>
      <button type="button" onClick={() => { onAllChange(false); setMode("roles"); }} className={cn("h-10 rounded-xl border text-xs font-semibold", !all && mode === "roles" ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted")}>ロール {roleIds.length || ""}</button>
      <button type="button" onClick={() => { onAllChange(false); setMode("people"); }} className={cn("h-10 rounded-xl border text-xs font-semibold", !all && mode === "people" ? "border-accent bg-accent text-white" : "border-separator bg-card text-muted")}>部員 {personIds.length || ""}</button>
    </div>
    {!all && <>
      {mode === "roles" && <div className="space-y-1"><p className="section-label mb-1.5">ロール</p>{roles.map((role) => { const active = roleIds.includes(role.id); return <button key={role.id} type="button" onClick={() => toggleRole(role.id)} className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left", active ? "bg-accent/10" : "active:bg-bg")}><span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent"><Users size={15} /></span><span className="flex-1 text-sm font-semibold">{role.name}</span>{active && <Check size={18} className="text-accent" />}</button>; })}</div>}
      {mode === "people" && <PersonPicker people={people} value={personIds} onChange={(ids) => { onAllChange(false); onPersonIdsChange(ids); }} label="個別に部員を選択" />}
    </>}
  </div>;
}
