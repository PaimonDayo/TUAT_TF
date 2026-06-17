"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { ROLES } from "@/lib/constants";
import type { Profile, Role } from "@/types";

const ROLE_KEYS: Role[] = ["member", "menu_staff", "admin"];

export function AdminMemberList({ members }: { members: Profile[] }) {
  return (
    <div className="space-y-2">
      {members.map((m) => (
        <MemberRow key={m.id} member={m} />
      ))}
    </div>
  );
}

function MemberRow({ member }: { member: Profile }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(member.role);
  const [saving, setSaving] = useState(false);

  async function changeRole(next: Role) {
    const prev = role;
    setRole(next);
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ role: next }).eq("id", member.id);
    if (error) setRole(prev);
    setSaving(false);
    router.refresh();
  }

  return (
    <Card className="p-3 flex items-center gap-3">
      <Avatar name={member.display_name || "?"} blocks={member.blocks} avatarUrl={member.avatar_url} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[14px] font-semibold truncate">
            {member.display_name || "名前未設定"}
          </span>
          <BlockPills blocks={member.blocks} />
        </div>
        <span className="text-micro">{member.email}</span>
      </div>
      <select
        value={role}
        disabled={saving}
        onChange={(e) => changeRole(e.target.value as Role)}
        className="h-9 rounded-lg border border-separator bg-bg px-2 text-[13px] font-medium text-ink outline-none"
      >
        {ROLE_KEYS.map((r) => (
          <option key={r} value={r}>
            {ROLES[r].label}
          </option>
        ))}
      </select>
    </Card>
  );
}
