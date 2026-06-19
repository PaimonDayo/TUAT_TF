"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lock, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { PERMISSION_LIST } from "@/lib/permissions";
import type { AppRole, Permission } from "@/types";

const PERM_COLUMN: Record<Permission, keyof AppRole> = {
  manage_members: "can_manage_members",
  create_schedule: "can_create_schedule",
  create_menu: "can_create_menu",
  create_notice: "can_create_notice",
};

export function RoleManager({ roles: initialRoles }: { roles: AppRole[] }) {
  const [roles, setRoles] = useState(initialRoles);
  const [creating, setCreating] = useState(false);
  const [reordering, setReordering] = useState(false);

  async function move(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= roles.length || reordering) return;

    const previous = roles;
    const next = [...roles];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setRoles(next);
    setReordering(true);

    const supabase = createClient();
    const { error } = await supabase.rpc("reorder_roles", {
      role_ids: next.map((role) => role.id),
    });
    if (error) {
      setRoles(previous);
      alert("並び順を更新できませんでした");
    }
    setReordering(false);
  }

  return (
    <div className="space-y-2">
      {roles.map((role, index) => (
        <RoleRow
          key={role.id}
          role={role}
          first={index === 0}
          last={index === roles.length - 1}
          reordering={reordering}
          onMove={(direction) => move(index, direction)}
          onUpdated={(updated) =>
            setRoles((items) => items.map((item) => (item.id === updated.id ? updated : item)))
          }
          onDeleted={() => setRoles((items) => items.filter((item) => item.id !== role.id))}
        />
      ))}

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
  first,
  last,
  reordering,
  onMove,
  onUpdated,
  onDeleted,
}: {
  role: AppRole;
  first: boolean;
  last: boolean;
  reordering: boolean;
  onMove: (direction: -1 | 1) => void;
  onUpdated: (role: AppRole) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
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
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={first || reordering}
            aria-label={`${role.name}を上へ移動`}
            className="flex h-7 w-8 items-center justify-center text-muted disabled:opacity-20"
          >
            <ChevronUp size={17} />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={last || reordering}
            aria-label={`${role.name}を下へ移動`}
            className="flex h-7 w-8 items-center justify-center text-muted disabled:opacity-20"
          >
            <ChevronDown size={17} />
          </button>
        </div>

        <div className="min-w-0 flex-1 pt-1">
          <span className="flex items-center gap-1 text-[15px] font-semibold">
            <span className="break-words">{role.name}</span>
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
          onDelete={role.is_system ? undefined : remove}
          deleteTitle={`ロール「${role.name}」を削除しますか？`}
          deleteDescription="このロールの部員への割り当ても解除されます。"
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
        {error && <p className="text-center text-caption text-danger">{error}</p>}
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? "保存中…" : role ? "保存する" : "作成する"}
        </Button>
      </div>
    </FormModal>
  );
}
