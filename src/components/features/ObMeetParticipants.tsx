"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented";
import { ActionMenu } from "@/components/ui/action-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModal } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { ObEntryEditor } from "./ObEntryEditor";
import { ObPartyView } from "./ObPartyView";
import { confirmEntryMember, deleteEntry } from "@/app/(app)/ob-entries/actions";
import { setObAttendance } from "@/app/(app)/ob-entries/operations-actions";
import { entryEventRows, isAlumniEntry, type ObEntry } from "@/lib/ob-entries";
import { effectiveObParticipation, type ObEventOperation } from "@/lib/ob-operations";
import { dutyRoleText, type ObDuty, type ObDutyRole } from "@/lib/ob-duty";
import { compareByGrade, obEventTime, type ObPartyResponse } from "@/lib/ob-meet";
import { entryDivision } from "@/lib/ob-entry-edit";
import { entryGrade, matchEntryMember, normalizeEntryName, type ConfirmedEntryIdentity, type EntryMember } from "@/lib/entry-identity";

type Filter = "all" | "absent" | "identity";
const needsIdentity = (entry: ObEntry) => !isAlumniEntry(entry) && !entry.profile_id;

/** 人ごとの管理はこの1画面に集約する。種目ごとの組分け・DNS・記録は当日運営で行う。 */
export function ObMeetParticipants({ entries, members, history, party, duties, roles, operations, initialFilter = "all", footer }: {
  entries: ObEntry[]; members: EntryMember[]; history: ConfirmedEntryIdentity[]; party: ObPartyResponse[];
  duties: ObDuty[]; roles: ObDutyRole[]; operations: ObEventOperation[]; initialFilter?: Filter; footer?: ReactNode;
}) {
  const [view, setView] = useState<"entries" | "party">("entries");
  const [search, setSearch] = useState(""), [filter, setFilter] = useState<Filter>(initialFilter);
  const [targetId, setTargetId] = useState<string | null>(null), [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false), [updates, setUpdates] = useState<ObEntry[]>([]), [deleted, setDeleted] = useState<string[]>([]);
  const router = useRouter();
  const { showToast } = useToast();
  const roster = entries.filter(entry => !deleted.includes(entry.id)).map(entry => {
    const update = updates.find(value => value.id === entry.id);
    return update && update.revision > entry.revision ? update : entry;
  });
  const query = normalizeEntryName(search).toLowerCase();
  const visible = roster
    .filter(entry => (filter !== "absent" || entry.absent) && (filter !== "identity" || needsIdentity(entry))
      && normalizeEntryName([entry.submitted_name, entry.grade, ...entry.events].join(" ")).toLowerCase().includes(query))
    .sort((a, b) => compareByGrade({ grade: a.grade, name: a.submitted_name }, { grade: b.grade, name: b.submitted_name }));
  const target = roster.find(entry => entry.id === targetId), editing = roster.find(entry => entry.id === editingId);
  const newMembers = members.filter(member => !roster.some(entry => entry.profile_id === member.id || normalizeEntryName(entry.submitted_name) === normalizeEntryName(member.display_name)));
  const counts = { absent: roster.filter(entry => entry.absent).length, identity: roster.filter(needsIdentity).length };
  async function remove(entry: ObEntry) {
    try {
      const result = await deleteEntry({ entryId: entry.id, revision: entry.revision });
      if (!result.ok) { showToast(result.message ?? "削除できませんでした"); return false; }
      setDeleted(ids => [...ids, entry.id]); setTargetId(null); showToast("エントリーを削除しました", "success"); router.refresh(); return true;
    } catch { showToast("削除できませんでした。もう一度お試しください"); return false; }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">参加者</h2>
        <p className="text-caption">{roster.length}人 · 大会欠席 {counts.absent}人 · 本人未確認 {counts.identity}人</p>
      </div>
      <Button onClick={() => setAdding(true)}>参加者を登録</Button>
    </div>
    {footer}
    <SegmentedControl items={[{ key: "entries", label: "エントリー" }, { key: "party", label: "懇親会" }]} value={view} onChange={setView} />
    {view === "party" ? <ObPartyView responses={party} /> : <>
      <Input aria-label="参加者の氏名・学年・種目で検索" placeholder="氏名・学年・種目で検索" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="flex flex-wrap gap-2" aria-label="参加者の絞り込み">
        {([["all", "すべて"], ["absent", `大会欠席 ${counts.absent}`], ["identity", `本人未確認 ${counts.identity}`]] as const).map(([key, label]) =>
          <Button key={key} size="sm" variant={filter === key ? "primary" : "outline"} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</Button>)}
      </div>
      <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">{visible.map(entry =>
        <button key={entry.id} type="button" onClick={() => setTargetId(entry.id)} className="flex min-h-16 items-center gap-3 rounded-xl border border-separator bg-card p-3.5 text-left pressable">
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold">{entry.submitted_name}<span className="ml-2 text-caption">{entry.grade}</span></p>
            <p className="mt-1 break-words text-caption">{entry.events.join("・") || "競技の出場登録なし"}</p>
          </div>
          {(entry.absent || needsIdentity(entry)) && <span className="flex shrink-0 flex-col items-end gap-1">
            {entry.absent && <span className="rounded-full bg-bg px-2.5 py-0.5 text-caption">大会欠席</span>}
            {needsIdentity(entry) && <span className="rounded-full bg-bg px-2.5 py-0.5 text-caption">本人未確認</span>}
          </span>}
          <ChevronRight size={16} className="shrink-0 text-muted" />
        </button>)}
      </div>
      {!visible.length && <p className="py-6 text-center text-caption">{filter === "identity" && !query ? "本人照合が必要な参加者はいません" : "該当する参加者はいません"}</p>}
      <p className="text-micro text-muted">変更はアプリ内だけに保存されます。Googleフォームの回答は変わりません。</p>
    </>}
    {target && <ParticipantDetail key={target.id} entry={target} members={members} history={history} party={party.find(value => value.entry_id === target.id)}
      duties={duties} roles={roles} operations={operations} onClose={() => setTargetId(null)} onDelete={() => remove(target)}
      onEdit={() => { setTargetId(null); setEditingId(target.id); }}
      onAttendance={saved => setUpdates(current => [...current.filter(entry => entry.id !== saved.id), saved])} />}
    {adding && <ObEntryEditor parties={party} members={newMembers} duties={duties} roles={roles} onClose={() => setAdding(false)} />}
    {editing && <ObEntryEditor key={`${editing.id}:${editing.revision}`} entry={editing} party={party.find(value => value.entry_id === editing.id)} members={members} duties={duties} roles={roles} onClose={() => setEditingId(null)} />}
  </div>;
}

