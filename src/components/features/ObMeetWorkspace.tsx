"use client";

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/segmented";

export function ObMeetWorkspace({ program, duties, mine, management, initialView = "program" }: {
  program: ReactNode; duties: ReactNode; mine: ReactNode; management?: ReactNode; initialView?: string;
}) {
  const [view, setView] = useState(initialView);
  return <div data-ob-workspace className="space-y-4 px-4 pb-8 pt-2">
    <SegmentedControl value={view} onChange={setView} items={[
      { key: "program", label: "プログラム" }, { key: "duties", label: "補助員" }, { key: "mine", label: "自分の登録" },
      ...(management ? [{ key: "management", label: "管理" }] : []),
    ]} />
    {view === "program" ? program : view === "duties" ? duties : view === "management" && management ? management : mine}
  </div>;
}
