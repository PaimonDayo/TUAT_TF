"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FolderPlus, Lock, Plus, SlidersHorizontal, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonPicker } from "@/components/features/PersonPicker";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { ReorderList } from "@/components/ui/reorder-list";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { PERMISSION_LIST } from "@/lib/permissions";
import type { AppRole, Permission, Profile, RoleCategory } from "@/types";

const ROLE_COLORS = ["#007aff", "#34c759", "#ff9500", "#ff3b30", "#af52de", "#5ac8fa", "#8e8e93", "#5856d6"];
const PERM_COLUMN: Record<Permission, keyof AppRole> = {
  manage_system: "can_manage_system",
  manage_members: "can_manage_members",
  create_schedule: "can_create_schedule",
  create_menu: "can_create_menu",
  create_notice: "can_create_notice",
};

export function RoleManager({ roles: initialRoles, members, categories: initialCategories, canManageSystem }: { roles: AppRole[]; members: Profile[]; categories: RoleCategory[]; canManageSystem: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [roles, setRoles] = useState(initialRoles);
  const [memberState, setMemberState] = useState(members);
  const [categories, setCategories] = useState(initialCategories);
  const [creating, setCreating] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);

  async function reorder(next: AppRole[]) {
    const previous = roles;
    setRoles(next);
    const { error } = await createClient().rpc("reorder_roles", { role_ids: next.map((role) => role.id) });
    if (error) { setRoles(previous); showToast("並び順を更新できませんでした"); }
  }

  function renderRole(role: AppRole) {
    return <RoleRow key={role.id} role={role} members={memberState} categories={categories} canManageSystem={canManageSystem} onMembersUpdated={setMemberState} onError={showToast} onUpdated={(updated) => { setRoles((items) => items.map((item) => item.id === updated.id ? updated : item)); router.refresh(); }} onDeleted={() => { setRoles((items) => items.filter((item) => item.id !== role.id)); router.refresh(); }} />;
  }

  const everyone = roles.filter((role) => role.is_everyone);
  const uncategorized = roles.filter((role) => !role.is_everyone && !role.category?.trim());
  const folders = categories.map((category) => ({ category, roles: roles.filter((role) => !role.is_everyone && role.category === category.name) }));
  const knownCategories = new Set(categories.map((category) => category.name));
  for (const role of roles) {
    const name = role.category?.trim();
    if (!role.is_everyone && name && !knownCategories.has(name)) {
      folders.push({ category: { id: name, name, sort_order: 9999, created_at: role.created_at }, roles: roles.filter((item) => item.category === name) });
      knownCategories.add(name);
    }
  }

  return <div className="space-y-3">
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setCreatingCategory(true)}><FolderPlus size={16} />カテゴリを作成</Button>
      <Button type="button" size="sm" variant={reorderMode ? "primary" : "outline"} onClick={() => setReorderMode((value) => !value)}><SlidersHorizontal size={16} />{reorderMode ? "完了" : "並べ替え"}</Button>
    </div>

    {reorderMode ? <ReorderList items={roles} enabled onReorder={(next) => void reorder(next)} renderItem={renderRole} /> : <div className="space-y-3">
      {everyone.map(renderRole)}
      {folders.map((folder) => <details key={folder.category.id} className="group overflow-hidden rounded-xl border border-separator bg-card">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 active:bg-bg"><span className="flex-1 text-sm font-semibold">{folder.category.name}</span><span className="text-xs tabular-nums text-muted">{folder.roles.length}件</span><ChevronDown size={18} className="text-muted transition-transform group-open:rotate-180" /></summary>
        <div className="space-y-2 border-t border-separator bg-bg/40 p-2">{folder.roles.length ? folder.roles.map(renderRole) : <p className="px-2 py-3 text-xs text-muted">このカテゴリのロールはまだありません</p>}</div>
      </details>)}
      {uncategorized.length > 0 && <section className="space-y-2"><p className="section-label">カテゴリなし</p>{uncategorized.map(renderRole)}</section>}
    </div>}

    <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-separator py-3 text-[14px] font-semibold text-accent active:bg-bg"><Plus size={18} />新しいロールを作成</button>
    {creating && <RoleEditor open onClose={() => setCreating(false)} sortOrder={roles.length + 1} categories={categories} canManageSystem={canManageSystem} onSaved={(role) => { setRoles((items) => [...items, role]); setCreating(false); }} />}
    {creatingCategory && <CategoryEditor open sortOrder={categories.length + 1} onClose={() => setCreatingCategory(false)} onSaved={(category) => { setCategories((items) => [...items, category]); setCreatingCategory(false); }} />}
  </div>;
}

