import Link from "next/link";
import { Avatar } from "@/components/common/Avatar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatKm } from "@/lib/utils";
import { gradeShort, INTENSITY_LABELS } from "@/lib/constants";
import type { WeeklyRankingRow } from "@/types";

const MEDAL = ["🥇", "🥈", "🥉"];

const SEGMENTS: { key: keyof WeeklyRankingRow; color: string }[] = [
  { key: "km_low", color: INTENSITY_LABELS.low.color },
  { key: "km_mid", color: INTENSITY_LABELS.mid.color },
  { key: "km_high", color: INTENSITY_LABELS.high.color },
  { key: "km_speed", color: INTENSITY_LABELS.speed.color },
];

/** 直近7日 走行距離ランキング（強度別の色分けバー） */
export function RankingList({
  rows,
  currentUserId,
}: {
  rows: WeeklyRankingRow[];
  currentUserId: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4">
        <Card>
          <EmptyState title="直近7日間はまだ記録がありません" />
        </Card>
      </div>
    );
  }

  const max = Math.max(...rows.map((r) => r.total_km), 1);

  return (
    <div className="px-4 space-y-2">
      {rows.map((row, i) => {
        const isMe = row.id === currentUserId;
        const gradeLabel = gradeShort(row.grade);
        return (
          <Link key={row.id} href={isMe ? "/mypage" : `/members/${row.id}`}>
            <Card
              className="p-3 flex items-center gap-3"
              style={isMe ? { borderColor: "#007aff", borderWidth: 1.5 } : undefined}
            >
              <span className="w-7 text-center text-headline tabular-nums shrink-0">
                {i < 3 ? MEDAL[i] : i + 1}
              </span>
              <Avatar name={row.display_name} blocks={row.blocks} avatarUrl={row.avatar_url} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold truncate">
                  {row.display_name || "名無し"}
                  {gradeLabel && <span className="text-micro ml-1">{gradeLabel}</span>}
                </p>
                {/* 強度別 積み上げバー */}
                <div className="h-2 mt-1 rounded-full bg-bg overflow-hidden flex">
                  {SEGMENTS.map((s) => {
                    const v = Number(row[s.key]) || 0;
                    return v > 0 ? (
                      <div
                        key={s.key as string}
                        style={{ width: `${(v / max) * 100}%`, backgroundColor: s.color }}
                      />
                    ) : null;
                  })}
                </div>
              </div>
              <span className="text-headline tabular-nums shrink-0">
                {formatKm(row.total_km)}
                <span className="text-caption ml-0.5">km</span>
              </span>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
