"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented";
import { SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";

export function ScheduleTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("type") ?? "all";

  const items = [
    { key: "all", label: "すべて" },
    ...SCHEDULE_TYPE_OPTIONS.map((o) => ({ key: o.key, label: o.label })),
  ];

  function select(key: string) {
    const sp = new URLSearchParams(params.toString());
    if (key === "all") sp.delete("type");
    else sp.set("type", key);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="px-4 pb-2">
      <SegmentedControl items={items} value={current} onChange={select} />
    </div>
  );
}
