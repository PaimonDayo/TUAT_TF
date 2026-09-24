"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { saveEntry, getEntryChanges } from "@/app/(app)/ob-entries/actions";
import { OB_ENTRY_EVENTS, type EntryChange } from "@/lib/ob-entry-edit";
import { entryGrade, type EntryMember } from "@/lib/entry-identity";
import { type ObEntry, entryEventRows } from "@/lib/ob-entries";

export function ObEntryEditor({ entry, members, initialProfileId = "", onClose }: { entry?: ObEntry; members: EntryMember[]; initialProfileId?: string; onClose: () => void }) {
  const [profileId, setProfileId] = useState(initialProfileId);
  const [events, setEvents] = useState(entry?.events ?? []);
  const [marks, setMarks] = useState(entry?.qualification_marks ?? {});
  const [adding, setAdding] = useState("");
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
    <p className="text-caption">アプリ内のエントリーを変更します。元のGoogleフォームには反映されません。</p>
    {!entry && <Select value={profileId} onValueChange={setProfileId} disabled={saving} ariaLabel="追加する部員"
      options={[{ value: "", label: "部員を選択" }, ...members.map((m) => ({ value: m.id, label: `${entryGrade(m.grade)} ${m.display_name}` }))]} />}
    {events.map((event) => <div key={event} className="space-y-2 rounded-xl border border-separator p-3">
      <div className="flex items-start justify-between gap-2"><p className="text-body break-words">{event}</p><Button size="sm" variant="outline" disabled={saving} aria-label={`${event}を取り消す`} onClick={() => setEvents(events.filter((e) => e !== event))}>取り消す</Button></div>
      <label className="block text-caption">資格記録（任意・1000文字以内）<Textarea autoGrow rows={2} maxLength={1000} disabled={saving} aria-label={`${event}の資格記録`} value={marks[event] ?? ""}
        onChange={(e) => setMarks({ ...marks, [event]: e.target.value || null })} /></label>
    </div>)}
    {!events.length && <p className="text-body">{entry ? "全種目の取り消しになります。保存するまで確定しません。" : "出場種目を追加してください。"}</p>}
    {entry && events.length > 1 && <Button size="sm" variant="outline" disabled={saving} onClick={() => setEvents([])}>全種目を取り消す</Button>}
    <div className="space-y-2">
      <Select value={adding} onValueChange={setAdding} disabled={saving} ariaLabel="追加する種目"
        options={[{ value: "", label: "追加する種目を選択" }, ...OB_ENTRY_EVENTS.filter((event) => !events.includes(event)).map((event) => ({ value: event, label: event }))]} />
      <Button size="sm" variant="outline" disabled={saving || !adding} onClick={() => { setEvents([...events, adding]); setMarks({ ...marks, [adding]: marks[adding] ?? null }); setAdding(""); }}>種目を追加する</Button>
    </div>
    <FormModalFooter><div className="flex flex-wrap gap-2">
      <Button disabled={saving || !dirty || (!entry && (!profileId || !events.length))} onClick={() => removed.length ? setConfirm("save") : void save()}>{saving ? "保存中…" : "保存する"}</Button>
      <Button variant="outline" disabled={saving} onClick={() => dirty ? setConfirm("close") : onClose()}>閉じる</Button>
    </div></FormModalFooter>
    <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open && !saving) setConfirm(null); }}
      title={confirm === "close" ? "変更を破棄しますか？" : "エントリーを取り消しますか？"}
      description={confirm === "close" ? "保存していない変更は失われます。" : `${removed.join("・")}を取り消して保存します。変更前の内容は履歴に残ります。`}
      confirmLabel={confirm === "close" ? "破棄する" : "取り消して保存する"} busyLabel="保存中…" busy={saving}
      onConfirm={() => confirm === "close" ? onClose() : void save()} />
  </section></FormModal>;
}

function snapshotRows(value: unknown) {
  if (!value || typeof value !== "object" || !("events" in value) || !Array.isArray(value.events)) return [];
  const marks = "qualification_marks" in value && value.qualification_marks && typeof value.qualification_marks === "object" ? value.qualification_marks : {};
  return entryEventRows({ events: value.events.filter((v): v is string => typeof v === "string"), qualification_marks: Object.fromEntries(Object.entries(marks).filter(([, mark]) => mark === null || typeof mark === "string")) });
}

export function ObEntryHistory({ entry, members }: { entry: ObEntry; members: EntryMember[] }) {
  const [changes, setChanges] = useState<EntryChange[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();
  async function toggle() {
    if (open) { setOpen(false); return; }
    setLoading(true);
    try {
      const result = await getEntryChanges(entry.id);
      if (!result.ok) { showToast("履歴を取得できませんでした"); return; }
      setChanges(result.changes); setOpen(true);
    } catch { showToast("履歴を取得できませんでした"); }
    finally { setLoading(false); }
  }
  return <div className="mt-3"><Button size="sm" variant="ghost" disabled={loading} aria-expanded={open} onClick={() => void toggle()}>{loading ? "読み込み中…" : open ? "変更履歴を閉じる" : "変更履歴"}</Button>
    {open && <div className="mt-2 space-y-3"><p className="text-caption">最新20件。アプリでの編集開始後の変更を表示します。</p>
      {!changes?.length && <p className="text-caption">まだ変更履歴はありません。</p>}
      {changes?.map((change) => <div key={change.id} className="space-y-2 rounded-xl border border-separator p-3">
        <p className="text-caption">{new Date(change.changed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} ／ {members.find((m) => m.id === change.actor_id)?.display_name ?? "取込・在籍名簿外"}</p>
        {[{ label: "変更前", value: change.before_data }, { label: "変更後", value: change.after_data }].map(({ label, value }) => <div key={label}>
          <p className="text-headline">{label}</p>{snapshotRows(value).length ? snapshotRows(value).map(({ event, mark }) => <p key={event} className="text-body whitespace-pre-wrap break-words">{event}：{mark}</p>) : <p className="text-body">出場種目なし</p>}
        </div>)}
      </div>)}
    </div>}
  </div>;
}
