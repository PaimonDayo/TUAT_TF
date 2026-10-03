"use client";

import { useRouter } from "next/navigation";
import { ActionMenu } from "@/components/ui/action-menu";
import { useToast } from "@/components/ui/toast";
import { deleteEntry } from "@/app/(app)/ob-entries/actions";
import { useState } from "react";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { normalizeEntryName } from "@/lib/entry-identity";
import { compareByGrade } from "@/lib/ob-meet";
import type { ObEntry } from "@/lib/ob-entries";

/** 担当者は種目を探さず、人を選んで同じ入口から登録・編集する。 */
export function ObEntryManager({ entries, canAdd, onEdit, onNew, onClose }: { entries: ObEntry[]; canAdd: boolean; onEdit: (id: string) => void; onNew: () => void; onClose: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [deleted, setDeleted] = useState<string[]>([]);
  async function remove(entry: ObEntry) {
    try {
      const result = await deleteEntry({entryId:entry.id,revision:entry.revision});
      if (!result.ok) {showToast(result.message ?? "削除できませんでした");return false;}
      setDeleted(ids=>[...ids,entry.id]);showToast("エントリーを削除しました", "success");router.refresh();return true;
    } catch {showToast("削除できませんでした。もう一度お試しください");return false;}
  }
  const [search, setSearch] = useState("");
  const query = normalizeEntryName(search).toLowerCase();
  const visible = entries.filter((e) => !deleted.includes(e.id) && normalizeEntryName(`${e.grade} ${e.submitted_name}`).toLowerCase().includes(query))
    .sort((a, b) => compareByGrade({ grade: a.grade, name: a.submitted_name }, { grade: b.grade, name: b.submitted_name }));
  return <FormModal open title="エントリー管理" autoFocus={false} onOpenChange={(open) => !open && onClose()}>
    <div className="space-y-4">
      <Input aria-label="登録済みの氏名・学年で検索" placeholder="検索" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Card className="divide-y divide-separator">
        {visible.map((entry) => <div key={entry.id} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="break-words text-headline">{entry.grade} {entry.submitted_name}</p>
            <p className="mt-1 break-words text-caption">{entry.events.length ? entry.events.join("・") : "競技の出場登録なし"}</p>
          </div>
          <ActionMenu triggerLabel={`${entry.submitted_name}のエントリー操作`} onEdit={() => onEdit(entry.id)} onDelete={() => remove(entry)} deleteTitle={`${entry.submitted_name}のエントリーを削除しますか？`} deleteDescription="競技のエントリーを削除します。懇親会の回答と変更履歴は残ります。補助担当や組み分け・競技記録がある場合は削除できません。" />
        </div>)}
        {!visible.length && <EmptyState title="条件に合うエントリーはありません" />}
      </Card>
      {canAdd && <Button variant="outline" className="w-full" onClick={onNew}>新しく参加者を登録</Button>}
    </div>
  </FormModal>;
}
