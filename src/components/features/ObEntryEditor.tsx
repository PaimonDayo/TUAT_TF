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
import { OB_ENTRY_EVENTS } from "@/lib/ob-entry-edit";
import { entryGrade, type EntryMember } from "@/lib/entry-identity";
import { type ObEntry } from "@/lib/ob-entries";

export function ObEntryEditor({ entry, members, initialProfileId = "", onClose }: { entry?: ObEntry; members: EntryMember[]; initialProfileId?: string; onClose: () => void }) {
  const [profileId, setProfileId] = useState(initialProfileId);
  const [events, setEvents] = useState(entry?.events ?? []);
  const [marks, setMarks] = useState(entry?.qualification_marks ?? {});
  const [gender, setGender] = useState(entry?.events[0]?.startsWith("女子") ? "女子" : "男子");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "close" | null>(null);
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
    <div className="flex items-center justify-between gap-2"><h3 className="text-headline">出場種目</h3><div className="flex gap-1">{["男子", "女子"].map((value) => <Button key={value} size="sm" disabled={saving} variant={gender === value ? "primary" : "outline"} aria-pressed={gender === value} onClick={() => setGender(value)}>{value}</Button>)}</div></div>
    <p className="text-caption">タップで選択・解除できます（複数選択可）。</p>
    <div className="grid grid-cols-3 gap-2">{OB_ENTRY_EVENTS.filter((event) => event.startsWith(gender)).map((event) => {
      const selected = events.includes(event);
      return <button key={event} type="button" disabled={saving} aria-label={event} aria-pressed={selected}
        className={`min-h-12 rounded-xl border px-1.5 py-2 text-[13px] font-medium leading-snug disabled:opacity-40 ${selected ? "border-accent bg-accent text-white" : "border-separator bg-card text-ink"}`}
        onClick={() => { setEvents(selected ? events.filter((e) => e !== event) : [...events, event]); if (!selected && !Object.hasOwn(marks, event)) setMarks({ ...marks, [event]: null }); }}>
        <span aria-hidden="true">{selected ? "✓ " : "+ "}</span>{event.slice(2)}
      </button>;
    })}</div>
    {events.length > 0 && <div className="rounded-xl border border-separator bg-card px-3">
      <div className="flex items-center justify-between border-b border-separator py-3"><h3 className="text-headline">資格記録</h3><span className="text-caption">選択中 {events.length}種目</span></div>
      {events.map((event) => <div key={event} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-2 border-b border-separator py-2 last:border-0">
        <label htmlFor={`mark-${event}`} className="break-words py-2 text-[13px]">{event}</label>
        <Textarea id={`mark-${event}`} autoGrow rows={1} placeholder="未入力" maxLength={1000} disabled={saving} aria-label={`${event}の資格記録`} value={marks[event] ?? ""}
          onChange={(e) => setMarks({ ...marks, [event]: e.target.value || null })} />
      </div>)}
    </div>}
    {!events.length && <p className="text-body">{entry ? "全種目の取り消しになります。保存するまで確定しません。" : "出場種目を追加してください。"}</p>}
    {entry && events.length > 0 && <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEvents([])}>全種目の選択を解除</Button>}
    <p className="text-caption">資格記録は任意（各1000文字以内）。変更はアプリ内に保存されます。</p>
    <FormModalFooter><div className="flex items-center gap-3">
      <span className="shrink-0 text-body">{events.length}種目</span>
      <Button className="flex-1" disabled={saving || !dirty || (!entry && (!profileId || !events.length))} onClick={() => removed.length ? setConfirm("save") : void save()}>{saving ? "保存中…" : "変更を保存する"}</Button>
    </div></FormModalFooter>
    <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open && !saving) setConfirm(null); }}
      title={confirm === "close" ? "変更を破棄しますか？" : "エントリーを取り消しますか？"}
      description={confirm === "close" ? "保存していない変更は失われます。" : `${removed.join("・")}を取り消して保存します。`}
      confirmLabel={confirm === "close" ? "破棄する" : "取り消して保存する"} busyLabel="保存中…" busy={saving}
      onConfirm={() => confirm === "close" ? onClose() : void save()} />
  </section></FormModal>;
}
