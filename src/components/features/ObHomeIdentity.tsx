"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { confirmEntryMember } from "@/app/(app)/ob-entries/actions";

export type ObHomeCandidate = { id: string; revision: number; submitted_name: string; grade: string; events: string[]; sure: boolean };

/** ホームで、氏名照合で候補に挙がった回答を自分として紐付ける。押すまでは確定しない。 */
export function ObHomeIdentity({ candidates, profileId }: { candidates: ObHomeCandidate[]; profileId: string }) {
  const [saving, setSaving] = useState<string | null>(null);
  const router = useRouter();
  const { showToast } = useToast();
  async function link(candidate: ObHomeCandidate) {
    setSaving(candidate.id);
    try {
      const result = await confirmEntryMember(candidate.id, profileId, candidate.revision);
      if (!result.ok) { showToast(result.message ?? "保存できませんでした"); return; }
      showToast("自分のエントリーとして紐付けました", "success");
      router.refresh();
    } catch { showToast("保存できませんでした"); }
    finally { setSaving(null); }
  }
  return (
    <div className="space-y-2">
      <p className="text-caption">この回答はあなたですか？</p>
      {candidates.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-bg p-3">
          <div className="min-w-0">
            <p className="text-[15px] font-medium"><span className="mr-1 text-caption">{c.grade}</span>{c.submitted_name}</p>
            <p className="truncate text-caption">{c.events.length ? c.events.join("・") : "競技の出場登録なし"}{c.sure ? "" : "（学年などを確認）"}</p>
          </div>
          <Button size="sm" disabled={saving !== null} onClick={() => link(c)}>{saving === c.id ? "保存中…" : "自分です"}</Button>
        </div>
      ))}
    </div>
  );
}