function ParticipantDetail({ entry, members, history, party, duties, roles, operations, onClose, onEdit, onDelete, onAttendance }: {
  entry: ObEntry; members: EntryMember[]; history: ConfirmedEntryIdentity[]; party?: ObPartyResponse; duties: ObDuty[]; roles: ObDutyRole[];
  operations: ObEventOperation[]; onClose: () => void; onEdit: () => void; onDelete: () => Promise<boolean>; onAttendance: (saved: ObEntry) => void;
}) {
  const match = matchEntryMember(entry, members, history);
  const [selected, setSelected] = useState(entry.profile_id ?? (match.status === "exact" || match.status === "previous" ? match.candidates[0].id : ""));
  const [busy, setBusy] = useState<"identity" | "attendance" | null>(null), [confirmAbsent, setConfirmAbsent] = useState(false), [message, setMessage] = useState("");
  const saving = useRef(false), router = useRouter();
  const { showToast } = useToast();
  const division = entryDivision(entry), linked = members.find(member => member.id === entry.profile_id);
  const affected = duties.filter(duty => duty.profile_id === (entry.profile_id ?? entry.id) && dutyRoleText(duty, roles));
  const identity = entry.profile_id ? "本人確認済み" : match.status === "previous" ? "過去に確認した部員（再確認）" : match.status === "exact" ? "氏名・学年が一致（未確認）" : match.status === "grade_check" ? "氏名が一致・学年の確認が必要" : match.status === "ambiguous" ? "同名の候補が複数あります" : "一致する表示名がありません";
  async function run(kind: "identity" | "attendance", action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true; setBusy(kind); setMessage("");
    try { await action(); }
    catch { setMessage("通信できませんでした。接続を確認して再度保存してください"); }
    finally { saving.current = false; setBusy(null); }
  }
  const saveIdentity = () => run("identity", async () => {
    const result = await confirmEntryMember(entry.id, selected || null, entry.revision);
    if (!result.ok) { setMessage(result.message ?? "保存できませんでした"); return; }
    showToast(selected ? "本人との紐付けを保存しました" : "紐付けを解除しました", "success"); router.refresh();
  });
  const saveAttendance = () => run("attendance", async () => {
    const result = await setObAttendance({ entryId: entry.id, revision: entry.revision, absent: !entry.absent });
    setConfirmAbsent(false);
    if (!result.ok || result.revision === undefined) { setMessage(result.message ?? "保存できませんでした"); return; }
    onAttendance({ ...entry, revision: result.revision, absent: !entry.absent });
    showToast(entry.absent ? "大会欠席を取り消しました" : "大会欠席にしました", "success"); router.refresh();
  });
  return <FormModal open title={entry.submitted_name} autoFocus={false} onOpenChange={open => !open && !busy && onClose()}>
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body">{entry.grade}{division ? ` · ${division}` : ""}</p>
        <ActionMenu triggerLabel={`${entry.submitted_name}のエントリー操作`} onEdit={onEdit} editLabel="エントリーを編集" onDelete={onDelete}
          deleteTitle={`${entry.submitted_name}のエントリーを削除しますか？`} deleteDescription="競技のエントリーを削除します。懇親会の回答と変更履歴は残ります。補助担当や組み分け・競技記録がある場合は削除できません。" />
      </div>
      {entry.absent && <p className="rounded-lg bg-bg p-3 text-body">大会欠席として登録されています</p>}
      <section className="space-y-1">
        <h3 className="text-headline">出場種目・資格記録</h3>
        {entry.events.length ? <ul className="divide-y divide-separator">{entryEventRows(entry).map(({ event, mark }) => {
          const performance = operations.find(operation => operation.event_name === event)?.data.participants.find(person => person.entryId === entry.id);
          const state = effectiveObParticipation(event, entry, performance);
          return <li key={event} className="flex items-baseline gap-3 py-2 text-body">
            <span className="w-12 shrink-0 text-caption tabular-nums">{obEventTime(event) ?? ""}</span>
            <span className="min-w-0 flex-1 break-words">{event}{!["entered", "absent"].includes(state.status) && <span className="ml-2 text-caption">{state.label}</span>}</span>
            <span className="max-w-[45%] whitespace-pre-wrap break-words text-right tabular-nums">{mark}</span>
          </li>;
        })}</ul> : <p className="py-2 text-body text-muted">競技の出場登録なし</p>}
      </section>
      <section className="flex items-baseline justify-between gap-3">
        <h3 className="text-headline">懇親会</h3><span className="text-body">{party ? party.needs_review ? `確認待ち（${party.status}）` : party.status : "未回答"}</span>
      </section>
      {affected.length > 0 && <section className="space-y-1">
        <h3 className="text-headline">補助担当 {affected.length}件</h3>
        <ul className="space-y-1">{affected.map(duty => <li key={duty.slot_time + duty.event_name} className="text-body">{duty.slot_time} {duty.event_name} · {dutyRoleText(duty, roles)}</li>)}</ul>
        {entry.absent && <p className="text-caption">欠席中は担当人数に数えません。補助員画面から交代してください。</p>}
      </section>}
      {!isAlumniEntry(entry) && <section className="space-y-2">
        <h3 className="text-headline">本人照合</h3>
        <p className="text-body">{identity}{linked ? `：${entryGrade(linked.grade)} ${linked.display_name}` : ""}</p>
        {entry.profile_id && !linked && <p className="text-caption">現在の紐付け先は在籍中の名簿にありません。必要に応じて解除してください。</p>}
        {!entry.profile_id && <p className="text-caption">フォームの氏名・学年と同じ本人のアカウントを選んでください。氏名の一致だけでは自動確定しません。{match.candidates.length > 0 && `候補：${match.candidates.map(member => `${entryGrade(member.grade)} ${member.display_name}`).join("、")}`}</p>}
        <div className="flex flex-wrap gap-2">
          <Select className="min-w-0 flex-1 basis-48" value={selected} onValueChange={setSelected} ariaLabel={`${entry.submitted_name}のアプリ上の部員`} disabled={busy !== null}
            options={[{ value: "", label: "紐付けなし" }, ...members.map(member => ({ value: member.id, label: `${entryGrade(member.grade)} ${member.display_name}` }))]} />
          <Button variant="outline" disabled={busy !== null || (selected || null) === entry.profile_id} onClick={() => void saveIdentity()}>{busy === "identity" ? "保存中…" : !selected && entry.profile_id ? "紐付けを解除" : "紐付ける"}</Button>
        </div>
      </section>}
      <section className="space-y-2">
        <h3 className="text-headline">大会の出欠</h3>
        <p className="text-caption">{entry.absent ? "取り消すと出場予定に戻ります。種目別に設定したDNSは、当日運営のその種目で戻してください。" : "1種目だけ欠場する場合は、当日運営の種目画面でDNSにしてください。"}</p>
        <Button variant="outline" disabled={busy !== null} onClick={() => entry.absent ? void saveAttendance() : setConfirmAbsent(true)}>{busy === "attendance" ? "保存中…" : entry.absent ? "大会欠席を取り消す" : "大会全体を欠席にする"}</Button>
      </section>
      {message && <div className="space-y-2">
        <p role="alert" className="text-body text-danger">{message}</p>
        <Button variant="outline" disabled={busy !== null} onClick={() => { setMessage(""); router.refresh(); }}>最新の情報を読み込む</Button>
      </div>}
    </div>
    <ConfirmDialog open={confirmAbsent} onOpenChange={open => { if (!open && !busy) setConfirmAbsent(false); }} title={`${entry.submitted_name}を大会欠席にしますか？`}
      description={`登録種目・組番号・記録は保持します。${affected.length ? `補助担当${affected.length}件は人数に数えず、補助員画面から交代できます。` : ""}`}
      confirmLabel="欠席にする" busyLabel="保存中…" busy={busy === "attendance"} onConfirm={() => void saveAttendance()} />
  </FormModal>;
}
