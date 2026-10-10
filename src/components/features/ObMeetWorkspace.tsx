"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ObLiveRefresh } from "./ObLiveRefresh";
import { ObDutyReviewProvider, useObDutyReview } from "./ObDutyReviewProvider";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";
import type { ObDutyIssue } from "@/lib/ob-duty-issues";
import type { ObOperationSection, ObWorkspaceView } from "@/lib/ob-meet-navigation";

type Props = { children: ReactNode; view: ObWorkspaceView; section: ObOperationSection; canOperate: boolean; staff: boolean; userId: string; dutyIssues?: ObDutyIssue[] };
export function ObMeetWorkspace(props: Props) {
  return <ObDutyReviewProvider userId={props.userId}><Workspace {...props}/></ObDutyReviewProvider>;
}
function Workspace({ children, section, canOperate, staff, dutyIssues = [] }: Props) {
  const { unread } = useObDutyReview(dutyIssues);
  const dutyProblemCount = new Set(unread.map(issue => issue.time + "/" + issue.event)).size;
  return <div data-ob-workspace className="space-y-4 px-4 pb-8 pt-2">
    <h2 className="text-headline">{canOperate ? "当日の運営" : "大会のプログラム"}</h2>
    <nav aria-label="運営の作業" className="flex gap-1 overflow-x-auto border-b border-separator">
      {([...(canOperate ? [{ key: "events", label: "競技・記録" }] : []), { key: "program", label: "組分け" }, { key: "duties", label: "シフト表" }, { key: "mine", label: "自分の登録" }, ...(staff ? [{ key: "participants", label: "参加者管理" }] : [])]).map(item => <Link replace key={item.key} prefetch={false} href={`${OB_PROGRAM_PATH}?view=operations&section=${item.key}`} aria-current={section === item.key ? "page" : undefined} className={`flex min-h-12 min-w-fit flex-1 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-2 text-xs font-semibold sm:text-sm ${section === item.key ? "border-accent text-accent" : "border-transparent text-muted"}`}>{item.label}{item.key === "duties" && dutyProblemCount > 0 && <span aria-label={`未確認${dutyProblemCount}種目`} className="rounded-full bg-danger/10 px-1.5 py-0.5 text-xs text-danger">{dutyProblemCount}</span>}</Link>)}
    </nav>
    <ObLiveRefresh />
    {children}
  </div>;
}
