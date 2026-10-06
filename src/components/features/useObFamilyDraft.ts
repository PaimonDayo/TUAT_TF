"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkObFamilyOperation, saveObFamilyOperation } from "@/app/(app)/ob-entries/operations-actions";
import { emptyPerformance, MeetEvent, type MeetEventData } from "@/lib/meet-operations";
import { obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import { projectObMixedEvent, splitObMixedEvent } from "@/lib/ob-mixed-operations";
import { obOperationHasChanges, reviewObOperation, type OperationChoices } from "@/lib/ob-operation-draft";
import type { ObEntry } from "@/lib/ob-entries";

const fingerprint = (operations: ObEventOperation[]) => operations.map(op => `${op.event_name}:${op.revision}`).sort().join("|");
const familyOperations = (family: string, operations: ObEventOperation[]) => {
  const latest = new Map<string, ObEventOperation>();
  for (const operation of operations) if ([`男子${family}`, `女子${family}`].includes(operation.event_name)
    && operation.revision > (latest.get(operation.event_name)?.revision ?? -1)) latest.set(operation.event_name, operation);
  return [...latest.values()];
};

/** A single projected draft keeps original registration events and saves both divisions atomically. */
export function useObFamilyDraft(family: string, entries: ObEntry[], initial: ObEventOperation[], onSaved: (saved: ObEventOperation[]) => void) {
  const router = useRouter();
  const [baseOperations, setBaseOperations] = useState(() => familyOperations(family, initial));
  const [draft, setDraft] = useState(() => projectObMixedEvent(family, entries, initial).data);
  const [observed, setObserved] = useState(fingerprint(familyOperations(family, initial)));
  const [busy, setBusy] = useState(false), [unconfirmed, setUnconfirmed] = useState(false);
  const [pendingData, setPendingData] = useState<MeetEventData | null>(null);
  const [message, setMessage] = useState(""), [failed, setFailed] = useState(false);
  const [latest, setLatest] = useState<ObEventOperation[] | null>(null);
  const [choices, setChoices] = useState<OperationChoices>({});
  const saving = useRef(false);
  const pendingSave = useRef<Parameters<typeof checkObFamilyOperation>[0] | null>(null);
  const projection = projectObMixedEvent(family, entries, baseOperations);
  const known = new Set(draft.participants.map(p => p.entryId));
  const data = pendingData ?? { ...draft, participants: [...draft.participants, ...projection.data.participants.filter(p => !known.has(p.entryId))] };
  // Confirmation belongs to each source record screen; this form only changes people and positions.
  const dirty = obOperationHasChanges({ ...projection.data, confirmed: false }, { ...data, confirmed: false });
  const latestData = latest ? projectObMixedEvent(family, entries, latest).data : undefined;
  const review = latestData ? reviewObOperation({ ...projection.data, confirmed: false }, { ...data, confirmed: false }, { ...latestData, confirmed: false }, choices) : null;
  const conflictEntries = [...projection.sourceById].flatMap(([id, source]) => {
    const entry = entries.find(e => e.id === source.entryId);
    return entry ? [{ ...entry, id, submitted_name: `${source.division} ${entry.submitted_name}` }] : [];
  });
  const blocked = data.participants.filter(person => {
    const source = projection.sourceById.get(person.entryId);
    const entry = entries.find(e => e.id === source?.entryId);
    const before = projection.data.participants.find(p => p.entryId === person.entryId) ?? emptyPerformance(person.entryId);
    const changed = JSON.stringify(person) !== JSON.stringify(before);
    if (entry?.absent) return JSON.stringify(person.trials) !== JSON.stringify(before.trials) || (person.status === "entered" && changed && JSON.stringify(person) !== JSON.stringify(emptyPerformance(person.entryId)));
    return !source || !entry?.events.includes(source.event) && person.status === "entered" && changed;
  });
  const incomingOperations = familyOperations(family, initial);
  const incoming = fingerprint(incomingOperations);
  if (incoming !== observed && !busy && !unconfirmed && !pendingData) {
    setObserved(incoming);
    if (!latest && incomingOperations.some(op => op.revision > (baseOperations.find(base => base.event_name === op.event_name)?.revision ?? -1))) {
      const nextOperations = familyOperations(family, [...baseOperations, ...incomingOperations]);
      const refreshed = projectObMixedEvent(family, entries, nextOperations).data;
      const reviewed = reviewObOperation({ ...projection.data, confirmed: false }, { ...data, confirmed: false }, { ...refreshed, confirmed: false });
      if (reviewed.conflicts.length) { setLatest(nextOperations); setChoices({}); }
      else { setDraft(reviewed.data); setBaseOperations(nextOperations); }
    }
  }
  function change(next: MeetEventData) { if (saving.current || pendingSave.current) return; setDraft(next); setMessage(""); }
  function discardPerson(id: string) {
    if (saving.current || pendingSave.current) return;
    const before = projection.data.participants.find(p => p.entryId === id) ?? emptyPerformance(id);
    setDraft({ ...data, participants: data.participants.map(p => p.entryId === id ? before : p) });
    setMessage("この人の未保存の変更を取り消しました。他の入力は残っています"); setFailed(false);
  }
  function applyReview() {
    if (saving.current || pendingSave.current || !latest || !review || review.conflicts.some(c => !choices[c.key])) return;
    setDraft(review.data); setBaseOperations(latest); setLatest(null); setChoices({}); setFailed(false);
    setMessage("確認した内容を反映しました。配置・記録を確認して保存してください");
  }
  async function save() {
    if (saving.current || latest || !pendingSave.current && !dirty) return;
    if (!pendingSave.current && blocked.length) { setMessage("欠席・出場取消になった人の未保存の変更を確認してください"); setFailed(true); return; }
    if (!pendingSave.current) {
      const error = new MeetEvent(obEventRule(`男子${family}`), { ...data, confirmed: false }, { maxParticipants: 600, maxGroups: 297, maxOrder: 600 }).validate();
      if (error) { setMessage(error); setFailed(true); return; }
    }
    saving.current = true; setBusy(true); setMessage("");
    try {
      let saved: ObEventOperation[] | undefined;
      if (!pendingSave.current) {
        pendingSave.current = structuredClone({ family, operations: splitObMixedEvent(projection, data) });
        setPendingData(data);
        try {
          const result = await saveObFamilyOperation(pendingSave.current);
          if (result.ok && result.saved) saved = result.saved;
          else if (!result.ok && !result.uncertain) {
            pendingSave.current = null; setPendingData(null); setFailed(true);
            setMessage(result.message ?? "保存できませんでした。入力は残っています");
            if (result.latest) { setLatest(result.latest); setChoices({}); }
            router.refresh(); return;
          }
        } catch { /* Both operations may have committed. Only read the frozen attempt next. */ }
      }
      if (!saved) {
        setUnconfirmed(true);
        const result = await checkObFamilyOperation(pendingSave.current!);
        if (!result.ok || !result.saved) { setFailed(true); setMessage(result.message ?? "保存結果を確認できませんでした。入力は残っています。もう一度結果を確認してください"); return; }
        saved = result.saved;
      }
      pendingSave.current = null; setPendingData(null); setUnconfirmed(false);
      setBaseOperations(saved); setDraft(projectObMixedEvent(family, entries, saved).data);
      onSaved(saved); setFailed(false); setMessage("保存しました");
    } catch {
      if (pendingSave.current) setUnconfirmed(true);
      setFailed(true); setMessage("保存結果を確認できませんでした。入力は残っています。接続後にもう一度結果を確認してください");
    } finally { saving.current = false; setBusy(false); }
  }
  return { data, change, dirty, busy, unconfirmed, locked: busy || unconfirmed, message, failed, revision: fingerprint(baseOperations), save, review, latestData, choices, setChoices, applyReview, reviewing: latest !== null, blocked, discardPerson, entrants: projection.entrants, conflictEntries };
}
