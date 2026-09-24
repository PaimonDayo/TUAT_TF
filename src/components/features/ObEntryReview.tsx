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
import { entryEventRows, type ObEntry } from "@/lib/ob-entries";
import { entryGrade, matchEntryMember, normalizeEntryName, type EntryMember, type ConfirmedEntryIdentity } from "@/lib/entry-identity";
import { ObEntryEditor } from "./ObEntryEditor";
import { OB_ENTRY_EVENTS } from "@/lib/ob-entry-edit";

export function ObEntryReview({ initial, members, viewerId, history = [] }: { initial: ObEntry[]; members: EntryMember[]; viewerId: string; history?: ConfirmedEntryIdentity[] }) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"events" | "mine" | "identity">("events");
  const [unlinked, setUnlinked] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState("");
  const editing = initial.find((entry) => entry.id === editingId);
  const query = normalizeEntryName(search).toLowerCase();
  const visible = initial.filter((e) => (view !== "mine" || e.profile_id === viewerId) && (view !== "identity" || !unlinked || !e.profile_id) &&
    normalizeEntryName([e.submitted_name, e.grade, ...e.events].join(" ")).toLowerCase().includes(query));
  const eventNames = [...new Set(initial.flatMap((entry) => entry.events))].sort((a, b) => OB_ENTRY_EVENTS.indexOf(a) - OB_ENTRY_EVENTS.indexOf(b));
  const groups = eventNames.filter((event) => !eventFilter || event === eventFilter).map((event) => ({ event, entries: visible.filter((entry) => entry.events.includes(event) && normalizeEntryName([entry.submitted_name, entry.grade, event].join(" ")).toLowerCase().includes(query)) })).filter((group) => group.entries.length);
  return <div className="space-y-3 px-4 pb-8 pt-2">
    <div className="flex items-center justify-between gap-2"><div><p className="text-headline">{initial.filter((e) => e.events.length).length}人・{initial.reduce((sum, e) => sum + e.events.length, 0)}エントリー</p><p className="text-caption">システムロール限定</p></div><Button size="sm" onClick={() => setAdding(true)}>＋ 追加</Button></div>
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-bg p-1">
      {([{ key: "events", label: "種目別" }, { key: "mine", label: "自分" }, { key: "identity", label: "本人照合" }] as const).map(({ key, label }) => <Button key={key} size="sm" variant={view === key ? "primary" : "ghost"} aria-pressed={view === key} onClick={() => { setView(key); setSearch(""); }}>{label}</Button>)}
    </div>
    {view !== "mine" && <Input aria-label="氏名・種目・学年で検索" placeholder="氏名・種目・学年で検索" value={search} onChange={(event) => setSearch(event.target.value)} />}
    {view === "events" && <Select value={eventFilter} onValueChange={setEventFilter} ariaLabel="表示する種目" options={[{ value: "", label: "すべての種目" }, ...eventNames.map((event) => ({ value: event, label: `${event}（${initial.filter((e) => e.events.includes(event)).length}人）` }))]} />}
    {view === "identity" && <Button size="sm" variant={unlinked ? "primary" : "outline"} aria-pressed={unlinked} onClick={() => setUnlinked(!unlinked)}>未確認のみ</Button>}
    {adding && <ObEntryEditor members={members.filter((m) => !initial.some((e) => e.profile_id === m.id))} initialProfileId={view === "mine" && !initial.some((e) => e.profile_id === viewerId) ? viewerId : ""} onClose={() => setAdding(false)} />}
    {editing && <ObEntryEditor key={`${editing.id}:${editing.revision}`} entry={editing} members={members} onClose={() => setEditingId(null)} />}
    {view === "events" ? groups.length ? groups.map(({ event, entries }) => <Card key={event} className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-separator bg-bg px-3 py-2"><h2 className="text-headline">{event}</h2><span className="shrink-0 text-caption">{entries.length}人</span></div>
      <table className="w-full table-fixed text-left text-[13px]"><caption className="sr-only">{event}のエントリー一覧</caption>
        <thead><tr className="text-muted2"><th scope="col" className="px-3 py-2 font-normal">氏名・学年</th><th scope="col" className="py-2 font-normal">資格記録</th><th scope="col" className="w-12"><span className="sr-only">編集</span></th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className={`border-t border-separator ${entry.profile_id === viewerId ? "bg-accent/5" : ""}`}>
          <th scope="row" className="break-words px-3 py-2 font-medium"><span className="block text-[11px] font-normal text-muted2">{entry.grade}{entry.profile_id === viewerId ? "・自分" : ""}</span>{entry.submitted_name}</th>
          <td className="whitespace-pre-wrap break-words py-2 pr-1">{entryEventRows(entry).find((row) => row.event === event)?.mark}</td>
          <td><button type="button" className="min-h-11 w-full text-accent" aria-label={`${entry.submitted_name}の${event}を編集`} onClick={() => setEditingId(entry.id)}>編集</button></td>
        </tr>)}</tbody>
      </table>
    </Card>) : <EmptyState title="条件に合うエントリーはありません" /> : visible.length === 0 ? <Card><EmptyState title={view === "mine" ? "自分に紐付いたエントリーはありません" : "条件に合うエントリーはありません"} />
      {view === "mine" && <p className="px-4 pb-4 text-caption">「本人照合」から自分の回答を確認できます。</p>}</Card> : visible.map((entry) =>
      <EntryCard key={`${entry.id}:${entry.revision}:${view}`} entry={entry} members={members} history={history} identity={view === "identity"} />)}
    <p className="text-micro text-muted">変更はアプリ内のみ。Googleフォームには反映されません。</p>
  </div>;
}

