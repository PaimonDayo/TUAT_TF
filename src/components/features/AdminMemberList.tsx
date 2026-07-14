"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { GRADE_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { AppRole, Profile } from "@/types";

export function AdminMemberList({
  members,
  roles,
}: {
  members: Profile[];
  roles: AppRole[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return members;
    return members.filter(
      (member) =>
        member.display_name.toLowerCase().includes(keyword) ||
        member.email.toLowerCase().includes(keyword),
    );
  }, [members, query]);

  // 学年ごとにグループ化（GRADE_OPTIONS 順。学年未設定は末尾）
  const groups = useMemo(() => {
    const out: { key: string; label: string; list: Profile[] }[] = [];
    for (const g of GRADE_OPTIONS) {
      const list = filtered.filter((m) => m.grade === g.value);
      if (list.length > 0) out.push({ key: g.value, label: g.short, list });
    }
    const noGrade = filtered.filter((m) => !m.grade);
    if (noGrade.length > 0) out.push({ key: "none", label: "学年未設定", list: noGrade });
    return out;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          size={17}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="部員を検索"
          className="pl-9"
        />
      </div>

      {groups.map((group) => (
        <section key={group.key}>
          <p className="section-label mb-2">
            {group.label}
            <span className="ml-1.5 tabular-nums">{group.list.length}</span>
          </p>
          <div className="space-y-2">
            {group.list.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setSelected(member)}
                className="w-full text-left"
              >
                <Card className="flex items-center gap-3 p-3 active:bg-bg">
                  <Avatar
                    name={member.display_name || "?"}
                    blocks={member.blocks}
                    avatarUrl={member.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold">
                        {member.display_name || "名前未設定"}
                      </span>
                      <BlockPills blocks={member.blocks} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {member.roles.filter((role) => !role.is_everyone).length === 0 ? (
                        <span className="text-micro">ロールなし</span>
                      ) : (
                        member.roles.filter((role) => !role.is_everyone).map((role) => (
                          <span
                            key={role.id}
                            className="rounded-full px-2 py-0.5 text-micro"
                            style={{
                              color: role.color,
                              backgroundColor: `${role.color}18`,
                            }}
                          >
                            {role.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-muted" />
                </Card>
              </button>
            ))}
          </div>
        </section>
      ))}

      {selected && (
        <MemberRoleEditor
          member={selected}
          roles={roles.filter((role) => !role.is_everyone)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function MemberRoleEditor({
  member,
  roles,
  onClose,
}: {
  member: Profile;
  roles: AppRole[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>(
    member.roles.filter((role) => !role.is_everyone).map((role) => role.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(roleId: string) {
    setSelectedIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    );
  }

  async function save() {
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { error: saveError } = await supabase.rpc("set_profile_roles", {
      target_profile_id: member.id,
      target_role_ids: selectedIds,
    });
    if (saveError) {
      setError("ロールを更新できませんでした");
      setSaving(false);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <FormModal open onOpenChange={(open) => !open && onClose()} title="ロールを設定">
      <div className="space-y-4 pb-4">
        <div className="flex items-center gap-3">
          <Avatar
            name={member.display_name || "?"}
            blocks={member.blocks}
            avatarUrl={member.avatar_url}
            size="md"
          />
          <div className="min-w-0">
            <p className="text-headline">{member.display_name || "名前未設定"}</p>
            <p className="truncate text-caption">{member.email}</p>
          </div>
        </div>

        <div className="space-y-2">
          {roles.map((role) => {
            const active = selectedIds.includes(role.id);
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => toggle(role.id)}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl border p-3 text-left",
                  active ? "border-current" : "border-separator bg-card",
                )}
                style={
                  active
                    ? { color: role.color, backgroundColor: `${role.color}12` }
                    : undefined
                }
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: role.color }}
                />
                <span className="min-w-0 flex-1 text-[14px] font-semibold">
                  {role.name}
                </span>
                {active && <Check size={18} />}
              </button>
            );
          })}
        </div>

        {error && <p className="text-center text-caption text-danger">{error}</p>}
        <FormModalFooter>
          <Button size="lg" onClick={save} disabled={saving}>
            {saving ? "保存中..." : "保存する"}
          </Button>
        </FormModalFooter>
      </div>
    </FormModal>
  );
}
