"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionMenu } from "@/components/ui/action-menu";
import { cn } from "@/lib/utils";
import type { CompetitionEvent } from "@/lib/competition-goals";
import {
  SIMPLE_BLOCK_ITEMS,
  matchSimpleBlock,
  type SimpleBlockFilter,
} from "@/lib/constants";
import { SegmentedControl } from "@/components/ui/segmented";
import type { CompetitionGoalRow } from "@/types";

/**
 * 1つの大会の目標一覧。自分の目標を先頭にまとめ、その下にみんなの目標を種目ごとに並べる。
 * 絞り込みはブロックと検索だけ（種目は見出しで分かれているので種目の選択は置かない）。
 */
export function CompetitionGoalBoard({
  goals,
  events,
  userId,
  personalBests,
  onEdit,
  onDelete,
  busy,
}: {
  goals: CompetitionGoalRow[];
  events: CompetitionEvent[];
  userId: string;
  personalBests: Map<string, string>;
  onEdit: (goal: CompetitionGoalRow) => void;
  onDelete: (id: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [block, setBlock] = useState<SimpleBlockFilter>("all");
  const [query, setQuery] = useState("");
  const eventOrder = (name: string) => {
    const index = events.findIndex((e) => e.name === name);
    return index < 0 ? events.length : index;
  };
  const byEvent = (a: CompetitionGoalRow, b: CompetitionGoalRow) => eventOrder(a.event) - eventOrder(b.event);
  const byName = (a: CompetitionGoalRow, b: CompetitionGoalRow) =>
    (a.author?.display_name ?? "部員").localeCompare(b.author?.display_name ?? "部員", "ja") ||
    a.user_id.localeCompare(b.user_id);

  const own = goals.filter((g) => g.user_id === userId).sort(byEvent);
  const needle = query.normalize("NFKC").toLocaleLowerCase().trim();
  const visible = goals.filter(
    (g) =>
      matchSimpleBlock(g.author?.blocks, block) &&
      (!needle ||
        `${g.author?.display_name ?? "部員"} ${g.event} ${g.target}`
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const eventNames = [...new Set(visible.map((g) => g.event))].sort((a, b) => eventOrder(a) - eventOrder(b));
  const filtered = needle !== "" || block !== "all";

  const actions = (g: CompetitionGoalRow) =>
    g.user_id === userId ? (
      <ActionMenu
        triggerLabel={`${g.event}の目標の操作`}
        onEdit={busy ? undefined : () => onEdit(g)}
        onDelete={busy ? undefined : () => onDelete(g.id)}
        deleteTitle={`${g.event}の目標を削除しますか？`}
        deleteDescription="この種目の目標だけを削除します。他の種目の目標は残ります。"
      />
    ) : null;

  return (
    <div className="space-y-4 pb-20">
      <section className="space-y-1.5">
        <p className="section-label">自分の目標</p>
        {own.length === 0 ? (
          <Card className="p-4 text-caption">まだ目標はありません。右下の＋から出場種目の目標を追加できます。</Card>
        ) : (
          <Card className="divide-y divide-separator">
            {own.map((g) => (
              <GoalRow key={g.id} goal={g} title={g.event} pb={personalBests.get(`${g.user_id} ${g.event}`)} action={actions(g)} />
            ))}
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <p className="section-label">
          みんなの目標（{new Set(goals.map((g) => g.user_id)).size}人・{goals.length}件）
        </p>
        <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-muted" />
          <Input
            className="pl-9"
            aria-label="目標を検索"
            placeholder="名前・種目・目標で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered && (
          <p className="text-micro text-muted" role="status">
            {visible.length}件を表示 / 全{goals.length}件
          </p>
        )}

        {eventNames.map((name) => {
          const rows = visible.filter((g) => g.event === name).sort(byName);
          return (
            <section key={name} aria-label={`${name}の目標`} className="space-y-1.5">
              <p className="flex items-baseline gap-2 text-caption font-semibold text-muted2">
                {name}
                <span className="font-normal text-muted">{rows.length}人</span>
              </p>
              <Card className="divide-y divide-separator">
                {rows.map((g) => (
                  <GoalRow
                    key={g.id}
                    goal={g}
                    title={g.author?.display_name ?? "部員"}
                    self={g.user_id === userId}
                    pb={personalBests.get(`${g.user_id} ${g.event}`)}
                    action={actions(g)}
                  />
                ))}
              </Card>
            </section>
          );
        })}

        {visible.length === 0 && (
          <p className="py-8 text-center text-body">
            {goals.length ? "条件に合う目標はありません" : "まだ目標はありません"}
          </p>
        )}
      </section>
    </div>
  );
}

/** 1件の目標。見出し（種目または名前）とPB、目標本文。長い目標は3行で畳む。 */
function GoalRow({
  goal,
  title,
  self = false,
  pb,
  action,
}: {
  goal: CompetitionGoalRow;
  title: string;
  self?: boolean;
  pb?: string;
  action: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const long = goal.target.length > 70 || goal.target.split("\n").length > 3;
  return (
    <div className="flex items-start gap-2 p-3.5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-headline">
          <span className="break-words">{title}</span>
          {self && <span className="text-micro font-normal text-accent">自分</span>}
          <span className="text-caption font-normal tabular-nums text-muted">{pb ? `PB ${pb}` : "PB未登録"}</span>
        </p>
        <p className={cn("mt-1 whitespace-pre-wrap break-words text-body", long && !open && "line-clamp-3")}>
          {goal.target}
        </p>
        {long && (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 py-1 text-caption text-accent">
            {open ? "閉じる" : "全文を表示"}
          </button>
        )}
      </div>
      {action}
    </div>
  );
}
