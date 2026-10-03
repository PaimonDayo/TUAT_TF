"use client";

import { type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ObLiveRefresh } from "./ObLiveRefresh";
import { ObDutyReviewProvider, useObDutyReview } from "./ObDutyReviewProvider";
import type { ObDutyIssue } from "@/lib/ob-duty-issues";

type WorkspaceProps = {
  program: ReactNode; duties: ReactNode; mine: ReactNode; management?: ReactNode; day?: ReactNode; initialView?: string; userId: string; dutyIssues?: ObDutyIssue[];
};
export function ObMeetWorkspace(props: WorkspaceProps) {
  return <ObDutyReviewProvider userId={props.userId}><Workspace {...props}/></ObDutyReviewProvider>;
}
function Workspace({ program, duties, mine, management, day, initialView = "program", dutyIssues = [] }: WorkspaceProps) {
  const {unread}=useObDutyReview(dutyIssues);
  const dutyProblemCount=new Set(unread.map(issue=>issue.time+"/"+issue.event)).size;
  const params = useSearchParams();
  const requested = params.get("view") === "heats" ? "day" : params.get("view") ?? initialView;
  const view = ["program", "duties", "mine", ...(day ? ["day"] : []), ...(management ? ["management"] : [])].includes(requested) ? requested : "program";
  function setView(next: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.searchParams.delete("edit");
    url.searchParams.delete("issue");
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  return <div data-ob-workspace className="space-y-4 px-4 pb-8 pt-2">
    <nav aria-label="OB戦の画面" className="flex gap-1 overflow-x-auto border-b border-separator">{[
      ...(day ? [{key:"day",label:"当日運営"}] : []),
      {key:"program",label:"プログラム"},{key:"duties",label:"補助員"},
      ...(management ? [{key:"management",label:"参加者"}] : []),{key:"mine",label:"自分"},
    ].map(item=><button key={item.key} type="button" aria-current={view===item.key?"page":undefined} onClick={()=>setView(item.key)} className={`flex min-h-12 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold md:px-5 ${view===item.key?"border-accent text-accent":"border-transparent text-muted"}`}>{item.label}{item.key==="duties"&&dutyProblemCount>0&&<span aria-label={`未確認${dutyProblemCount}種目`} className="rounded-full bg-danger/10 px-1.5 py-0.5 text-xs text-danger">{dutyProblemCount}</span>}</button>)}</nav>
    <ObLiveRefresh/>
    {view === "program" ? program : view === "duties" ? duties : view === "day" && day ? day : view === "management" && management ? management : mine}
  </div>;
}
