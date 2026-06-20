"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { SegmentedControl } from "@/components/ui/segmented";
import { GradeMenu } from "@/components/features/GradeMenu";
import { EmptyState } from "@/components/ui/empty-state";
import { SIMPLE_BLOCK_ITEMS, matchSimpleBlock, gradeShort } from "@/lib/constants";
import type { AuthorMini } from "@/types";

/** メンバー名簿。中長/短・学年で絞り込みできる */
export function MemberDirectory({ members }: { members: AuthorMini[] }) {
  const [block, setBlock] = useState("all");
  const [grades, setGrades] = useState<string[]>([]);

  const filtered = useMemo(
    () =>
      members.filter(
        (m) =>
          matchSimpleBlock(m.blocks, block) &&
          (grades.length === 0 || grades.includes(m.grade ?? "")),
      ),
    [members, block, grades],
  );

  return (
    <>
      <div className="px-4 pb-2">
        <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />
      </div>
      <div className="px-4 pb-2 flex items-center justify-between">
        <span className="text-caption">{filtered.length}人</span>
        <GradeMenu value={grades} onChange={setGrades} />
      </div>

      <div className="px-4 pt-1">
        {filtered.length === 0 ? (
          <EmptyState title="条件に合う部員がいません" />
        ) : (
          <div className="space-y-2">
            {filtered.map((m) => (
              <Link key={m.id} href={`/members/${m.id}`}>
                <Card className="p-3 flex items-center gap-3 active:bg-bg">
                  <Avatar
                    name={m.display_name || "?"}
                    blocks={m.blocks}
                    avatarUrl={m.avatar_url}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[14px] font-semibold truncate">
                        {m.display_name || "名前未設定"}
                      </span>
                      <BlockPills blocks={m.blocks} />
                    </div>
                    {gradeShort(m.grade) && (
                      <span className="text-micro">{gradeShort(m.grade)}</span>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-muted shrink-0" />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
