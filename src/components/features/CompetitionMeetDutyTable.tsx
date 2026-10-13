"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormModal } from "@/components/ui/form-modal";
import { ActionMenu } from "@/components/ui/action-menu";
import { meetAppearancePositionLabel, meetDutyText, type CompetitionMeet } from "@/lib/competition-meet";
import { meetDutySlots, meetDutyCell, validRolePeople, type MeetDutySlot } from "@/lib/competition-meet-duties";
import { GRADE_OPTIONS, gradeShort } from "@/lib/constants";
import { normalizeEntryName } from "@/lib/entry-identity";

type Props = { meet: CompetitionMeet; locked: boolean; onDuty: (id: string) => void; onAdd: (slot?: MeetDutySlot, personId?: string, roleId?: string) => void; onRole: (id?: string, slot?: MeetDutySlot) => void; onDeleteRole: (id: string, revision: number) => Promise<boolean>; onEvent: (name: string, appearanceId?: string) => void; deleteStatus?: string; deleteConfirmLabel?: string };
export function CompetitionMeetDutyTable({ meet, locked, onDuty, onAdd, onRole, onDeleteRole, onEvent, deleteStatus, deleteConfirmLabel }: Props) {
  const [search, setSearch] = useState(""), [slot, setSlot] = useState<MeetDutySlot | null>(null);
  const slots = meetDutySlots(meet), query = normalizeEntryName(search).toLowerCase();
  const people = meet.participants.filter(p => (!p.deleted || meet.duties.some(d => d.participant_id === p.id && (d.assignment || d.role_ids.length))) && normalizeEntryName(p.name + p.grade).toLowerCase().includes(query)).sort((a, b) => {
    const index = (grade: string) => { const i = GRADE_OPTIONS.findIndex(option => option.value === grade || option.short === grade); return i < 0 ? GRADE_OPTIONS.length : i; };
    return index(a.grade) - index(b.grade) || a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id);
  });
  const slotDuties = slot ? meet.duties.filter(d => d.slot_time === slot.time && d.event_name === slot.event && (d.assignment || d.role_ids.length)) : [];
  const dutyRow = (d: CompetitionMeet["duties"][number]) => { const person = meet.participants.find(p => p.id === d.participant_id); return <button data-ui-row key={d.id} disabled={locked} className="min-h-14 w-full py-3 text-left pressable" onClick={() => { onDuty(d.id); setSlot(null); }}><span className="block text-body">{person?.name ?? "参加者確認中"} {gradeShort(person?.grade ?? null)}</span><span className="block text-caption">{meetDutyText(d, meet.roles)}</span>{person && slot && meetDutyCell(meet, person, slot).needsReplacement && <span className="block text-caption text-danger">交代が必要</span>}</button>; };
  return <div className="space-y-3">
    <Input aria-label="補助担当表の氏名・学年で検索" placeholder="氏名・学年で検索" value={search} onChange={e => setSearch(e.target.value)} />
    <p className="text-caption">出場・別種目出場と補助担当を確認できます。種目名から必要人数と担当者、担当欄から追加・変更を開きます。</p>
    <p className="text-micro text-muted2">アップ・移動・競技終了時刻は各自で確認してください。</p>
    <Card className="min-w-0 overflow-hidden"><div role="region" aria-label="参加者別の出場・補助担当表" tabIndex={0} className="max-h-[65dvh] overflow-auto">
      <table data-ui-table className="w-full border-collapse text-left text-caption" style={{ minWidth: 128 + slots.length * 112 }}>
        <caption className="sr-only">参加者別の出場と補助担当</caption>
        <thead className="sticky top-0 z-20 bg-card"><tr><th scope="col" className="sticky left-0 z-30 w-32 bg-card p-3">氏名・学年</th>{slots.map(s => {
          const roles = meet.roles.filter(r => r.slot_time === s.time && r.event_name === s.event);
          const shortage = roles.some(r => validRolePeople(meet, r.id).size < r.required_count);
          return <th scope="col" key={JSON.stringify(s)} className="w-28 border-l border-separator"><button data-ui-cell className="min-h-14 w-full p-2 text-left pressable" onClick={() => setSlot(s)}><span className="block tabular-nums">{s.time}</span><span className="font-normal text-accent">{s.event}</span>{shortage && <span className="block text-micro text-danger">人数不足</span>}</button></th>;
        })}</tr></thead>
        <tbody>{people.map(person => <tr key={person.id} className="border-t border-separator">
          <th scope="row" className="sticky left-0 z-10 bg-card p-2 font-normal"><span className="block text-micro text-muted2">{gradeShort(person.grade)}{person.absent ? "・欠席" : person.deleted ? "・削除済み" : ""}</span><span className="block break-words">{person.name}</span></th>
          {slots.map(s => { const cell = meetDutyCell(meet, person, s), text = cell.competing.length ? `${cell.concurrent ? "別種目出場" : "出場"}: ${cell.competing.map(a => `${a.event_name} ${meetAppearancePositionLabel(meet,a)}`).join("・")}` : person.absent ? "欠席" : person.deleted ? "削除済み" : cell.appearances.length ? "DNS" : cell.onDay ? "当日確認" : "出場なし";
            const inactive = person.absent || person.deleted;
            return <td key={JSON.stringify(s)} className={`border-l border-separator align-top ${cell.needsReplacement ? "bg-danger/10" : cell.competing.length ? "bg-accent/5" : ""}`}><div className="space-y-1 p-1">
              {cell.competing.length ? cell.competing.map(a => <button key={a.id} data-ui-cell className="min-h-11 w-full px-1 text-left text-micro text-accent pressable" onClick={() => onEvent(a.event_name, a.id)} aria-label={`${person.name} ${s.time} ${a.event_name} ${meetAppearancePositionLabel(meet,a)}の出場を確認`}>{meet.events.find(e=>e.name===a.event_name)?.family!==s.event ? "別種目出場" : "出場"}: {a.event_name}<span className="block">{meetAppearancePositionLabel(meet,a)}</span></button>) : <span className="block px-1 py-2 text-micro text-muted2">{text}</span>}
              {cell.duties.map(d => <button data-ui-cell key={d.id} disabled={locked} className="min-h-11 w-full rounded-lg px-1 text-left text-micro pressable" onClick={() => onDuty(d.id)} aria-label={`${person.name} ${s.time} ${s.event}の担当を変更`}><span className="font-medium">補助: {meetDutyText(d, meet.roles)}</span>{cell.needsReplacement && <span className="block text-danger">交代が必要</span>}</button>)}
              {!cell.duties.length && !inactive && !cell.busy && person.grade !== "OB・OG" && <button data-ui-cell disabled={locked} className="min-h-11 w-full px-1 text-micro text-accent pressable" onClick={() => onAdd(s, person.id)}>担当を追加</button>}
            </div></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div></Card>
    {!people.length && <p className="text-caption">条件に合う参加者はいません</p>}
    <FormModal open={slot !== null} autoFocus={false} title={slot ? `${slot.time} ${slot.event}の補助担当` : "補助担当"} onOpenChange={open => !open && setSlot(null)}>
      {slot && <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><Button disabled={locked} onClick={() => { onAdd(slot); setSlot(null); }}>担当者を追加</Button><Button disabled={locked} variant="outline" onClick={() => { onRole(undefined, slot); setSlot(null); }}>役割を追加</Button></div>
        {meet.roles.filter(r => r.slot_time === slot.time && r.event_name === slot.event).map(role => {
          const assigned = validRolePeople(meet, role.id);
          return <Card key={role.id} className="space-y-2 p-3.5"><div className="flex items-center justify-between gap-2"><h3 className="text-body font-semibold">{role.name}</h3><ActionMenu className="h-11 w-11" disabled={locked} onEdit={() => { onRole(role.id); setSlot(null); }} onDelete={() => onDeleteRole(role.id, role.revision)} deleteStatus={deleteStatus} deleteConfirmLabel={deleteConfirmLabel} deleteTitle="この役割を削除しますか？" deleteDescription="担当を先に解除してください。変更履歴は保持します。" /></div><p className={`text-caption ${assigned.size < role.required_count ? "text-danger" : ""}`}>担当 {assigned.size}人 / 必要 {role.required_count}人</p><div className="divide-y divide-separator">{slotDuties.filter(d=>d.role_ids.includes(role.id)).map(dutyRow)}</div><Button variant="outline" disabled={locked} onClick={() => { onAdd(slot, undefined, role.id); setSlot(null); }}>担当者を追加</Button></Card>;
        })}
        <div className="divide-y divide-separator">{slotDuties.filter(d=>!d.role_ids.length || d.role_ids.some(id=>!meet.roles.some(r=>r.id===id))).map(dutyRow)}</div>
        {!slotDuties.length && <p className="text-caption">補助担当はまだありません</p>}
      </div>}
    </FormModal>
  </div>;
}
