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
import { ObEntryEditor, ObEntryHistory } from "./ObEntryEditor";

export function ObEntryReview({ initial, members, viewerId, history = [] }: { initial: ObEntry[]; members: EntryMember[]; viewerId: string; history?: ConfirmedEntryIdentity[] }) {
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(true);
  const [unlinked, setUnlinked] = useState(false);
  const [adding, setAdding] = useState(false);
  const query = normalizeEntryName(search).toLowerCase();
  const visible = initial.filter((e) => (!mine || e.profile_id === viewerId) && (mine || !unlinked || !e.profile_id) &&
    normalizeEntryName([e.submitted_name, e.grade, ...e.events].join(" ")).toLowerCase().includes(query));
  return <div className="space-y-3 px-4 pb-8 pt-2">
    <Card className="space-y-2 p-4">
      <p className="text-headline">システムロール限定で確認中</p>
      <p className="text-caption">フォームの回答にアプリでの変更を反映しています。一般部員にはまだ公開していません。</p>
      <p className="text-caption">出場 {initial.filter((e) => e.events.length).length}人・延べ{initial.reduce((sum, e) => sum + e.events.length, 0)}種目 ／ 取り消し済み {initial.filter((e) => !e.events.length).length}人</p>
      <p className="text-micro text-muted">Googleフォームへの書き戻しは行いません。取り消した回答も履歴とともに保持します。</p>
    </Card>
    <Input aria-label="氏名・種目・学年で検索" placeholder="氏名・種目・学年で検索" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={mine ? "primary" : "outline"} aria-pressed={mine} onClick={() => { setMine(true); setSearch(""); }}>自分のエントリー</Button>
      <Button size="sm" variant={!mine ? "primary" : "outline"} aria-pressed={!mine} onClick={() => { setMine(false); setSearch(""); }}>全員・本人照合</Button>
      {!mine && <Button size="sm" variant={unlinked ? "primary" : "outline"} aria-pressed={unlinked} onClick={() => setUnlinked(!unlinked)}>未確認のみ</Button>}
    </div>
    {!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>追加エントリー</Button>}
    {adding && <Card className="p-4"><ObEntryEditor members={members.filter((m) => !initial.some((e) => e.profile_id === m.id))} initialProfileId={mine && !initial.some((e) => e.profile_id === viewerId) ? viewerId : ""} onClose={() => setAdding(false)} /></Card>}
    <p className="text-caption">資格記録は申告内容です。未回答と、元フォームに記録欄がない種目は区別して表示します。</p>
    {mine && <p className="text-caption">確認済みの部員IDで自分の回答を表示しています。</p>}
    <p className="section-label">{visible.length}人</p>
    {visible.length === 0 ? <Card><EmptyState title={mine && !search ? "自分に紐付いたエントリーはありません" : "条件に合うエントリーはありません"} />
      {mine && !search && <p className="px-4 pb-4 text-caption">「全員・本人照合」から自分の回答を探し、部員との紐付けを確認してください。</p>}</Card> : visible.map((entry) =>
      <EntryCard key={`${entry.id}:${entry.revision}`} entry={entry} members={members} history={history} />)}
  </div>;
}

function EntryCard({ entry, members, history }: { entry: ObEntry; members: EntryMember[]; history: ConfirmedEntryIdentity[] }) {
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
  return <Card className="p-4">
    <p className="text-headline">{entry.grade} {entry.submitted_name}</p>
    {!entry.events.length && <p className="mt-2 text-body">エントリー取り消し済み</p>}
    <table className="mt-3 w-full table-fixed text-left text-body">
      <caption className="sr-only">{entry.submitted_name}の出場種目と資格記録</caption>
      <thead><tr className="border-b border-separator"><th scope="col" className="w-1/2 py-2 pr-2 font-medium">出場種目</th><th scope="col" className="py-2 font-medium">資格記録</th></tr></thead>
      <tbody>{entryEventRows(entry).map(({ event, mark }) => <tr key={event} className="border-b border-separator last:border-0">
        <th scope="row" className="break-words py-2 pr-2 align-top font-normal">{event}</th><td className="whitespace-pre-wrap break-words py-2 align-top">{mark}</td>
      </tr>)}</tbody>
    </table>
    {!editing && <Button className="mt-3" size="sm" variant="outline" onClick={() => setEditing(true)}>{entry.events.length ? "種目・資格記録を編集する" : "再エントリーする"}</Button>}
    {editing && <ObEntryEditor entry={entry} members={members} onClose={() => setEditing(false)} />}
    <ObEntryHistory entry={entry} members={members} />
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-3 flex w-full items-center justify-between gap-2 text-left text-caption text-accent">
      <span>{status}{linked ? `：${linked.display_name}` : ""}</span><ChevronDown size={16} className={open ? "rotate-180 shrink-0" : "shrink-0"} />
    </button>
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