function EntryCard({ entry, members, history, identity }: { entry: ObEntry; members: EntryMember[]; history: ConfirmedEntryIdentity[]; identity: boolean }) {
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
    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{entry.events.length ? "編集" : "再エントリー"}</Button></div>
    {!entry.events.length && <p className="mt-2 text-body">エントリー取り消し済み</p>}
    {!identity && <table className="mt-2 w-full table-fixed text-left text-body">
      <caption className="sr-only">{entry.submitted_name}の出場種目と資格記録</caption>
      <thead><tr className="border-b border-separator"><th scope="col" className="w-1/2 py-2 pr-2 font-medium">出場種目</th><th scope="col" className="py-2 font-medium">資格記録</th></tr></thead>
      <tbody>{entryEventRows(entry).map(({ event, mark }) => <tr key={event} className="border-b border-separator last:border-0">
        <th scope="row" className="break-words py-2 pr-2 align-top font-normal">{event}</th><td className="whitespace-pre-wrap break-words py-2 align-top">{mark}</td>
      </tr>)}</tbody>
    </table>}
    {editing && <ObEntryEditor entry={entry} members={members} onClose={() => setEditing(false)} />}
    {identity && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 flex min-h-9 w-full items-center justify-between gap-2 text-left text-caption text-accent">
      <span>{status}{linked ? `：${linked.display_name}` : ""}</span><ChevronDown size={16} className={open ? "rotate-180 shrink-0" : "shrink-0"} />
    </button>}
    {open && <div className="mt-3 space-y-3 border-t border-separator pt-3">
      <p className="text-caption">氏名と学年を確認して、アプリの部員を選んでください。候補の一致だけでは本人を確定しません。</p>
      {match.candidates.length > 0 && <p className="text-caption">候補：{match.candidates.map((m) => `${entryGrade(m.grade)} ${m.display_name}`).join("、")}</p>}
      {entry.profile_id && !linked && <p className="text-caption">現在の紐付け先は在籍中の名簿にありません。必要に応じて解除してください。</p>}
      <Select value={selected} onValueChange={setSelected} ariaLabel={`${entry.submitted_name}のアプリ上の部員`} disabled={saving}
        options={[{ value: "", label: "紐付けなし" }, ...members.map((m) => ({ value: m.id, label: `${entryGrade(m.grade)} ${m.display_name}` }))]} />
      <Button size="sm" disabled={saving || (selected || null) === entry.profile_id} onClick={() => void save()}>{saving ? "保存中…" : selected ? "確認して紐付ける" : "紐付けを解除する"}</Button>
    </div>}
  </Card>;
}
