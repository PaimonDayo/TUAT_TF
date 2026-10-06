"use client";

import { Button } from "@/components/ui/button";
import { operationFieldLabel } from "@/lib/ob-operation-draft";
import { fieldOrderRows } from "@/lib/meet-field-order";
import { obEventRule } from "@/lib/ob-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { MeetPerformance } from "@/lib/meet-operations";
import type { useObOperationDraft } from "./useObOperationDraft";

type ConflictDraft = Pick<ReturnType<typeof useObOperationDraft>, "data" | "latestData" | "review" | "blocked" | "locked" | "reviewing" | "discardPerson" | "choices" | "setChoices" | "applyReview">;
export function ObOperationConflict({ draft, entries, event, groupLabel, positionLabel }: { draft: ConflictDraft; entries: ObEntry[]; event?: string; groupLabel?: (group: number) => string; positionLabel?: (person: MeetPerformance, source: "own" | "current") => string }) {
  if (!draft.review && !draft.blocked.length) return null;
  const field = event !== undefined && obEventRule(event).discipline !== "track";
  const fieldNumbers = {
    own: new Map(field ? fieldOrderRows(draft.data).map(row => [row.person.entryId, row.number]) : []),
    current: new Map(field && draft.latestData ? fieldOrderRows(draft.latestData).map(row => [row.person.entryId, row.number]) : []),
  };
  const trialOrder = (source: "own" | "current", id: string) => {
    const number = fieldNumbers[source].get(id);
    return number === undefined ? "順番を確認できません" : number === null ? "順番未定" : `試技順 ${number}番`;
  };
  const sameTrialOrder = (id: string) => fieldNumbers.own.has(id) && fieldNumbers.current.has(id) && fieldNumbers.own.get(id) === fieldNumbers.current.get(id);
  const savedGroup = (person: MeetPerformance) => person.group === null ? "組未指定" : groupLabel ? groupLabel(person.group) : `${person.heatScope ?? event?.match(/^(男子|女子)/)?.[1] ?? ""}${person.group}組`;
  return <>{!!draft.blocked.length && <section aria-label="欠席・出場取消の変更を確認" className="space-y-3 rounded-xl border border-accent bg-accent/5 p-4">
    <h3 className="text-headline">入力中に欠席・出場取消になった人がいます</h3>
    <p className="text-body">この人の未保存の変更を取り消すか、出場登録を戻してから保存してください。他の人の入力は残ります。</p>
    {draft.blocked.map(person => <div key={person.entryId} className="flex flex-wrap items-center justify-between gap-2"><span className="text-body">{entries.find(e => e.id === person.entryId)?.submitted_name ?? "出場者"}</span><Button variant="outline" disabled={draft.locked || draft.reviewing} onClick={() => draft.discardPerson(person.entryId)}>この人の変更を取り消す</Button></div>)}
  </section>}{draft.review && <section role="region" aria-label="他の端末の変更を確認" className="space-y-3 rounded-xl border border-accent bg-accent/5 p-4">
    <h3 className="text-headline">他の端末の変更を確認</h3>
    <p className="text-body">入力は残っています。重なった変更だけ、採用する内容を選んでください。</p>
    {draft.review.conflicts.map(conflict => <fieldset key={conflict.key} className="space-y-2 rounded-lg border border-separator bg-card p-3">
      <legend className="px-1 text-body font-semibold">{entries.find(e => e.id === conflict.entryId)?.submitted_name ?? "出場者"} · {{ position: field ? "試技順" : "組・順番", status: "出場状況", trials: "記録" }[conflict.field]}</legend>
      {(["current", "own"] as const).map(source => <label key={source} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-body">
        <input className="mt-1" type="radio" disabled={draft.locked} name={conflict.key} checked={draft.choices[conflict.key] === source} onChange={() => draft.setChoices(current => ({ ...current, [conflict.key]: source }))}/>
        <span className="min-w-0 break-words"><strong className="block">{source === "current" ? "保存されている内容" : "自分の入力"}</strong>{conflict.field === "position" ? positionLabel ? positionLabel(conflict[source], source) : field ? trialOrder(source, conflict.entryId) : groupLabel ? conflict[source].group === null ? "組未定" : `${savedGroup(conflict[source])} ${conflict[source].order ?? "—"}番` : operationFieldLabel(conflict[source], conflict.field) : operationFieldLabel(conflict[source], conflict.field)}{field && conflict.field === "position" && (positionLabel ? positionLabel(conflict.own, "own") === positionLabel(conflict.current, "current") : sameTrialOrder(conflict.entryId)) && <span className="mt-1 block text-caption text-ink/75">保存時の配置：{savedGroup(conflict[source])}・{conflict[source].order === null ? "順番未指定" : `${conflict[source].order}番`}</span>}</span>
      </label>)}
    </fieldset>)}
    {!draft.review.conflicts.length && <p className="text-caption">重なった入力はありません。追加された出場者と他の端末の変更を取り込めます。</p>}
    <Button disabled={draft.locked || draft.review.conflicts.some(c => !draft.choices[c.key])} onClick={draft.applyReview}>確認した内容を反映</Button>
  </section>}</>;
}
