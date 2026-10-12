import Link from "next/link";
import { Card } from "@/components/ui/card";
import { appearancePerformance, competitionFamilyData, meetDutyText, type CompetitionMeet } from "@/lib/competition-meet";
import { fieldOrderRows } from "@/lib/meet-field-order";

/** Server-only summary: no other participant's identity is sent to a client component. */
export function CompetitionMeetHomeCard({ meet, profileId }: { meet: CompetitionMeet; profileId: string }) {
  if (!meet.permissions.manage) return <section className="space-y-2"><p className="section-label">{meet.name}</p><Card><Link data-ui-row className="flex min-h-14 items-center justify-between p-4 text-body text-accent" href={`/competitions/${meet.competitionId}/program`}>結果を見る<span>→</span></Link></Card></section>;
  const person=meet.participants.find(p=>p.profile_id===profileId);
  const appearances=meet.appearances.filter(a=>a.participant_id===person?.id&&a.state!=="deleted").sort((a,b)=>(meet.events.find(e=>e.name===a.event_name)?.starts_at??"").localeCompare(meet.events.find(e=>e.name===b.event_name)?.starts_at??"")||a.ordinal-b.ordinal);
  const duties=meet.duties.filter(d=>d.participant_id===person?.id&&(d.assignment||d.role_ids.length));
  const path=`/competitions/${meet.competitionId}/manage`;
  return <section className="space-y-2"><p className="section-label">{meet.name}</p><Card className="space-y-3 p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-headline">自分の出場</h3><Link data-ui-row className="flex min-h-11 items-center text-body text-accent" href={`${path}?section=mine&edit=mine`}>{person?"自分の登録":"参加者を登録"} →</Link></div>
    {person?.absent&&<p className="text-caption">大会欠席として登録されています</p>}{person?.deleted&&<p className="text-caption">参加者の登録は削除扱いです。大会担当者が復帰できます。</p>}
    {appearances.length?<ul className="space-y-2">{appearances.map(a=>{const e=meet.events.find(e=>e.name===a.event_name)!,p=appearancePerformance(person,a),number=e.discipline!=="track"?fieldOrderRows(competitionFamilyData(meet,e)).find(row=>row.person.entryId===a.id)?.number:null;return <li key={a.id} className="flex items-baseline gap-3 text-body"><span className="w-12 shrink-0 text-caption">{e.starts_at??"未定"}</span><span><span className="block">{a.event_name}・{a.ordinal}件目{p.status!=="entered"?`・${p.status}`:""}</span><span className="block text-caption">{e.discipline!=="track"?(number==null?"順番未定":`試技順 ${number}番`):p.group===null?"組未定":`${p.heatScope??e.division}${p.group}組 ${p.order??"未定"}番`}</span></span></li>;})}</ul>:<p className="text-caption">出場登録はありません</p>}
    {duties.length>0&&<div className="border-t border-separator pt-3"><h3 className="text-headline">自分の補助担当</h3><ul className="mt-2 space-y-1">{duties.map(d=><li key={d.id} className="text-body">{d.slot_time} {d.event_name}・{meetDutyText(d,meet.roles)}</li>)}</ul></div>}
    <Link data-ui-row className="flex min-h-11 items-center justify-end border-t border-separator text-body text-accent" href={path}>全体の競技・補助担当 →</Link>
  </Card></section>;
}
