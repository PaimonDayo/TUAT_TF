"use client";

import { FormModal, FormModalFooter, FormDraftGuard } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { MeetHeatBoard, type HeatEntrant } from "./MeetHeatBoard";
import { MeetFieldOrderBoard } from "./MeetFieldOrderBoard";
import { ObOperationConflict } from "./ObOperationConflict";
import { useObOperationDraft } from "./useObOperationDraft";
import { useObFamilyDraft } from "./useObFamilyDraft";
import { obEventParticipants, obEventRule, obHeatCapacity, type ObEventOperation } from "@/lib/ob-operations";
import { nextMixedGroup, obMixedGroupLabel, obMixedLimits } from "@/lib/ob-mixed-operations";
import type { MeetOperationLimits } from "@/lib/meet-operations";
import { isAlumniEntry, obAppearanceName, type ObEntry } from "@/lib/ob-entries";

type SharedProps = { entries: ObEntry[]; onClose: () => void; onAddEntry?: (event: string) => void };
type SingleProps = SharedProps & { event: string; initial?: ObEventOperation; onSaved: (saved: ObEventOperation) => void };
type FamilyProps = SharedProps & { family: string; initial: ObEventOperation[]; onSaved: (saved: ObEventOperation[]) => void };

export function ObHeatEditor(props: SingleProps | FamilyProps) {
  return "family" in props ? <ObFamilyHeatEditor {...props}/> : <ObSingleHeatEditor {...props}/>;
}

function ObSingleHeatEditor({ event, entries, initial, onSaved, onClose, onAddEntry }: SingleProps) {
  const draft = useObOperationDraft(event, entries, initial, onSaved);
  const division: HeatEntrant["division"] = event.startsWith("男子") ? "男子" : event.startsWith("女子") ? "女子" : undefined;
  const entrants = obEventParticipants(event, entries, draft.data).map(row => ({ id: row.entryId, name: obAppearanceName(row.entry, event, row.entryId), grade: row.entry?.grade ?? "", mark: row.entry?.qualification_marks[event] ?? "", alumni: !!row.entry && isAlumniEntry(row.entry), eligible: row.state.registered, absent: row.entry?.absent, division }));
  return <ObHeatEditorView event={event} entrants={entrants} draft={draft} entries={entries} onClose={onClose} onAddEntry={onAddEntry}/>;
}

function ObFamilyHeatEditor({ family, entries, initial, onSaved, onClose, onAddEntry }: FamilyProps) {
  const draft = useObFamilyDraft(family, entries, initial, onSaved);
  return <ObHeatEditorView event={family} entrants={draft.entrants} draft={draft} entries={draft.conflictEntries} onClose={onClose} onAddEntry={onAddEntry ? () => onAddEntry("") : undefined} groupLabel={obMixedGroupLabel} nextGroup={nextMixedGroup(draft.data.participants.flatMap(person => person.group === null ? [] : [person.group]))} groupLimit={297} modelLimits={obMixedLimits}/>;
}

function ObHeatEditorView({ event, entrants, draft, entries, onClose, onAddEntry, groupLabel, nextGroup, groupLimit, modelLimits }: {
  event: string; entrants: HeatEntrant[]; draft: ReturnType<typeof useObOperationDraft> | ReturnType<typeof useObFamilyDraft>; entries: ObEntry[]; onClose: () => void; onAddEntry?: (event: string) => void; groupLabel?: (group: number) => string; nextGroup?: number | null; groupLimit?: number; modelLimits?: MeetOperationLimits;
}) {
  const separate = /^(男子|女子)?(100m|300m|300mH)$/.test(event);
  const capacity = obHeatCapacity(`男子${event.replace(/^(男子|女子)/, "")}`);
  const field = obEventRule(event).discipline !== "track";
  const present = entrants.filter(e => e.eligible && !e.absent).length;
  return <FormModal open autoFocus={false} title={`${event} · ${field ? "試技順" : "組分け"}`} onOpenChange={open => !open && onClose()}>
    <FormDraftGuard dirty={draft.dirty} busy={draft.locked} onSave={draft.save}/>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body">出場登録 {present}件</p>{onAddEntry && <Button variant="outline" disabled={draft.locked || draft.reviewing} onClick={() => onAddEntry(event)}>出場者を追加</Button>}</div>
      <ObOperationConflict draft={draft} entries={entries} event={event} groupLabel={groupLabel}/>
      {field ? <MeetFieldOrderBoard statusActions={false} key={draft.revision ?? "new"} data={draft.data} entrants={entrants} disabled={draft.locked || draft.reviewing} onChange={draft.change} modelLimits={modelLimits}/>
        : <MeetHeatBoard statusActions={false} key={draft.revision ?? "new"} data={draft.data} entrants={entrants} orderLabel={separate ? "レーン" : "番号"} capacity={capacity} disabled={draft.locked || draft.reviewing} onChange={draft.change} groupLabel={groupLabel} nextGroup={nextGroup} groupLimit={groupLimit} modelLimits={modelLimits}/>}
      {draft.message && <p role={draft.failed ? "alert" : "status"} className={`text-body ${draft.failed ? "text-danger" : "text-accent"}`}>{draft.message}</p>}
    </div>
    <FormModalFooter><div className="flex items-center gap-3"><p className="min-w-0 flex-1 text-caption">{draft.unconfirmed ? "保存結果を確認してください" : draft.dirty ? "未保存の変更があります" : "変更はありません"}</p><Button className="min-w-32" disabled={draft.busy || draft.reviewing || !draft.dirty && !draft.unconfirmed} onClick={() => void draft.save()}>{draft.busy ? draft.unconfirmed ? "確認中…" : "保存中…" : draft.unconfirmed ? "保存結果を確認" : "保存する"}</Button></div></FormModalFooter>
  </FormModal>;
}
