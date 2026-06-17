"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented";
import { BLOCK_ORDER, BLOCKS } from "@/lib/constants";

/** ブロックフィルタータブ。URL の ?block= を切り替える */
export function BlockFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("block") ?? "all";

  const items = [
    { key: "all", label: "すべて" },
    ...BLOCK_ORDER.map((b) => ({ key: b, label: BLOCKS[b].short })),
  ];

  function select(key: string) {
    const sp = new URLSearchParams(params.toString());
    if (key === "all") sp.delete("block");
    else sp.set("block", key);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="px-4 pb-2">
      <SegmentedControl items={items} value={current} onChange={select} />
    </div>
  );
}
