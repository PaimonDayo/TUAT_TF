"use client";

import { Card } from "@/components/ui/card";
import { itoRanking } from "@/lib/ito-score";
import type { AuthorMini, ItoPointEvent } from "@/types";

/** 個人累計ランキング。得点履歴から毎回計算する（累計値は保存しない）。 */
export function ItoRanking({
  events,
  people,
  viewerId,
}: {
  events: ItoPointEvent[];
  people: AuthorMini[];
  viewerId?: string;
}) {
  const rows = itoRanking(
    events.map((event) => ({ profileId: event.profile_id, points: event.points })),
  );
  if (rows.length === 0) return null;

  return (
    <Card className="space-y-2 p-3">
      <p className="section-label">個人ランキング（累計）</p>
      <div className="divide-y divide-separator/60">
        {rows.map((row) => (
          <div
            key={row.profileId}
            className={`flex items-center gap-3 py-1.5 ${
              row.profileId === viewerId ? "font-bold text-accent" : ""
            }`}
          >
            <span className="w-8 shrink-0 text-right text-[13px] tabular-nums">{row.rank}位</span>
            <span className="min-w-0 flex-1 truncate text-[14px]">
              {people.find((person) => person.id === row.profileId)?.display_name || "名無し"}
            </span>
            <span className="shrink-0 text-[14px] tabular-nums">{row.total}pt</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
