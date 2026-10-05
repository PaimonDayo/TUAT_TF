"use client";

import { FormModal, FormModalFooter, FormDraftGuard } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { MeetHeatBoard } from "./MeetHeatBoard";
import { ObOperationConflict } from "./ObOperationConflict";
import { useObOperationDraft } from "./useObOperationDraft";
import { obEventRule, obHeatCapacity, type ObEventOperation } from "@/lib/ob-operations";
import { isAlumniEntry, type ObEntry } from "@/lib/ob-entries";

export function ObHeatEditor({ event, entries, initial, onSaved, onClose, onAddEntry }: { event: string; entries: ObEntry[]; initial?: ObEventOperation; onSaved: (saved: ObEventOperation) => void; onClose: () => void; onAddEntry?: (event: string) => void }) {
  const separate = /^(男子|女子)(100m|300m|300mH)$/.test(event);
  const capacity = obHeatCapacity(event);
  const rule = obEventRule(event);
  const draft = useObOperationDraft(event, entries, initial, onSaved);
  const present = entries.filter(e => e.events.includes(event) && !e.absent).length;
  return <FormModal open wide="full" autoFocus={false} title={`${event} · 組分け`} onOpenChange={open => !open && onClose()}>
    <FormDraftGuard dirty={draft.dirty} busy={draft.locked} onSave={draft.save}/>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body">出場登録 {present}人</p>{onAddEntry && <Button variant="outline" disabled={draft.locked || draft.reviewing} onClick={() => onAddEntry(event)}>出場者を追加</Button>}</div>
      <ObOperationConflict draft={draft} entries={entries}/>
      <MeetHeatBoard key={draft.revision ?? "new"} data={draft.data} entrants={entries.map(e => ({ id: e.id, name: e.submitted_name, grade: e.grade, mark: e.qualification_marks[event] ?? "", alumni: isAlumniEntry(e), eligible: e.events.includes(event), absent: e.absent }))} orderLabel={separate ? "レーン" : rule.discipline === "track" ? "番号" : "試技順"} capacity={capacity} disabled={draft.locked || draft.reviewing} onChange={draft.change}/>
      {draft.message && <p role={draft.failed ? "alert" : "status"} className={`text-body ${draft.failed ? "text-danger" : "text-accent"}`}>{draft.message}</p>}
    </div>
    <FormModalFooter><div className="flex items-center gap-3"><p className="min-w-0 flex-1 text-caption">{draft.unconfirmed ? "保存結果を確認してください" : draft.dirty ? "未保存の変更があります" : "変更はありません"}</p><Button className="min-w-32" disabled={draft.busy || draft.reviewing || !draft.dirty && !draft.unconfirmed} onClick={() => void draft.save()}>{draft.busy ? draft.unconfirmed ? "確認中…" : "保存中…" : draft.unconfirmed ? "保存結果を確認" : "保存する"}</Button></div></FormModalFooter>
  </FormModal>;
}
