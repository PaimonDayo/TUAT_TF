"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { ObDutyTable } from "./ObDutyTable";
import { OB_PROGRAM } from "@/lib/ob-meet";
import { MeetEvent } from "@/lib/meet-operations";
import { obEventRule, type ObEventOperation } from "@/lib/ob-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { EntryMember } from "@/lib/entry-identity";
import type { ObDuty, ObDutyRole } from "@/lib/ob-duty";

/** All members can inspect the saved program; this view has no mutation controls. */
export function ObPublicProgram({ entries, members, duties, roles, operations }: {
  entries: ObEntry[]; members: EntryMember[]; duties: ObDuty[]; roles: ObDutyRole[]; operations: ObEventOperation[];
}) {
  const [view, setView] = useState("program");
  return <section className="space-y-4">
    <SegmentedControl value={view} onChange={setView} items={[{ key: "program", label: "プログラム" }, { key: "duties", label: "補助員表" }]} />
    {view === "duties" ? <ObDutyTable integrated canEditDuties={false} entries={entries} members={members} duties={duties} roles={roles} /> :
      <div className="space-y-3">{OB_PROGRAM.map(slot => <Card key={slot.time + slot.label} className="space-y-3 p-4">
        <h2 className="text-headline">{slot.time} {slot.label}{slot.note && `（${slot.note}）`}</h2>
        {slot.events.flatMap(event => ["男子", "女子"].map(gender => gender + event)).map(event => {
          const people = entries.filter(e => e.events.includes(event));
          const saved = operations.find(o => o.event_name === event);
          if (!people.length) return null;
          const ordered = [...people].sort((a, b) => {
            const x = saved?.data.participants.find(p => p.entryId === a.id), y = saved?.data.participants.find(p => p.entryId === b.id);
            return (x?.group ?? 100) - (y?.group ?? 100) || (x?.order ?? 100) - (y?.order ?? 100) || a.submitted_name.localeCompare(b.submitted_name, "ja");
          });
          return <div key={event}><h3 className="text-body font-medium">{event} · {saved?.data.confirmed ? "確認済み" : "調整中"}</h3>
            <ul className="divide-y divide-separator">{ordered.map(e => {
              const p = saved?.data.participants.find(p => p.entryId === e.id);
              return <li key={e.id} className="space-y-1 py-2 text-body"><p>{p?.group ? `${p.group}組 ` : ""}{p?.order ? `${p.order}番 ` : ""}{e.grade} {e.submitted_name}</p>
                <p className="text-caption">資格記録：{e.qualification_marks[event] || "未入力"}{p && saved ? ` · 記録：${new MeetEvent(obEventRule(event), saved.data).best(p)}` : ""}</p></li>;
            })}</ul></div>;
        })}
      </Card>)}</div>}
  </section>;
}
