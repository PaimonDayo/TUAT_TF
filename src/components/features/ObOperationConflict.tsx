"use client";

import { Button } from "@/components/ui/button";
import { operationFieldLabel } from "@/lib/ob-operation-draft";
import type { ObEntry } from "@/lib/ob-entries";
import type { useObOperationDraft } from "./useObOperationDraft";

export function ObOperationConflict({ draft, entries }: { draft: ReturnType<typeof useObOperationDraft>; entries: ObEntry[] }) {
  if (!draft.review && !draft.blocked.length) return null;
  return <>{!!draft.blocked.length && <section aria-label="欠席・出場取消の変更を確認" className="space-y-3 rounded-xl border border-accent bg-accent/5 p-4">
    <h3 className="text-headline">入力中に欠席・出場取消になった人がいます</h3>
    <p className="text-body">この人の未保存の変更を取り消すか、出場登録を戻してから保存してください。他の人の入力は残ります。</p>
    {draft.blocked.map(person => <div key={person.entryId} className="flex flex-wrap items-center justify-between gap-2"><span className="text-body">{entries.find(e => e.id === person.entryId)?.submitted_name ?? "出場者"}</span><Button variant="outline" disabled={draft.busy || draft.reviewing} onClick={() => draft.discardPerson(person.entryId)}>この人の変更を取り消す</Button></div>)}
  </section>}{draft.review && <section role="region" aria-label="他の端末の変更を確認" className="space-y-3 rounded-xl border border-accent bg-accent/5 p-4">
    <h3 className="text-headline">他の端末の変更を確認</h3>
    <p className="text-body">入力は残っています。重なった変更だけ、採用する内容を選んでください。</p>
    {draft.review.conflicts.map(conflict => <fieldset key={conflict.key} className="space-y-2 rounded-lg border border-separator bg-card p-3">
      <legend className="px-1 text-body font-semibold">{entries.find(e => e.id === conflict.entryId)?.submitted_name ?? "出場者"} · {{ position: "組・順番", status: "出場状況", trials: "記録" }[conflict.field]}</legend>
      {(["current", "own"] as const).map(source => <label key={source} className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-body">
        <input className="mt-1" type="radio" name={conflict.key} checked={draft.choices[conflict.key] === source} onChange={() => draft.setChoices(current => ({ ...current, [conflict.key]: source }))}/>
        <span className="min-w-0 break-words"><strong className="block">{source === "current" ? "保存されている内容" : "自分の入力"}</strong>{operationFieldLabel(conflict[source], conflict.field)}</span>
      </label>)}
    </fieldset>)}
    {!draft.review.conflicts.length && <p className="text-caption">重なった入力はありません。追加された出場者と他の端末の変更を取り込めます。</p>}
    <Button disabled={draft.review.conflicts.some(c => !draft.choices[c.key])} onClick={draft.applyReview}>確認した内容を反映</Button>
  </section>}</>;
}
