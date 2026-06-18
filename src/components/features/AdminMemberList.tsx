"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { cn } from "@/lib/utils";
import type { AppRole, Profile } from "@/types";

export function AdminMemberList({
  members,
  roles,
}: {
  members: Profile[];
  roles: AppRole[];
}) {
  return (
    <div className="space-y-2">
      {members.map((m) => (
        <MemberRow key={m.id} member={m} roles={roles} />
      ))}
    </div>
  );
}

function MemberRow({ member, roles }: { member: Profile; roles: AppRole[] }) {
  const router = useRouter();
  const [assigned, setAssigned] = useState<Set<string>>(
    new Set((member.roles ?? []).map((r) => r.id)),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(roleId: string) {
    const has = assigned.has(roleId);
    // 楽観的更新
    const next = new Set(assigned);
    if (has) next.delete(roleId);
    else next.add(roleId);
    setAssigned(next);
    setBusy(roleId);

    const supabase = createClient();
    const { error } = has
      ? await supabase
          .from("profile_roles")
          .delete()
          .eq("profile_id", member.id)
          .eq("role_id", roleId)
      : await supabase
          .from("profile_roles")
          .insert({ profile_id: member.id, role_id: roleId });

    if (error) {
      // 失敗したら戻す
      setAssigned(new Set(assigned));
      alert("更新に失敗しました");
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <Card className="p-3 space-y-2.5">
      <div className="flex items-center gap-3">
        <Avatar
          name={member.display_name || "?"}
          blocks={member.blocks}
          avatarUrl={member.avatar_url}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px] font-semibold truncate">
              {member.display_name || "名前未設定"}
            </span>
            <BlockPills blocks={member.blocks} />
          </div>
          <span className="text-micro">{member.email}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {roles.map((r) => {
          const active = assigned.has(r.id);
          return (
            <button
              key={r.id}
              onClick={() => toggle(r.id)}
              disabled={busy === r.id}
              className={cn(
                "h-8 px-3 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1 active:opacity-60 disabled:opacity-40",
                active
                  ? "bg-accent text-white border-accent"
                  : "bg-card border-separator text-muted2",
              )}
            >
              {active && <Check size={14} />}
              {r.name}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
