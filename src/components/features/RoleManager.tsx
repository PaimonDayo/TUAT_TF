"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Lock, Plus, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { ReorderList } from "@/components/ui/reorder-list";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/common/Avatar";
import { PERMISSION_LIST } from "@/lib/permissions";
import type { AppRole, Permission, Profile } from "@/types";

const ROLE_COLORS = [
  "#007aff",
  "#34c759",
  "#ff9500",
  "#ff3b30",
  "#af52de",
  "#5ac8fa",
  "#8e8e93",
  "#5856d6",
];

const PERM_COLUMN: Record<Permission, keyof AppRole> = {
  manage_system: "can_manage_system",
  manage_members: "can_manage_members",
  create_schedule: "can_create_schedule",
  create_menu: "can_create_menu",
  create_notice: "can_create_notice",
};

export function RoleManager({
  roles: initialRoles,
  members,
  canManageSystem,
}: {
  roles: AppRole[];
  members: Profile[];
  canManageSystem: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [roles, setRoles] = useState(initialRoles);
  const [creating, setCreating] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);

  async function reorder(next: AppRole[]) {
    const previous = roles;
    setRoles(next);
    const supabase = createClient();
    const { error } = await supabase.rpc("reorder_roles", {
      role_ids: next.map((role) => role.id),
    });
    if (error) {
      setRoles(previous);
      showToast("並び順を更新できませんでした");
    }
  }

  function renderRole(role: AppRole) {
    return (
      <RoleRow
        key={role.id}
        role={role}
        members={members}
        canManageSystem={canManageSystem}
        onError={showToast}
        onUpdated={(updated) => {
          setRoles((items) => items.map((item) => (item.id === updated.id ? updated : item)));
          router.refresh();
        }}
        onDeleted={() => {
          setRoles((items) => items.filter((item) => item.id !== role.id));
          router.refresh();
        }}
      />
    );
  }

  // カテゴリ（フォルダ）ごとにグループ化。未設定は最後にまとめる。
  const groups: { category: string | null; roles: AppRole[] }[] = [];
  for (const role of roles) {
    const category = role.category?.trim() || null;
    let group = groups.find((g) => g.category === category);
    if (!group) {
      group = { category, roles: [] };
      groups.push(group);
    }
    group.roles.push(role);
  }
  groups.sort((a, b) => (a.category === null ? 1 : 0) - (b.category === null ? 1 : 0));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant={reorderMode ? "primary" : "outline"}
          onClick={() => setReorderMode((value) => !value)}
        >
          <SlidersHorizontal size={16} />
          {reorderMode ? "完了" : "並べ替え"}
        </Button>
      </div>

      {reorderMode ? (
        <ReorderList
          items={roles}
          enabled
          onReorder={(next) => void reorder(next)}
          renderItem={(role) => renderRole(role)}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.category ?? "__none__"} className="space-y-2">
              {group.category && (
                <p className="section-label">{group.category}</p>
              )}
              <div className="space-y-2">{group.roles.map(renderRole)}</div>
            </section>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-separator py-3 text-[14px] font-semibold text-accent active:bg-bg"
      >
        <Plus size={18} /> 新しいロールを作成
      </button>

      {creating && (
        <RoleEditor
          open
          onClose={() => setCreating(false)}
          sortOrder={roles.length + 1}
          canManageSystem={canManageSystem}
          onSaved={(role) => {
            setRoles((items) => [...items, role]);
            setCreating(false);
            // 割当画面(AdminMemberList)にも新ロールを反映させるため再取得
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RoleRow({
  role,
  members,
  onUpdated,
  onDeleted,
  onError,
  canManageSystem,
}: {
  role: AppRole;
  members: Profile[];
  onUpdated: (role: AppRole) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
  canManageSystem: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [viewingMembers, setViewingMembers] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const perms = PERMISSION_LIST.filter((permission) => role[PERM_COLUMN[permission.key]]);
  const assignedCount = members.filter((m) =>
    m.roles.some((r) => r.id === role.id),
  ).length;

  async function toggleMember(member: Profile) {
    if (busyId) return;
    setBusyId(member.id);
    const has = member.roles.some((r) => r.id === role.id);
    const nextIds = has
      ? member.roles.filter((r) => r.id !== role.id).map((r) => r.id)
      : [...member.roles.map((r) => r.id), role.id];
    const supabase = createClient();
    const { error } = await supabase.rpc("set_profile_roles", {
      target_profile_id: member.id,
      target_role_ids: nextIds,
    });
    if (error) {
      onError("ロールを更新できませんでした");
      setBusyId(null);
      return;
    }
    router.refresh();
    setBusyId(null);
  }

  async function remove() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_custom_role", {
      target_role_id: role.id,
    });
    if (error || !data) {
      onError("ロールを削除できませんでした");
      return false;
    }
    onDeleted();
    return true;
  }

  return (
    <Card className="p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 pt-1">
          <span className="flex items-center gap-1 text-[15px] font-semibold">
            <button
              type="button"
              onClick={() => setViewingMembers(true)}
              className="inline-flex rounded-full px-2 py-0.5 text-[13px]"
              style={{ color: role.color, backgroundColor: `${role.color}18` }}
            >
              {role.name}
            </button>
            {role.is_system && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-micro text-muted">
                <Lock size={10} /> 組込
              </span>
            )}
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {perms.length === 0 ? (
              <span className="text-micro">権限なし（肩書きのみ）</span>
            ) : (
              perms.map((permission) => (
                <span
                  key={permission.key}
                  className="rounded-full bg-accent/10 px-2 py-0.5 text-micro text-accent"
                >
                  {permission.label}
                </span>
              ))
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setViewingMembers(true)}
          aria-label={`${role.name}のメンバーを管理`}
          className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg pl-2 pr-1 text-[13px] font-semibold text-accent active:opacity-60"
        >
          <span className="tabular-nums">{assignedCount}</span>人
          <ChevronRight size={18} />
        </button>

        <ActionMenu
          onEdit={() => setEditing(true)}
          onDelete={remove}
          deleteTitle={`ロール「${role.name}」を削除しますか？`}
          deleteDescription="このロールの部員への割り当ても解除されます。最後の管理権限ロールは削除できません。"
          triggerLabel={`${role.name}のメニュー`}
        />
      </div>

      {editing && (
        <RoleEditor
          open
          onClose={() => setEditing(false)}
          role={role}
          sortOrder={role.sort_order}
          canManageSystem={canManageSystem}
          onSaved={(updated) => {
            onUpdated(updated);
            setEditing(false);
          }}
        />
      )}
      {viewingMembers && (
        <FormModal
          open
          onOpenChange={(open) => !open && setViewingMembers(false)}
          title={`${role.name} のメンバー`}
        >
          <div className="space-y-3 pb-4">
            <p className="text-caption">
              タップで付与・解除できます（{assignedCount}人に付与中）。
            </p>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前で検索"
            />
            <div className="space-y-1">
              {members
                .filter((member) => {
                  const q = query.trim().toLowerCase();
                  return !q || (member.display_name ?? "").toLowerCase().includes(q);
                })
                .map((member) => {
                  const has = member.roles.some((r) => r.id === role.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      disabled={busyId === member.id}
                      onClick={() => void toggleMember(member)}
                      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left active:bg-bg disabled:opacity-50 ${
                        has ? "bg-accent/10" : ""
                      }`}
                    >
                      <Avatar
                        name={member.display_name || "?"}
                        avatarUrl={member.avatar_url}
                        blocks={member.blocks}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                        {member.display_name || "名前未設定"}
                      </span>
                      {has && <Check size={18} className="shrink-0 text-accent" />}
                    </button>
                  );
                })}
            </div>
          </div>
        </FormModal>
      )}
    </Card>
  );
}

function RoleEditor({
  open,
  onClose,
  onSaved,
  sortOrder,
  role,
  canManageSystem,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (role: AppRole) => void;
  sortOrder: number;
  role?: AppRole;
  canManageSystem: boolean;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [flags, setFlags] = useState<Record<Permission, boolean>>({
    manage_system: role?.can_manage_system ?? false,
    manage_members: role?.can_manage_members ?? false,
    create_schedule: role?.can_create_schedule ?? false,
    create_menu: role?.can_create_menu ?? false,
    create_notice: role?.can_create_notice ?? false,
  });
  const [color, setColor] = useState(role?.color ?? ROLE_COLORS[0]);
  const [category, setCategory] = useState(role?.category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: Permission) {
    setFlags((current) => ({ ...current, [key]: !current[key] }));
  }

  async function save() {
    if (!name.trim()) {
      setError("ロール名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      name: name.trim(),
      can_manage_system: flags.manage_system,
      can_manage_members: flags.manage_members,
      can_create_schedule: flags.create_schedule,
      can_create_menu: flags.create_menu,
      can_create_notice: flags.create_notice,
      color,
      category: category.trim() || null,
      sort_order: sortOrder,
    };
    const query = role
      ? supabase.from("roles").update(payload).eq("id", role.id)
      : supabase.from("roles").insert(payload);
    const { data, error: saveError } = await query.select("*").single();

    if (saveError || !data) {
      setError("保存に失敗しました");
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved(data as AppRole);
  }

  return (
    <FormModal
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      title={role ? "ロールを編集" : "ロールを作成"}
    >
      <div className="space-y-4 pb-4">
        <div>
          <p className="section-label mb-1.5">ロール名</p>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例: 会計担当 / 主将"
            maxLength={20}
          />
        </div>
        <div>
          <p className="section-label mb-1.5">カテゴリ（任意・フォルダ分け）</p>
          <Input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="例: 運営 / 種目別"
            maxLength={20}
          />
          <p className="text-micro mt-1">同じカテゴリ名のロールがまとめて表示されます。</p>
        </div>
        <div>
          <p className="section-label mb-1.5">権限</p>
          <div className="space-y-2">
            {PERMISSION_LIST.map((permission) => (
              <Toggle
                key={permission.key}
                checked={flags[permission.key]}
                onChange={() => toggle(permission.key)}
                label={permission.label}
                description={
                  permission.key === "manage_system" && !canManageSystem
                    ? `${permission.desc}（システム管理者のみ変更可）`
                    : permission.desc
                }
                disabled={permission.key === "manage_system" && !canManageSystem}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="section-label mb-1.5">ロールの色</p>
          <div className="grid grid-cols-8 gap-2">
            {ROLE_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setColor(option)}
                aria-label={`色 ${option}`}
                className="flex aspect-square items-center justify-center rounded-lg border"
                style={{
                  borderColor: color === option ? option : "#e5e5ea",
                  backgroundColor: `${option}18`,
                }}
              >
                <span className="h-5 w-5 rounded-full" style={{ backgroundColor: option }} />
              </button>
            ))}
          </div>
          <div className="mt-2">
            <span
              className="rounded-full px-2.5 py-1 text-[13px] font-semibold"
              style={{ color, backgroundColor: `${color}18` }}
            >
              {name.trim() || "ロール名"}
            </span>
          </div>
        </div>
        {error && <p className="text-center text-caption text-danger">{error}</p>}
        <FormModalFooter>
          <Button size="lg" onClick={save} disabled={saving}>
            {saving ? "保存中…" : role ? "保存する" : "作成する"}
          </Button>
        </FormModalFooter>
      </div>
    </FormModal>
  );
}
