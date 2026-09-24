"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { confirmEntryMember } from "@/app/(app)/ob-entries/actions";
import { entryEventRows, isAlumniEntry, type ObEntry } from "@/lib/ob-entries";
import { entryGrade, matchEntryMember, normalizeEntryName, type EntryMember, type ConfirmedEntryIdentity } from "@/lib/entry-identity";
import { ObEntryEditor } from "./ObEntryEditor";
import { SegmentedControl } from "@/components/ui/segmented";
import { ActionMenu } from "@/components/ui/action-menu";
import { ObPartyView } from "./ObPartyView";
import type { ObDuty, ObDutyRole } from "@/lib/ob-duty";
import { ObDutyTable } from "./ObDutyTable";
import { OB_PROGRAM, type ObPartyResponse } from "@/lib/ob-meet";
import { OB_ENTRY_EVENTS, entryDivision } from "@/lib/ob-entry-edit";

export function ObEntryReview({ initial, members, viewerId, history = [], party = [], duties = [], dutyRoles = [] }: { initial: ObEntry[]; members: EntryMember[]; viewerId: string; party?: ObPartyResponse[]; duties?: ObDuty[]; dutyRoles?: ObDutyRole[]; history?: ConfirmedEntryIdentity[] }) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"events" | "mine" | "identity" | "party" | "duty">("events");
  const [unlinked, setUnlinked] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [division, setDivision] = useState("all");
  const editing = initial.find((entry) => entry.id === editingId);
  const query = normalizeEntryName(search).toLowerCase();
  const visible = initial.filter((e) => (view !== "mine" || e.profile_id === viewerId) && (view !== "identity" || !isAlumniEntry(e) && (!unlinked || !e.profile_id)) &&
    normalizeEntryName([e.submitted_name, e.grade, ...e.events].join(" ")).toLowerCase().includes(query));
  const eventNames = [...new Set(initial.flatMap((entry) => entry.events))].sort((a, b) => OB_ENTRY_EVENTS.indexOf(a) - OB_ENTRY_EVENTS.indexOf(b));
  const groups = eventNames.filter((event) => division === "all" || event.startsWith(division)).map((event) => ({ event, entries: visible.filter((entry) => entry.events.includes(event) && normalizeEntryName([entry.submitted_name, entry.grade, event].join(" ")).toLowerCase().includes(query)) })).filter((group) => group.entries.length);
  return <div data-ob-workspace className="space-y-4 px-4 pb-8 pt-2">
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-headline">OB戦エントリー</h2><p className="mt-1 text-caption">{initial.filter((e) => e.events.length).length}人・{initial.reduce((sum, e) => sum + e.events.length, 0)}エントリー</p></div><Button size="sm" variant="outline" onClick={() => setAdding(true)}>新規登録</Button></div>
      <p className="mt-2 text-micro text-muted2">現役・OB・OGの出場登録／システムロール限定</p>
    </Card>
    <SegmentedControl items={[{key:"events",label:"予定"},{key:"mine",label:"回答"},{key:"party",label:"懇親会"},{key:"duty",label:"補助員"}]} value={view === "identity" ? "mine" : view} onChange={(value) => {setView(value);setSearch("");}} />
    {(view === "mine" || view === "identity") && <SegmentedControl items={[{key:"mine",label:"自分の回答"},{key:"identity",label:"本人照合"}]} value={view} onChange={(value)=>{setView(value);setSearch("");}} />}
    {(view === "events" || view === "identity") && <Input aria-label="氏名・種目・学年で検索" placeholder="氏名・種目・学年で検索" value={search} onChange={(event) => setSearch(event.target.value)} />}
    {view === "events" && <SegmentedControl items={[{key:"all",label:"すべて"},{key:"男子",label:"男子"},{key:"女子",label:"女子"}]} value={division} onChange={setDivision} />}
    {view === "identity" && <Button size="sm" variant={unlinked ? "primary" : "outline"} aria-pressed={unlinked} onClick={() => setUnlinked(!unlinked)}>未確認のみ</Button>}
    {adding && <ObEntryEditor parties={party} members={members.filter((m) => !initial.some((e) => e.profile_id === m.id))} initialProfileId={view === "mine" && !initial.some((e) => e.profile_id === viewerId) ? viewerId : ""} onClose={() => setAdding(false)} />}
    {editing && <ObEntryEditor key={`${editing.id}:${editing.revision}`} entry={editing} party={party.find((p)=>p.entry_id===editing.id)} members={members} onClose={() => setEditingId(null)} />}
    {view === "party" ? <ObPartyView responses={party} /> : view === "duty" ? <ObDutyTable entries={initial} members={members} duties={duties} roles={dutyRoles} /> : view === "events" ? <div className="space-y-3">
      <p className="text-caption">プログラム（予定）・競技を開くと出場者と資格記録が見られます。</p>
      {OB_PROGRAM.map((slot) => {
        const rows=groups.filter(({event})=>slot.events.includes(event.slice(2)));
        if (query && !rows.length) return null;
        return <section key={slot.time} className="space-y-2"><h2 className="text-caption font-semibold text-muted2"><span className="tabular-nums">{slot.time}</span>　{slot.label}</h2>
          {slot.events.length ? <Card className="divide-y divide-separator">{rows.length ? rows.map(({event,entries})=><EntryProgramRow key={`${event}:${query}`} event={event} entries={entries} viewerId={viewerId} searching={!!query} onEdit={setEditingId} />) : <p className="p-3.5 text-caption">該当する出場登録はありません</p>}</Card> : slot.note ? <Card className="p-3.5 text-body">{slot.note}</Card> : null}
        </section>;
      })}
      {query && !groups.length && <EmptyState title="条件に合うエントリーはありません" />}
    </div> : visible.length === 0 ? <Card><EmptyState title={view === "mine" ? "自分に紐付いたエントリーはありません" : "条件に合うエントリーはありません"} />
      {view === "mine" && <p className="px-4 pb-4 text-caption">「本人照合」から自分の回答を確認できます。</p>}</Card> : visible.map((entry) =>
      <EntryCard key={`${entry.id}:${entry.revision}:${view}`} entry={entry} members={members} history={history} party={party.find((p)=>p.entry_id===entry.id)} identity={view === "identity"} />)}
    <p className="text-micro text-muted">変更はアプリ内のみ。Googleフォームには反映されません。</p>
  </div>;
}

