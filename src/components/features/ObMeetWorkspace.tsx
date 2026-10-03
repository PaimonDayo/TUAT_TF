"use client";

import { type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented";
import { ObDutyIssues } from "./ObDutyIssues";
import type { ObDutyIssue } from "@/lib/ob-duty-issues";

export function ObMeetWorkspace({ program, duties, mine, management, initialView = "program", dutyProblemCount = 0, dutyIssues = [] }: {
  program: ReactNode; duties: ReactNode; mine: ReactNode; management?: ReactNode; initialView?: string; dutyProblemCount?: number; dutyIssues?: ObDutyIssue[];
}) {
  const params = useSearchParams();
  const requested = params.get("view") ?? initialView;
  const view = ["program", "duties", "mine", ...(management ? ["management"] : [])].includes(requested) ? requested : "program";
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
      ...(management ? [{ key: "management", label: "運営・登録" }] : []),
    ]} />
    {view!=="duties"&&dutyIssues.length>0&&<ObDutyIssues issues={dutyIssues} onOpen={(time,event)=>{const url=new URL(window.location.href);url.searchParams.set("view","duties");url.searchParams.set("issue",time+"/"+event);url.searchParams.delete("edit");window.history.replaceState(null,"",url.pathname+url.search);}} />}
    {view === "program" ? program : view === "duties" ? duties : view === "management" && management ? management : mine}
  </div>;
}
