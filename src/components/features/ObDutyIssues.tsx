"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import type { ObDutyIssue } from "@/lib/ob-duty-issues";
import { useObDutyReview } from "./ObDutyReviewProvider";

export function ObDutyIssues({issues,onOpen}:{issues:ObDutyIssue[];onOpen?:(time:string,event:string)=>void}) {
  const {unread,isReviewed,mark,canReview}=useObDutyReview(issues);
  const [showReviewed,setShowReviewed]=useState(false);
  if(!issues.length)return null;
  const shown=showReviewed?issues:unread;
  const slots=[...new Set(shown.map(issue=>issue.time+"/"+issue.event))];
  return <Disclosure title={unread.length?<span className="text-danger">！補助員の未確認 {unread.length}件</span>:<span className="text-caption">補助員の確認済み {issues.length}件</span>}>
    <div className="space-y-3">
      <p className="text-caption">把握した問題は確認済みにできます。担当や内容が変わると再表示します。</p>
      <p className="text-micro text-muted2">確認済みは自分のアカウント・このブラウザに保存します。</p>
      <label className="flex min-h-11 items-center gap-2 text-caption"><input type="checkbox" checked={showReviewed} onChange={e=>setShowReviewed(e.target.checked)}/>確認済みも表示</label>
      <div className="grid gap-3 lg:grid-cols-2">{slots.map(key=>{
        const group=shown.filter(issue=>issue.time+"/"+issue.event===key);
        return <section key={key} className="rounded-xl border border-separator p-3">
          {onOpen?<Button variant="ghost" className="w-full justify-start" onClick={()=>onOpen(group[0].time,group[0].event)}>{group[0].time} {group[0].event}を開く</Button>:<h3 className="text-headline">{group[0].time} {group[0].event}</h3>}
          {group.map(issue=><div key={issue.key} className="flex items-start gap-2 border-t border-separator py-2">
            <span className={"min-w-0 flex-1 break-words text-caption "+(isReviewed(issue)?"text-muted2":"")}><span aria-hidden>{isReviewed(issue)?"✓ ":"！ "}</span>{issue.text}</span>
            {canReview&&<Button size="sm" variant="ghost" className="shrink-0" onClick={()=>mark([issue],!isReviewed(issue))}>{isReviewed(issue)?"未確認に戻す":"確認済みにする"}</Button>}
          </div>)}
        </section>;
      })}</div>
    </div>
  </Disclosure>;
}
