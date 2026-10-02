"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeAuthorRow } from "@/lib/profile-normalize";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/common/Avatar";
import { gradeShort } from "@/lib/constants";
import type { Block } from "@/types";

type Acknowledger = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  blocks: Block[];
  grade: string | null;
};

export function NoticeAcknowledgersSheet({ noticeId, open, onOpenChange }: {
  noticeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [people, setPeople] = useState<Acknowledger[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeople(null);
    setFailed(false);
    void (async () => {
      try {
        const { data, error } = await createClient()
          .from("notice_reactions")
          .select("created_at, profiles(id, display_name, avatar_url, blocks, grade)")
          .eq("notice_id", noticeId)
          .eq("reaction", "ack")
          .order("created_at", { ascending: false });
        if (!active) return;
        if (error) throw error;
        const list = (data ?? []).flatMap((row) =>
          row.profiles ? [normalizeAuthorRow(row.profiles)] : []
        );
        setPeople(list);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [open, noticeId, attempt]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="確認した人" autoFocus={false}>
        {failed ? (
          <div className="space-y-3 py-8 text-center">
            <p role="alert" className="text-caption text-danger">確認した人を取得できませんでした。通信状態を確認してから、もう一度お試しください。</p>
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>再試行</Button>
          </div>
        ) : people === null ? (
          <p className="py-8 text-center text-caption">読み込み中…</p>
        ) : people.length === 0 ? (
          <p className="py-8 text-center text-caption">まだ確認した人はいません</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto pb-2">
            {people.map((profile) => (
              <li key={profile.id} className="flex items-center gap-3 py-2">
                <Avatar name={profile.display_name} avatarUrl={profile.avatar_url} blocks={profile.blocks} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{profile.display_name}</span>
                <span className="shrink-0 text-micro">{gradeShort(profile.grade) ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
