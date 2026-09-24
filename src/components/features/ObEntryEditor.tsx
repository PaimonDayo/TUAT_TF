"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { saveEntry } from "@/app/(app)/ob-entries/actions";
import { Card } from "@/components/ui/card";
import { OB_ENTRY_EVENTS, entryDivision } from "@/lib/ob-entry-edit";
import { entryGrade, type EntryMember } from "@/lib/entry-identity";
import { type ObEntry } from "@/lib/ob-entries";

export function ObEntryEditor({ entry, members, initialProfileId = "", onClose }: { entry?: ObEntry; members: EntryMember[]; initialProfileId?: string; onClose: () => void }) {
  const [profileId, setProfileId] = useState(initialProfileId);
  const [events, setEvents] = useState(entry?.events ?? []);
  const [marks, setMarks] = useState(entry?.qualification_marks ?? {});
  const fixedDivision = entry ? entryDivision(entry) : null;
  const [gender, setGender] = useState<string>(fixedDivision ?? "");
  const [pendingDivision, setPendingDivision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "close" | "division" | null>(null);
  const router = useRouter();
  const { showToast } = useToast();
  const cleanMarks = Object.fromEntries(Object.entries(marks).filter(([event]) => events.includes(event)));
  const dirty = JSON.stringify(events) !== JSON.stringify(entry?.events ?? []) || JSON.stringify(cleanMarks) !== JSON.stringify(entry?.qualification_marks ?? {}) || (!entry && !!profileId);
  const removed = entry?.events.filter((event) => !events.includes(event)) ?? [];
  async function save() {
    setSaving(true);
    try {
      const result = await saveEntry({ entryId: entry?.id ?? null, profileId: entry ? null : profileId, revision: entry?.revision ?? null, events, marks: cleanMarks });
      if (!result.ok) { showToast(result.message ?? "保存できませんでした"); setConfirm(null); return; }
      showToast(events.length ? "エントリーを保存しました" : "エントリーを取り消しました", "success");
      router.refresh(); onClose();
    } catch { showToast("保存できませんでした"); setConfirm(null); }
    finally { setSaving(false); }
  }
  return <FormModal open autoFocus={false} title={entry ? "エントリーの編集" : "追加エントリー"}
    onOpenChange={(open) => { if (!open && !saving && !confirm) { if (dirty) setConfirm("close"); else onClose(); } }}>
    <section className="space-y-3" aria-label="エントリー編集">
    {entry && <p className="text-headline">{entry.grade} {entry.submitted_name}</p>}
    {!entry && <Select value={profileId} onValueChange={setProfileId} disabled={saving} ariaLabel="追加する部員"
      options={[{ value: "", label: "部員を選択" }, ...members.map((m) => ({ value: m.id, label: `${entryGrade(m.grade)} ${m.display_name}` }))]} />}
    {fixedDivision ? <p className="text-caption">出場区分：{fixedDivision}（登録済みの種目から引き継ぎ）</p> : <div className="space-y-2">
      <p className="text-headline">出場区分</p>
      <Select value={gender} disabled={saving} ariaLabel="出場区分" options={[{value:"",label:"男子・女子を選択"},{value:"男子",label:"男子"},{value:"女子",label:"女子"}]}
        onValueChange={(value) => { if (events.length && value !== gender) { setPendingDivision(value); setConfirm("division"); } else setGender(value); }} />
      <p className="text-caption">本人の出場区分を確認してください。保存後は固定されます。</p>
    </div>}
    {gender && <>
      <div><h3 className="text-headline">出場種目・資格記録</h3><p className="mt-1 text-caption">出場する種目にチェックし、その下に資格記録を入力してください。</p></div>
      <Card className="divide-y divide-separator">
        {OB_ENTRY_EVENTS.filter((event) => event.startsWith(gender)).map((event) => {
          const selected = events.includes(event);
          return <div key={event} className="px-3.5">
            <label className="flex min-h-12 cursor-pointer items-center gap-3 py-3 text-body">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={selected} disabled={saving} aria-label={event}
                onChange={() => { setEvents(selected ? events.filter((e) => e !== event) : [...events, event]); if (!selected && !Object.hasOwn(marks, event)) setMarks({ ...marks, [event]: null }); }} />
              <span>{event.slice(2)}</span>
            </label>
            {selected && <div className="pb-3 pl-8">
              <label htmlFor={`mark-${event}`} className="mb-1 block text-caption">資格記録（任意）</label>
              <Textarea id={`mark-${event}`} autoGrow rows={1} placeholder="未入力" maxLength={1000} disabled={saving} aria-label={`${event}の資格記録`} value={marks[event] ?? ""}
                onChange={(e) => setMarks({ ...marks, [event]: e.target.value || null })} />
            </div>}
          </div>;
        })}
      </Card>
      {entry && !events.length && <p className="text-caption">保存すると全種目のエントリーを取り消します。</p>}
    </>}
    <FormModalFooter><div className="flex items-center gap-3">
      <span className="shrink-0 text-body">{events.length}種目</span>
      <Button className="flex-1" disabled={saving || !dirty || (!entry && (!profileId || !events.length))} onClick={() => removed.length ? setConfirm("save") : void save()}>{saving ? "保存中…" : "変更を保存する"}</Button>
    </div></FormModalFooter>
    <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open && !saving) setConfirm(null); }}
      title={confirm === "division" ? "出場区分を変更しますか？" : confirm === "close" ? "変更を破棄しますか？" : "エントリーを取り消しますか？"}
      description={confirm === "division" ? "選択した種目と入力中の資格記録をクリアします。" : confirm === "close" ? "保存していない変更は失われます。" : `${removed.join("・")}を取り消して保存します。`}
      confirmLabel={confirm === "division" ? "変更する" : confirm === "close" ? "破棄する" : "取り消して保存する"} busyLabel="保存中…" busy={saving}
      onConfirm={() => { if (confirm === "division") { setGender(pendingDivision ?? ""); setEvents([]); setMarks({}); setConfirm(null); } else if (confirm === "close") onClose(); else void save(); }} />
  </section></FormModal>;
}
