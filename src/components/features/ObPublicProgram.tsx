"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FormModal } from "@/components/ui/form-modal";
import { SegmentedControl } from "@/components/ui/segmented";
import { Disclosure } from "@/components/ui/disclosure";
import { ObDutyTable } from "./ObDutyTable";
import { OB_PROGRAM, OB_DUTY_SLOTS } from "@/lib/ob-meet";
import { MeetEvent } from "@/lib/meet-operations";
import { obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { EntryMember } from "@/lib/entry-identity";
import { dutyRoleText, hasDuty, type ObDuty, type ObDutyRole } from "@/lib/ob-duty";

/** 閲覧は時刻と種目から。出場者や補助担当の詳細は必要なときだけ開く。 */
export function ObPublicProgram({ entries, members, duties, roles, operations, view = "program" }: {
  view?: "program" | "duties"; entries: ObEntry[]; members: EntryMember[]; duties: ObDuty[]; roles: ObDutyRole[]; operations: ObEventOperation[];
}) {
  const [event, setEvent] = useState<string | null>(null);
  const [gender, setGender] = useState("男子");
  const eventName = gender + event;
  const saved = operations.find(o => o.event_name === eventName);
  const people = entries.filter(e => e.events.includes(eventName)).sort((a, b) => {
    const x = saved?.data.participants.find(p => p.entryId === a.id), y = saved?.data.participants.find(p => p.entryId === b.id);
    return (x?.group ?? 100) - (y?.group ?? 100) || (x?.order ?? 100) - (y?.order ?? 100) || a.submitted_name.localeCompare(b.submitted_name, "ja");
  });
  return <section className="space-y-3">
    {view === "program" ? <>
      <p className="text-caption">種目を押すと出場者・組分け・記録を確認できます。</p>
      <Card className="divide-y divide-separator px-3">
        {OB_PROGRAM.map(slot => <div key={slot.time + slot.label} className="flex gap-3 py-2">
          <span className="w-12 shrink-0 pt-3 text-body font-semibold tabular-nums">{slot.time}</span>
          <div className="min-w-0 flex-1">{slot.events.length ? slot.events.map(name => <button key={name} type="button" onClick={() => { setEvent(name); setGender(entries.some(e => e.events.includes("男子" + name)) ? "男子" : "女子"); }} className="flex min-h-12 w-full items-center gap-2 text-left pressable">
            <span className="min-w-0 flex-1 break-words text-body font-medium">{name === "立ち五段" ? "立ち五段跳び" : name}</span>
            <span className="shrink-0 text-caption">{entries.filter(e => e.events.some(v => v === "男子" + name || v === "女子" + name)).length}人</span><ChevronRight size={16} className="shrink-0 text-muted" />
          </button>) : <div className="py-3 text-body">{slot.label}{slot.note && <p className="text-caption">{slot.note}</p>}</div>}</div>
        </div>)}
      </Card>
    </> : <>
      <p className="text-caption">種目を開くと補助担当を確認できます。時刻は種目の開始時刻です。</p>
      <Card className="px-3">{OB_DUTY_SLOTS.map(slot => {
        const assigned = duties.filter(d => d.slot_time === slot.time && d.event_name === slot.label && hasDuty(d));
        return <Disclosure key={slot.time + slot.label} title={<span className="flex items-baseline gap-3"><span className="w-12 shrink-0 tabular-nums">{slot.time}</span><span className="min-w-0 flex-1 break-words">{slot.label}</span><span className="shrink-0 text-caption">{assigned.length}人</span></span>}>
          {assigned.length ? <ul className="divide-y divide-separator">{assigned.map(d => <li key={d.profile_id} className="py-2 text-body"><p>{members.find(m => m.id === d.profile_id)?.display_name ?? entries.find(e => e.id === d.profile_id || e.profile_id === d.profile_id)?.submitted_name ?? "氏名未確認"}</p><p className="text-caption">{dutyRoleText(d, roles)}</p></li>)}</ul> : <p className="text-caption">補助担当はまだ登録されていません。</p>}
        </Disclosure>;
      })}</Card>
      <Disclosure title="全員の補助員表・CSV"><ObDutyTable integrated canEditDuties={false} entries={entries} members={members} duties={duties} roles={roles} /></Disclosure>
    </>}
    <FormModal open={event !== null} onOpenChange={open => { if (!open) setEvent(null); }} title={`${event === "立ち五段" ? "立ち五段跳び" : event ?? ""}の出場者`}>
      <div className="space-y-4">
        <SegmentedControl value={gender} onChange={setGender} items={["男子", "女子"].map(g => ({ key: g, label: `${g} (${entries.filter(e => e.events.includes(g + event)).length})` }))} />
        {saved && <p className="text-caption">{saved.data.confirmed ? "組分け・記録は確認済みです" : "組分け・記録は調整中です"}</p>}
        {people.length ? <ul className="divide-y divide-separator">{people.map(e => {
          const p = saved?.data.participants.find(p => p.entryId === e.id);
          const result = p && saved ? new MeetEvent(obEventRule(eventName), saved.data).best(p) : null;
          return <li key={e.id} className="space-y-1 py-3 text-body">
            {(p?.group || p?.order) && <p className="text-caption">{p?.group ? `${p.group}組 ` : ""}{p?.order ? `${p.order}番` : ""}</p>}
            <p className="break-words font-medium">{e.submitted_name}<span className="ml-2 text-caption">{e.grade}</span></p>
            {e.qualification_marks[eventName] && <p className="text-caption">資格記録：{e.qualification_marks[eventName]}</p>}
            {result && result !== "—" && <p>記録：{result}</p>}
          </li>;
        })}</ul> : <p className="text-caption">出場登録はありません。</p>}
      </div>
    </FormModal>
  </section>;
}
