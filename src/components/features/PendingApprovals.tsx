"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PendingProfile } from "@/types";

/**
 * 承認待ちユーザーの一覧と承認ボタン。
 * 承認は「承認済みの部員なら誰でも」可能（RPC set_member_approved 側で is_member を検証）。
 */
export function PendingApprovals({ pending }: { pending: PendingProfile[] }) {
  const router = useRouter();
  const [list, setList] = useState(pending);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (list.length === 0) return null;

  async function approve(id: string) {
    setBusyId(id);
    setError("");
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_member_approved", {
      target_profile_id: id,
      value: true,
    });
    if (rpcError) {
      setError("承認できませんでした");
      setBusyId(null);
      return;
    }
    setList((cur) => cur.filter((p) => p.id !== id));
    setBusyId(null);
    router.refresh();
  }

  return (
    <section className="px-4 pb-4">
      <p className="section-label mb-2">
        承認待ち
        <span className="ml-1.5 tabular-nums">{list.length}</span>
      </p>
      <p className="mb-2 text-caption text-muted">
        新しく登録した人を承認すると、アプリを使えるようになります。誰でも承認できます。
      </p>
      <div className="space-y-2">
        {list.map((p) => (
          <Card key={p.id} className="flex items-center gap-3 p-3">
            <Avatar
              name={p.display_name || "?"}
              blocks={p.blocks}
              avatarUrl={p.avatar_url}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-semibold">
                  {p.display_name || "名前未設定"}
                </span>
                <BlockPills blocks={p.blocks} />
              </div>
              <p className="truncate text-micro text-muted">{p.email}</p>
            </div>
            <Button
              size="sm"
              onClick={() => approve(p.id)}
              disabled={busyId === p.id}
            >
              {busyId === p.id ? (
                "承認中..."
              ) : (
                <>
                  <Check size={15} />
                  承認
                </>
              )}
            </Button>
          </Card>
        ))}
      </div>
      {error && <p className="mt-2 text-center text-caption text-danger">{error}</p>}
    </section>
  );
}
