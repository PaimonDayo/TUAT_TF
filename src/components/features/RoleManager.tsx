"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lock, Plus, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { ReorderList } from "@/components/ui/reorder-list";
import { Avatar } from "@/components/common/Avatar";
import { EmptyState } from "@/components/ui/empty-state";
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
  manage_members: "can_manage_members",
  create_schedule: "can_create_schedule",
  create_menu: "can_create_menu",
  create_notice: "can_create_notice",
};

export function RoleManager({
  roles: initialRoles,
  members,
}: {
  roles: AppRole[];
  members: Profile[];
}) {
  const [roles, setRoles] = useState(initialRoles);
  const [creating, setCreating] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function reorder(next: AppRole[]) {
    const previous = roles;
    setRoles(next);
    const supabase = createClient();
    const { error } = await supabase.rpc("reorder_roles", {
      role_ids: next.map((role) => role.id),
    });
    if (error) {
      setRoles(previous);
      alert("並び順を更新できませんでした");
    }
  }

  const visibleRoles = reorderMode || expanded ? roles : roles.slice(0, 3);

  return (
    <div className="space-y-2">
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

      <ReorderList
        items={visibleRoles}
        enabled={reorderMode}
        onReorder={(nextVisible) => {
          if (visibleRoles.length === roles.length) void reorder(nextVisible);
        }}
        renderItem={(role) => (
          <RoleRow
            key={role.id}
            role={role}
            members={members.filter((member) =>
              member.roles.some((assigned) => assigned.id === role.id),
            )}
            onUpdated={(updated) =>
              setRoles((items) => items.map((item) => (item.id === updated.id ? updated : item)))
            }
            onDeleted={() => setRoles((items) => items.filter((item) => item.id !== role.id))}
          />
        )}
      />

      {!reorderMode && roles.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-10 w-full items-center justify-center gap-1 text-[13px] font-semibold text-accent active:opacity-60"
        >
          {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          {expanded ? "上位3件だけ表示" : `すべて表示（${roles.length}件）`}
        </button>
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
          onSaved={(role) => {
            setRoles((items) => [...items, role]);
            setCreating(false);
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
}: {
  role: AppRole;
  members: Profile[];
  onUpdated: (role: AppRole) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [viewingMembers, setViewingMembers] = useState(false);
  const perms = PERMISSION_LIST.filter((permission) => role[PERM_COLUMN[permission.key]]);

  async function remove() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_custom_role", {
      target_role_id: role.id,
    });
    if (error || !data) {
      alert("ロールを削除できませんでした");
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
          title={role.name}
        >
          {members.length === 0 ? (
            <EmptyState title="このロールの部員はいません" />
          ) : (
            <div className="space-y-2 pb-4">
              {members.map((member) => (
                <Card key={member.id} className="flex items-center gap-3 p-3">
                  <Avatar
                    name={member.display_name || "?"}
                    avatarUrl={member.avatar_url}
                    blocks={member.blocks}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">
                      {member.display_name || "名前未設定"}
                    </p>
                    <p className="truncate text-caption">{member.email}</p>
                  </div>
                </Card>
              ))}
            </div>
          )}
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
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (role: AppRole) => void;
  sortOrder: number;
  role?: AppRole;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [flags, setFlags] = useState<Record<Permission, boolean>>({
    manage_members: role?.can_manage_members ?? false,
    create_schedule: role?.can_create_schedule ?? false,
    create_menu: role?.can_create_menu ?? false,
    create_notice: role?.can_create_notice ?? false,
  });
  const [color, setColor] = useState(role?.color ?? ROLE_COLORS[0]);
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
      can_manage_members: flags.manage_members,
      can_create_schedule: flags.create_schedule,
      can_create_menu: flags.create_menu,
      can_create_notice: flags.create_notice,
      color,
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
          <p className="section-label mb-1.5">権限</p>
          <div className="space-y-2">
            {PERMISSION_LIST.map((permission) => (
              <button
                key={permission.key}
                type="button"
                onClick={() => toggle(permission.key)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-separator bg-card p-3 text-left active:bg-bg"
              >
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{permission.label}</span>
                  <span className="block text-micro">{permission.desc}</span>
                </span>
                <span
                  className="flex h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors"
                  style={{
                    backgroundColor: flags[permission.key] ? "#34c759" : "#e5e5ea",
                    justifyContent: flags[permission.key] ? "flex-end" : "flex-start",
                  }}
                >
                  <span className="h-5 w-5 rounded-full bg-white shadow" />
                </span>
              </button>
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
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? "保存中…" : role ? "保存する" : "作成する"}
        </Button>
      </div>
    </FormModal>
  );
}