function EntryProgramRow({ event, entries, viewerId, searching, onEdit }: { event: string; entries: ObEntry[]; viewerId: string; searching: boolean; onEdit: (id: string) => void }) {
  const [open, setOpen] = useState(searching);
  const expanded = open;
  return <div className="p-3.5">
    <button type="button" aria-expanded={expanded} onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left pressable">
      <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-2"><span className="text-headline">{event}</span><span className="shrink-0 text-caption">{entries.length}人</span></span>
        {!expanded && <span className="mt-1 block truncate text-caption">{entries.map((e) => `${e.grade} ${e.submitted_name}`).join("・")}</span>}
      </span><ChevronDown size={16} className={`mt-1 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
    {expanded && <div className="mt-2 space-y-1.5">
      <p className="px-2.5 text-micro text-muted2">出場者・資格記録</p>
      {entries.map((entry) => <div key={entry.id} className="flex items-start gap-1 rounded-lg bg-bg px-2.5 py-2 text-[13px]">
        <div className="min-w-0 flex-1"><div className="grid grid-cols-2 items-baseline gap-2">
          <p className="break-words"><span className="mr-1 text-muted2">{entry.grade}</span>{entry.submitted_name}{entry.profile_id === viewerId && <span className="ml-1 text-micro text-accent">自分</span>}</p>
          <p className="whitespace-pre-wrap break-words text-right font-semibold tabular-nums">{entryEventRows(entry).find((row) => row.event === event)?.mark}</p>
        </div></div>
        <ActionMenu onEdit={() => onEdit(entry.id)} editLabel="種目・資格記録を編集" triggerLabel={`${entry.submitted_name}の${event}の操作`} />
      </div>)}
    </div>}
  </div>;
}

function EntryCard({ entry, members, history, identity, party }: { party?: ObPartyResponse; entry: ObEntry; members: EntryMember[]; history: ConfirmedEntryIdentity[]; identity: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const match = matchEntryMember(entry, members, history);
  const [selected, setSelected] = useState(entry.profile_id ?? (match.status === "exact" || match.status === "previous" ? match.candidates[0].id : ""));
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();
  const linked = members.find((member) => member.id === entry.profile_id);
  const status = entry.profile_id ? "本人確認済み" : match.status === "previous" ? "過去に確認した部員（再確認）" : match.status === "exact" ? "氏名・学年一致（未確認）" : match.status === "grade_check" ? "氏名一致・学年の確認が必要" : match.status === "ambiguous" ? "同名の候補が複数あります" : "一致する表示名がありません";
  async function save() {
    setSaving(true);
    try {
      const result = await confirmEntryMember(entry.id, selected || null, entry.revision);
      if (!result.ok) { showToast(result.message ?? "保存できませんでした"); return; }
      showToast(selected ? "本人との紐付けを保存しました" : "紐付けを解除しました", "success");
      router.refresh();
    } catch { showToast("保存できませんでした"); }
    finally { setSaving(false); }
  }
  return <Card className="p-3">
    <div className="flex items-center justify-between gap-2"><p className="text-headline"><span className="mr-2 text-caption">{entry.grade}</span>{entry.submitted_name}</p>
    <ActionMenu onEdit={() => setEditing(true)} editLabel={entry.events.length ? "エントリーを編集" : "再エントリー"} triggerLabel={`${entry.submitted_name}の操作`} /></div>
    <p className="mt-1 text-caption">出場区分：{entryDivision(entry) ?? "未登録"}</p>
    {!entry.events.length && <p className="mt-2 text-body">競技の出場登録なし</p>}
    {!identity && <p className="mt-2 text-body">懇親会：{party?.status ?? "未回答"}</p>}
    {!identity && <table className="mt-2 w-full table-fixed text-left text-body">
      <caption className="sr-only">{entry.submitted_name}の出場種目と資格記録</caption>
      <thead><tr className="border-b border-separator"><th scope="col" className="w-1/2 py-2 pr-2 font-medium">出場種目</th><th scope="col" className="py-2 font-medium">資格記録</th></tr></thead>
      <tbody>{entryEventRows(entry).map(({ event, mark }) => <tr key={event} className="border-b border-separator last:border-0">
        <th scope="row" className="break-words py-2 pr-2 align-top font-normal">{event}</th><td className="whitespace-pre-wrap break-words py-2 align-top">{mark}</td>
      </tr>)}</tbody>
    </table>}
    {editing && <ObEntryEditor entry={entry} party={party} members={members} onClose={() => setEditing(false)} />}
    {identity && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 flex min-h-9 w-full items-center justify-between gap-2 text-left text-caption text-accent">
      <span>{status}{linked ? `：${linked.display_name}` : ""}</span><ChevronDown size={16} className={open ? "rotate-180 shrink-0" : "shrink-0"} />
    </button>}
    {open && <div className="mt-3 space-y-3 border-t border-separator pt-3">
      <p className="text-caption">氏名・学年・出場区分を確認して、同じ本人のアカウントを選んでください。氏名の一致だけでは自動確定しません。</p>
      {match.candidates.length > 0 && <p className="text-caption">候補：{match.candidates.map((m) => `${entryGrade(m.grade)} ${m.display_name}`).join("、")}</p>}
      {entry.profile_id && !linked && <p className="text-caption">現在の紐付け先は在籍中の名簿にありません。必要に応じて解除してください。</p>}
      <Select value={selected} onValueChange={setSelected} ariaLabel={`${entry.submitted_name}のアプリ上の部員`} disabled={saving}
        options={[{ value: "", label: "紐付けなし" }, ...members.map((m) => ({ value: m.id, label: `${entryGrade(m.grade)} ${m.display_name}` }))]} />
      <Button size="sm" disabled={saving || (selected || null) === entry.profile_id} onClick={() => void save()}>{saving ? "保存中…" : selected ? "確認して紐付ける" : "紐付けを解除する"}</Button>
    </div>}
  </Card>;
}
