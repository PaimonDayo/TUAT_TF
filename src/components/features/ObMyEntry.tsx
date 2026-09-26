"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { claimMyEntry } from "@/app/(app)/ob-entries/actions";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ObEntryEditor, ObProgramDisclosure } from "@/components/features/ObEntryEditor";
import { entryEventRows, type ObEntry } from "@/lib/ob-entries";
import { entryGrade, type EntryMember } from "@/lib/entry-identity";
import { obEventTime, type ObPartyResponse } from "@/lib/ob-meet";

/** 一般部員向け: 自分のエントリーだけを見て、登録・編集する画面。プログラムも同じ画面で見られる。 */
export function ObMyEntry({ entry, party, me, openEditor = false }: { entry: ObEntry | null; party?: ObPartyResponse; me: EntryMember; openEditor?: boolean }) {
  const [editing, setEditing] = useState(openEditor);
  const rows = entry ? entryEventRows(entry) : [];
  return <div className="space-y-4 px-4 pt-2 pb-6">
    <Card className="p-4">
      <p className="text-caption">{entryGrade(me.grade)} {me.display_name}</p>
      {entry ? <>
        {rows.length ? <ul className="mt-2 space-y-1">{rows.map((row) => <li key={row.event} className="flex items-baseline gap-3 text-[15px]">
          <span className="w-12 shrink-0 text-caption tabular-nums">{obEventTime(row.event) ?? ""}</span>
          <span className="flex-1 font-medium">{row.event}</span><span className="truncate text-caption">{row.mark}</span>
        </li>)}</ul> : <p className="mt-2 text-[15px] text-muted">競技の出場登録なし</p>}
        <p className="mt-2 text-caption">懇親会：{party?.status ?? "未回答"}</p>
      </> : <p className="mt-2 text-[15px] text-muted">まだエントリーしていません</p>}
      <Button className="mt-4 w-full" onClick={() => setEditing(true)}><Pencil size={16} className="mr-1" />{entry ? "エントリーを編集する" : "エントリーする"}</Button>
    </Card>
    {!entry && <ClaimCard />}
    <Card className="p-1"><ObProgramDisclosure defaultOpen /></Card>
    {editing && (entry
      ? <ObEntryEditor key={`${entry.id}:${entry.revision}`} entry={entry} party={party} members={[me]} self onClose={() => setEditing(false)} />
      : <ObEntryEditor members={[me]} initialProfileId={me.id} self onClose={() => setEditing(false)} />)}
  </div>;
}

/** Googleフォームで回答済みだが、まだアプリの自分と紐付いていない人向け。アプリの名前と学年で呼び出す。 */
function ClaimCard() {
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();
  async function claim() {
    setSaving(true);
    try {
      const result = await claimMyEntry();
      if (!result.ok) { showToast(result.message ?? "呼び出せませんでした"); return; }
      showToast("自分の回答を呼び出しました", "success");
      router.refresh();
    } catch { showToast("呼び出せませんでした"); }
    finally { setSaving(false); }
  }
  return <Card className="space-y-2 p-4">
    <p className="text-headline">フォームで回答済みの人</p>
    <p className="text-caption">アプリの名前・学年と同じ回答を、自分のエントリーとして呼び出して編集できます。</p>
    <Button variant="outline" className="w-full" disabled={saving} onClick={() => void claim()}>{saving ? "確認中…" : "自分の回答を呼び出す"}</Button>
  </Card>;
}
