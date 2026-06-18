"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { PERMISSION_LIST } from "@/lib/permissions";
import type { AppRole, Permission } from "@/types";

const PERM_COLUMN: Record<Permission, keyof AppRole> = {
  manage_members: "can_manage_members",
  create_schedule: "can_create_schedule",
  create_menu: "can_create_menu",
  create_notice: "can_create_notice",
};

export function RoleManager({ roles }: { roles: AppRole[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-2">
      {roles.map((role) => (
        <RoleRow key={role.id} role={role} />
      ))}

      <button
        onClick={() => setCreating(true)}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-separator py-3 text-[14px] font-semibold text-accent active:bg-bg"
      >
        <Plus size={18} /> 新しいロールを作成
      </button>

      <RoleEditor open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function RoleRow({ role }: { role: AppRole }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const perms = PERMISSION_LIST.filter((p) => role[PERM_COLUMN[p.key]]);

  async function remove() {
    if (!confirm(`ロール「${role.name}」を削除しますか？`)) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from("roles").delete().eq("id", role.id);
    if (error) {
      alert("削除に失敗しました");
      setDeleting(false);
      return;
    }
    router.refresh();
  }

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold flex items-center gap-1">
          {role.name}
          {role.is_system && (
            <span className="inline-flex items-center gap-0.5 text-micro text-muted">
              <Lock size={10} /> 組込
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setEditing(true)}
            className="h-8 px-3 rounded-lg border border-separator text-[13px] font-medium active:bg-bg"
          >
            編集
          </button>
          {!role.is_system && (
            <button
              onClick={remove}
              disabled={deleting}
              aria-label="削除"
              className="h-8 w-8 rounded-lg border border-separator flex items-center justify-center text-danger active:bg-bg"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {perms.length === 0 ? (
          <span className="text-micro">権限なし（肩書きのみ）</span>
        ) : (
          perms.map((p) => (
            <span key={p.key} className="text-micro rounded-full bg-accent/10 text-accent px-2 py-0.5">
              {p.label}
            </span>
          ))
        )}
      </div>
      <RoleEditor open={editing} onClose={() => setEditing(false)} role={role} />
    </Card>
  );
}

function RoleEditor({
  open,
  onClose,
  role,
}: {
  open: boolean;
  onClose: () => void;
  role?: AppRole;
}) {
  const router = useRouter();
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
    setFlags((f) => ({ ...f, [key]: !f[key] }));
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
    };
    const { error } = role
      ? await supabase.from("roles").update(payload).eq("id", role.id)
      : await supabase.from("roles").insert(payload);
    if (error) {
      setError("保存に失敗しました");
      setSaving(false);
      return;
    }
    setSaving(false);
    onClose();
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={role ? "ロールを編集" : "ロールを作成"}>
        <div className="space-y-4 pb-4">
          <div>
            <p className="section-label mb-1.5">ロール名</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 会計担当 / 主将"
              maxLength={20}
            />
          </div>
          <div>
            <p className="section-label mb-1.5">権限</p>
            <div className="space-y-2">
              {PERMISSION_LIST.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => toggle(p.key)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl bg-card border border-separator p-3 active:bg-bg text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{p.label}</span>
                    <span className="block text-micro">{p.desc}</span>
                  </span>
                  <span
                    className="h-6 w-10 rounded-full p-0.5 transition-colors flex shrink-0"
                    style={{
                      backgroundColor: flags[p.key] ? "#34c759" : "#e5e5ea",
                      justifyContent: flags[p.key] ? "flex-end" : "flex-start",
                    }}
                  >
                    <span className="h-5 w-5 rounded-full bg-white shadow" />
                  </span>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-caption text-danger text-center">{error}</p>}
          <Button size="lg" onClick={save} disabled={saving}>
            {saving ? "保存中…" : role ? "保存する" : "作成する"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