function RoleRow({ role, members, categories, onUpdated, onDeleted, onMembersUpdated, onError, canManageSystem }: { role: AppRole; members: Profile[]; categories: RoleCategory[]; onUpdated: (role: AppRole) => void; onDeleted: () => void; onMembersUpdated: (members: Profile[]) => void; onError: (message: string) => void; canManageSystem: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const perms = PERMISSION_LIST.filter((permission) => role[PERM_COLUMN[permission.key]]);
  const assignedIds = role.is_everyone ? members.map((member) => member.id) : members.filter((member) => member.roles.some((item) => item.id === role.id)).map((member) => member.id);

  async function updateRoleMembers(nextMemberIds: string[]) {
    if (role.is_everyone) return;
    const previous = members;
    const selected = new Set(nextMemberIds);
    const optimistic = members.map((member) => ({ ...member, roles: selected.has(member.id) ? member.roles.some((item) => item.id === role.id) ? member.roles : [...member.roles, role] : member.roles.filter((item) => item.id !== role.id) }));
    onMembersUpdated(optimistic);
    const { error } = await createClient().rpc("set_role_members", { target_role_id: role.id, target_profile_ids: nextMemberIds });
    if (error) { onMembersUpdated(previous); onError("ロールのメンバーを更新できませんでした"); }
    else router.refresh();
  }

  async function remove() {
    const { data, error } = await createClient().rpc("delete_custom_role", { target_role_id: role.id });
    if (error || !data) { onError("ロールを削除できませんでした"); return false; }
    onDeleted(); return true;
  }

  return <Card className="p-3">
    <div className="flex items-start gap-2"><div className="min-w-0 flex-1 pt-1">
      <span className="flex items-center gap-1 text-[15px] font-semibold"><span className="inline-flex rounded-full px-2 py-0.5 text-[13px]" style={{ color: role.color, backgroundColor: `${role.color}18` }}>{role.name}</span>{role.is_system && <span className="inline-flex shrink-0 items-center gap-0.5 text-micro text-muted"><Lock size={10} />{role.is_everyone ? "全員に自動適用" : "組込"}</span>}</span>
      <div className="mt-1.5 flex flex-wrap gap-1">{perms.length === 0 ? <span className="text-micro">権限なし（肩書きのみ）</span> : perms.map((permission) => <span key={permission.key} className="rounded-full bg-accent/10 px-2 py-0.5 text-micro text-accent">{permission.label}</span>)}</div>
    </div><ActionMenu onEdit={() => setEditing(true)} onDelete={role.is_system ? undefined : remove} deleteTitle={`ロール「${role.name}」を削除しますか？`} deleteDescription="このロールの部員への割り当ても解除されます。" triggerLabel={`${role.name}のメニュー`} /></div>
    {editing && <RoleEditor open onClose={() => setEditing(false)} role={role} sortOrder={role.sort_order} categories={categories} canManageSystem={canManageSystem} onSaved={(updated) => { onUpdated(updated); setEditing(false); }} />}
    <div className="mt-3">{role.is_everyone ? <div className="flex min-h-11 items-center gap-2 rounded-xl border border-separator bg-bg px-3 text-sm font-semibold"><Users size={17} className="text-accent" /><span className="flex-1">すべての部員</span><span className="text-muted">{members.length}人</span></div> : <PersonPicker people={members} value={assignedIds} onChange={(ids) => void updateRoleMembers(ids)} label={`所属メンバー（${assignedIds.length}人）`} />}</div>
  </Card>;
}

function RoleEditor({ open, onClose, onSaved, sortOrder, role, categories, canManageSystem }: { open: boolean; onClose: () => void; onSaved: (role: AppRole) => void; sortOrder: number; role?: AppRole; categories: RoleCategory[]; canManageSystem: boolean }) {
  const [name, setName] = useState(role?.name ?? "");
  const [flags, setFlags] = useState<Record<Permission, boolean>>({ manage_system: role?.can_manage_system ?? false, manage_members: role?.can_manage_members ?? false, create_schedule: role?.can_create_schedule ?? false, create_menu: role?.can_create_menu ?? false, create_notice: role?.can_create_notice ?? false });
  const [color, setColor] = useState(role?.color ?? ROLE_COLORS[0]);
  const [category, setCategory] = useState(role?.category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("ロール名を入力してください"); return; }
    setSaving(true); setError(null);
    const payload = { name: role?.is_everyone ? "全員" : name.trim(), can_manage_system: flags.manage_system, can_manage_members: flags.manage_members, can_create_schedule: flags.create_schedule, can_create_menu: flags.create_menu, can_create_notice: flags.create_notice, color, category: role?.is_everyone ? null : category || null, sort_order: sortOrder };
    const query = role ? createClient().from("roles").update(payload).eq("id", role.id) : createClient().from("roles").insert(payload);
    const { data, error: saveError } = await query.select("*").single();
    if (saveError || !data) { setError("保存に失敗しました"); setSaving(false); return; }
    setSaving(false); onSaved(data as AppRole);
  }

  return <FormModal open={open} onOpenChange={(next) => !next && onClose()} title={role ? "ロールを編集" : "ロールを作成"}><div className="space-y-4 pb-4">
    <div><p className="section-label mb-1.5">ロール名</p><Input value={name} onChange={(event) => setName(event.target.value)} disabled={role?.is_everyone} placeholder="例: 会計担当 / 主将" maxLength={20} /></div>
    {!role?.is_everyone && <div><p className="section-label mb-1.5">カテゴリ</p><Select value={category || "__none__"} onValueChange={(value) => setCategory(value === "__none__" ? "" : value)} ariaLabel="ロールカテゴリ" options={[{ value: "__none__", label: "カテゴリなし" }, ...categories.map((item) => ({ value: item.name, label: item.name }))]} /></div>}
    <div><p className="section-label mb-1.5">権限</p><div className="space-y-2">{PERMISSION_LIST.map((permission) => { const administrativeForEveryone = role?.is_everyone && (permission.key === "manage_system" || permission.key === "manage_members"); const disabled = administrativeForEveryone || (permission.key === "manage_system" && !canManageSystem); return <Toggle key={permission.key} checked={flags[permission.key]} onChange={() => setFlags((current) => ({ ...current, [permission.key]: !current[permission.key] }))} label={permission.label} description={administrativeForEveryone ? "全員ロールには安全上付与できません" : permission.key === "manage_system" && !canManageSystem ? `${permission.desc}（システム管理者のみ変更可）` : permission.desc} disabled={disabled} />; })}</div></div>
    <div><p className="section-label mb-1.5">ロールの色</p><div className="grid grid-cols-8 gap-2">{ROLE_COLORS.map((option) => <button key={option} type="button" onClick={() => setColor(option)} aria-label={`色 ${option}`} className="flex aspect-square items-center justify-center rounded-lg border" style={{ borderColor: color === option ? option : "#e5e5ea", backgroundColor: `${option}18` }}><span className="h-5 w-5 rounded-full" style={{ backgroundColor: option }} /></button>)}</div></div>
    {error && <p className="text-center text-caption text-danger">{error}</p>}<FormModalFooter><Button size="lg" onClick={save} disabled={saving}>{saving ? "保存中…" : role ? "保存する" : "作成する"}</Button></FormModalFooter>
  </div></FormModal>;
}

function CategoryEditor({ open, onClose, onSaved, sortOrder }: { open: boolean; onClose: () => void; onSaved: (category: RoleCategory) => void; sortOrder: number }) {
  const [name, setName] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() { if (!name.trim()) return; setSaving(true); setError(""); const { data, error: saveError } = await createClient().from("role_categories").insert({ name: name.trim(), sort_order: sortOrder }).select("*").single(); if (saveError || !data) { setError("同じ名前のカテゴリがあるか、保存に失敗しました"); setSaving(false); return; } onSaved(data as RoleCategory); }
  return <FormModal open={open} onOpenChange={(next) => !next && onClose()} title="ロールカテゴリを作成"><div className="space-y-4 pb-4"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例：運営 / 種目別" maxLength={20} />{error && <p className="text-caption text-danger">{error}</p>}<FormModalFooter><Button size="lg" onClick={save} disabled={saving || !name.trim()}>{saving ? "作成中…" : "作成する"}</Button></FormModalFooter></div></FormModal>;
}