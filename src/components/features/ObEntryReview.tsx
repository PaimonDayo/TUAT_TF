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
import { entryGrade, matchEntryMember, normalizeEntryName, type ObEntry, type EntryMember } from "@/lib/ob-entries";

export function ObEntryReview({ initial, members, viewerId }: { initial: ObEntry[]; members: EntryMember[]; viewerId: string }) {
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [unlinked, setUnlinked] = useState(false);
  const query = normalizeEntryName(search).toLowerCase();
  const visible = initial.filter((e) => (!mine || e.profile_id === viewerId) && (!unlinked || !e.profile_id) &&
    normalizeEntryName([e.submitted_name, e.grade, ...e.events].join(" ")).toLowerCase().includes(query));
  return <div className="space-y-3 px-4 pb-8 pt-2">
    <Card className="space-y-2 p-4">
      <p className="text-headline">システムロール限定で確認中</p>
      <p className="text-caption">フォームの最新回答と確認済みの追記をまとめています。一般部員にはまだ公開していません。</p>
      <p className="text-caption">{initial.length}人・延べ{initial.reduce((sum, e) => sum + e.events.length, 0)}種目 ／ 本人確認済み {initial.filter((e) => e.profile_id).length}人</p>
      <p className="text-micro text-muted">氏名未入力の回答と、種目の回答がない人は含めていません。</p>
    </Card>
    <Input aria-label="氏名・種目・学年で検索" placeholder="氏名・種目・学年で検索" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={mine ? "primary" : "outline"} aria-pressed={mine} onClick={() => setMine(!mine)}>自分のみ</Button>
      <Button size="sm" variant={unlinked ? "primary" : "outline"} aria-pressed={unlinked} onClick={() => setUnlinked(!unlinked)}>未確認のみ</Button>
    </div>
    {mine && <p className="text-caption">「自分のみ」には、アプリの本人と紐付け済みのエントリーが表示されます。</p>}
    <p className="section-label">{visible.length}人</p>
    {visible.length === 0 ? <Card><EmptyState title="条件に合うエントリーはありません" /></Card> : visible.map((entry) =>
      <EntryCard key={`${entry.id}:${entry.revision}`} entry={entry} members={members} />)}
  </div>;
}

function EntryCard({ entry, members }: { entry: ObEntry; members: EntryMember[] }) {
  const [open, setOpen] = useState(false);
  const match = matchEntryMember(entry, members);
  const [selected, setSelected] = useState(entry.profile_id ?? (match.status === "exact" ? match.candidates[0].id : ""));
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();
  const linked = members.find((member) => member.id === entry.profile_id);
  const status = entry.profile_id ? "本人確認済み" : match.status === "exact" ? "氏名・学年一致（未確認）" : match.status === "grade_check" ? "氏名一致・学年の確認が必要" : match.status === "ambiguous" ? "同名の候補が複数あります" : "一致する表示名がありません";
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
    <p className="mt-1 break-words text-body">{entry.events.join("・")}</p>
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
