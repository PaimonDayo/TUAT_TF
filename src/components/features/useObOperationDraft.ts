"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveObEventOperation } from "@/app/(app)/ob-entries/operations-actions";
import { emptyPerformance, MeetEvent, type MeetEventData } from "@/lib/meet-operations";
import { effectiveObParticipation, obEventRule, reconcileObEvent, type ObEventOperation } from "@/lib/ob-operations";
import { reviewObOperation, type OperationChoices } from "@/lib/ob-operation-draft";
import type { ObEntry } from "@/lib/ob-entries";

export function useObOperationDraft(event: string, entries: ObEntry[], initial: ObEventOperation | undefined, onSaved: (saved: ObEventOperation) => void, prepare?: (data: MeetEventData) => MeetEventData) {
  const router = useRouter();
  const [base, setBase] = useState<MeetEventData>(initial?.data ?? { participants: [], confirmed: false });
  const [draft, setDraft] = useState(() => {
    const value = reconcileObEvent(event, entries, initial?.data);
    return prepare && !initial ? prepare(value) : value;
  });
  const [revision, setRevision] = useState(initial?.revision ?? null);
  const [observedRevision, setObservedRevision] = useState(initial?.revision ?? -1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [latest, setLatest] = useState<ObEventOperation | null>(null);
  const [choices, setChoices] = useState<OperationChoices>({});
  const saving = useRef(false);
  const data = reconcileObEvent(event, entries, draft);
  const dirty = JSON.stringify(data) !== JSON.stringify(base);
  const review = latest ? reviewObOperation(base, data, latest.data, choices) : null;
  const blocked = data.participants.filter(person => {
    const entry = entries.find(e => e.id === person.entryId), before = base.participants.find(p => p.entryId === person.entryId) ?? emptyPerformance(person.entryId);
    const changed = JSON.stringify(person) !== JSON.stringify(before);
    if (entry?.absent) return JSON.stringify(person.trials) !== JSON.stringify(before.trials) || (person.status === "entered" && changed && JSON.stringify(person) !== JSON.stringify(emptyPerformance(person.entryId)));
    return !entry?.events.includes(event) && person.status === "entered" && changed;
  });

  // Refreshes can bring a new entrant or another operator's edit while this form is open.
  // Adopt only non-overlapping changes; keep overlapping input for explicit review.
  if (initial && initial.revision > observedRevision && !busy) {
    setObservedRevision(initial.revision);
    if (initial.revision > (revision ?? -1) && !latest) {
      const refreshed = reviewObOperation(base, data, initial.data);
      if (refreshed.conflicts.length) { setLatest(initial); setChoices({}); }
      else { setDraft(refreshed.data); setBase(initial.data); setRevision(initial.revision); }
    }
  }

  function change(next: MeetEventData) { setDraft(next); setMessage(""); }
  function discardPerson(id: string) {
    const before = base.participants.find(p => p.entryId === id) ?? emptyPerformance(id);
    setDraft({ ...data, participants: data.participants.map(p => p.entryId === id ? before : p) });
    setMessage("この人の未保存の変更を取り消しました。他の入力は残っています"); setFailed(false);
  }
  function applyReview() {
    if (!latest || !review || review.conflicts.some(c => !choices[c.key])) return;
    setDraft(review.data); setBase(latest.data); setRevision(latest.revision);
    setLatest(null); setChoices({}); setFailed(false);
    setMessage("確認した内容を反映しました。配置・記録を確認して保存してください");
  }
  async function save() {
    if (saving.current || latest) return;
    if (blocked.length) { setMessage("欠席・出場取消になった人の未保存の変更を確認してください"); setFailed(true); return; }
    const rule = obEventRule(event);
    const error = new MeetEvent(rule, { ...data, confirmed: false }).validate()
      ?? (data.confirmed ? new MeetEvent(rule, { ...data, participants: data.participants.filter(p => effectiveObParticipation(event, entries.find(e => e.id === p.entryId), p).canParticipate) }).validate() : null);
    if (error) { setMessage(error); setFailed(true); return; }
    saving.current = true; setBusy(true); setMessage("");
    try {
      const result = await saveObEventOperation({ event, revision, data, baseData: base });
      if (!result.ok || !result.saved) {
        setFailed(true); setMessage(result.message ?? "保存できませんでした。入力は残っています");
        if (result.latest) { setLatest(result.latest); setChoices({}); }
        router.refresh();
        return;
      }
      setRevision(result.saved.revision); setBase(result.saved.data); setDraft(result.saved.data);
      onSaved(result.saved); setFailed(false); setMessage("保存しました");
    } catch { setFailed(true); setMessage("通信できませんでした。入力は残っています。接続後にもう一度保存してください"); }
    finally { saving.current = false; setBusy(false); }
  }
  return { data, change, dirty, busy, message, failed, revision, save, review, choices, setChoices, applyReview, reviewing: latest !== null, blocked, discardPerson };
}
