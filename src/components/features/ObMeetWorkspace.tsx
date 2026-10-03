"use client";

import { type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented";
import { ObDutyReviewProvider, useObDutyReview } from "./ObDutyReviewProvider";
import type { ObDutyIssue } from "@/lib/ob-duty-issues";

type WorkspaceProps = {
  program: ReactNode; duties: ReactNode; mine: ReactNode; management?: ReactNode; heats?: ReactNode; initialView?: string; userId: string; dutyIssues?: ObDutyIssue[];
};
export function ObMeetWorkspace(props: WorkspaceProps) {
  return <ObDutyReviewProvider userId={props.userId}><Workspace {...props}/></ObDutyReviewProvider>;
}
function Workspace({ program, duties, mine, management, heats, initialView = "program", dutyIssues = [] }: WorkspaceProps) {
  const {unread}=useObDutyReview(dutyIssues);
  const dutyProblemCount=new Set(unread.map(issue=>issue.time+"/"+issue.event)).size;
  const params = useSearchParams();
  const requested = params.get("view") ?? initialView;
  const view = ["program", "duties", "mine", ...(heats ? ["heats"] : []), ...(management ? ["management"] : [])].includes(requested) ? requested : "program";
  function setView(next: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.searchParams.delete("edit");
    url.searchParams.delete("issue");
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  return <div data-ob-workspace className="space-y-4 px-4 pb-8 pt-2">
    <SegmentedControl value={view} onChange={setView} items={[
      { key: "mine", label: "自分の予定" }, { key: "program", label: "プログラム" }, { key: "duties", label: dutyProblemCount ? `補助員 ！${dutyProblemCount}` : "補助員" },
      ...(heats ? [{key:"heats",label:"組分け"}] : []),
      ...(management ? [{ key: "management", label: "運営・登録" }] : []),
    ]} />
    {view === "program" ? program : view === "duties" ? duties : view === "heats" && heats ? heats : view === "management" && management ? management : mine}
  </div>;
}
