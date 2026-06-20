"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { SegmentedControl } from "@/components/ui/segmented";
import { GradeMenu } from "@/components/features/GradeMenu";
import { GradeChips } from "@/components/features/GradeChips";
import { EmptyState } from "@/components/ui/empty-state";
import {
  GRADE_OPTIONS,
  SIMPLE_BLOCK_ITEMS,
  matchSimpleBlock,
  gradeShort,
} from "@/lib/constants";
import type { AuthorMini } from "@/types";

/** メンバー名簿。中長/短・学年・名前で絞り込みでき、学年ごとに区切って表示する */
export function MemberDirectory({ members }: { members: AuthorMini[] }) {
  const [block, setBlock] = useState("all");
  const [grades, setGrades] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  // 在籍者がいる学年だけをフィルタ候補に出す
  const presentGrades = useMemo(() => {
    const set = new Set(members.map((m) => m.grade ?? "").filter(Boolean));
    return GRADE_OPTIONS.map((g) => g.value).filter((v) => set.has(v));
  }, [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter(
      (m) =>
        matchSimpleBlock(m.blocks, block) &&
        (grades.length === 0 || grades.includes(m.grade ?? "")) &&
        (!q || (m.display_name ?? "").toLowerCase().includes(q)),
    );
  }, [members, block, grades, query]);

  // 学年ごとにグループ化（GRADE_OPTIONS 順。学年未設定は末尾）
  const groups = useMemo(() => {
    const out: { key: string; label: string; list: AuthorMini[] }[] = [];
    for (const g of GRADE_OPTIONS) {
      const list = filtered.filter((m) => m.grade === g.value);
      if (list.length > 0) out.push({ key: g.value, label: g.short, list });
    }
    const noGrade = filtered.filter((m) => !m.grade);
    if (noGrade.length > 0) out.push({ key: "none", label: "学年未設定", list: noGrade });
    return out;
  }, [filtered]);

  return (
    <>
      <div className="px-4 pb-2">
        <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />
      </div>
      <div className="px-4 pb-2">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前で検索"
            className="pl-9"
          />
        </div>
      </div>
      <div className="px-4 pb-2 flex items-center justify-between">
        <span className="text-caption tabular-nums">{filtered.length}人</span>
        <GradeMenu value={grades} onChange={setGrades} availableGrades={presentGrades} />
      </div>
      {grades.length > 0 && (
        <div className="px-4 pb-2">
          <GradeChips value={grades} onChange={setGrades} />
        </div>
      )}

      <div className="px-4 pt-1">
        {groups.length === 0 ? (
          <EmptyState title="条件に合う部員がいません" />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.key}>
                <p className="section-label mb-2">
                  {group.label}
                  <span className="ml-1.5 tabular-nums">{group.list.length}</span>
                </p>
                <div className="space-y-2">
                  {group.list.map((m) => (
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
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
