"use client";

import { useState } from "react";
import { Search, Settings2 } from "lucide-react";
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

export function CompetitionGoalBoard({
  goals,
  events,
  userId,
  meetName,
  personalBests,
  onEdit,
  onDelete,
  onManage,
  busy,
}: {
  goals: CompetitionGoalRow[];
  events: CompetitionEvent[];
  userId: string;
  meetName: string;
  personalBests: Map<string, string>;
  onEdit: (goal: CompetitionGoalRow) => void;
  onDelete: (id: string) => Promise<boolean>;
  onManage?: () => void;
  busy: boolean;
}) {
  const [block, setBlock] = useState<SimpleBlockFilter>("all");
  const [query, setQuery] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [ownOnly, setOwnOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const blockGoals = goals.filter((g) =>
    matchSimpleBlock(g.author?.blocks, block),
  );
  const eventNames = events
    .filter((e) => blockGoals.some((g) => g.event === e.name))
    .map((e) => e.name);
  const activeEvent = eventNames.includes(eventFilter) ? eventFilter : "";
  const needle = query.normalize("NFKC").toLocaleLowerCase().trim();
  const visible = blockGoals.filter(
    (g) =>
      (!activeEvent || g.event === activeEvent) &&
      (!ownOnly || g.user_id === userId) &&
      (!needle ||
        `${g.author?.display_name ?? "部員"} ${g.event} ${g.target}`
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const byName = (a: CompetitionGoalRow, b: CompetitionGoalRow) =>
    (a.author?.display_name ?? "部員").localeCompare(
      b.author?.display_name ?? "部員",
      "ja",
    ) || a.user_id.localeCompare(b.user_id);
  const groups = eventNames.map((name) => ({
    id: name,
    title: name,
    rows: visible.filter((g) => g.event === name).sort(byName),
  }));

  return (
    <div className="pb-20">
      <div className="sticky -top-3 z-10 -mx-4 space-y-2 border-b border-separator bg-bg px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-caption">
            {meetName} · {new Set(goals.map((g) => g.user_id)).size}人 /{" "}
            {goals.length}件
          </p>
          {onManage && (
            <button
              type="button"
              onClick={onManage}
              disabled={busy}
              className="flex shrink-0 items-center gap-1 py-2 text-[12px] text-muted"
            >
              <Settings2 size={14} />
              種目設定
            </button>
          )}
        </div>
        <SegmentedControl
          items={SIMPLE_BLOCK_ITEMS}
          value={block}
          onChange={(next) => {
            setBlock(next);
            setEventFilter("");
          }}
        />
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-3.5 text-muted"
          />
          <Input
            className="pl-9"
            aria-label="目標を検索"
            placeholder="名前・種目・目標で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="目標の種目"
            value={activeEvent}
            onChange={(e) => setEventFilter(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-separator bg-card px-2 text-base"
          >
            <option value="">すべての種目</option>
            {eventNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <button
            type="button"
            aria-pressed={ownOnly}
            onClick={() => setOwnOnly((v) => !v)}
            className={cn(
              "shrink-0 rounded-xl border px-3 py-2 text-[13px]",
              ownOnly
                ? "border-accent bg-accent/10 text-accent"
                : "border-separator text-muted",
            )}
          >
            自分のみ
          </button>
        </div>
      </div>
      <p className="py-3 text-[12px] text-muted" role="status">
        {visible.length}件を表示
        {needle || activeEvent || ownOnly || block !== "all"
          ? ` / 全${goals.length}件`
          : ""}
      </p>
      <div className="space-y-5">
        {groups
          .filter((group) => group.rows.length > 0)
          .map((group) => (
            <section key={group.id} aria-label={`${group.title}の目標`}>
              <h3 className="mb-2 flex items-center gap-2 text-headline">
                {group.title}
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-normal text-accent">
                  {group.rows.length}人
                </span>
              </h3>
              <div className="overflow-hidden rounded-xl border border-separator bg-card">
                <table className="w-full table-fixed border-collapse text-left">
                  <colgroup>
                    <col className="w-[30%] md:w-[24%]" />
                    <col />
                    <col className="w-10" />
                  </colgroup>
                  <thead className="border-b border-separator bg-bg">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-2 text-[11px] font-medium text-muted"
                      >
                        名前 / PB
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-[11px] font-medium text-muted"
                      >
                        目標
                      </th>
                      <th scope="col">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((g) => {
                      const long =
                        g.target.length > 70 || g.target.split("\n").length > 3;
                      const isExpanded = expanded.has(g.id);
                      const pb = personalBests.get(`${g.user_id} ${g.event}`);
                      return (
                        <tr
                          key={g.id}
                          className={cn(
                            "border-b border-separator/70 last:border-0",
                            g.user_id === userId
                              ? "bg-accent/[0.05]"
                              : "even:bg-bg/50",
                          )}
                        >
                          <th
                            scope="row"
                            className="break-words px-3 py-3 align-top text-[13px] font-medium leading-5"
                          >
                            {g.author?.display_name ?? "部員"}
                            {g.user_id === userId && (
                              <span className="mt-0.5 block text-[10px] font-normal text-accent">
                                自分
                              </span>
                            )}
                            <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-muted">
                              {pb ? `PB ${pb}` : "PB 未登録"}
                            </span>
                          </th>
                          <td className="px-2 py-3 align-top">
                            <p
                              className={cn(
                                "whitespace-pre-wrap break-words text-[14px] leading-5",
                                long && !isExpanded && "line-clamp-3",
                              )}
                            >
                              {g.target}
                            </p>
                            {long && (
                              <button
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() =>
                                  setExpanded((old) => {
                                    const next = new Set(old);
                                    if (next.has(g.id)) next.delete(g.id);
                                    else next.add(g.id);
                                    return next;
                                  })
                                }
                                className="mt-1 py-1 text-[12px] text-accent"
                              >
                                {isExpanded ? "閉じる" : "全文を表示"}
                              </button>
                            )}
                          </td>
                          <td className="py-1.5 pr-1 align-top">
                            {g.user_id === userId && (
                              <ActionMenu
                                triggerLabel={`${g.event}の目標の操作`}
                                onEdit={busy ? undefined : () => onEdit(g)}
                                onDelete={
                                  busy ? undefined : () => onDelete(g.id)
                                }
                                deleteTitle={`${g.event}の目標を削除しますか？`}
                                deleteDescription="この種目の目標だけを削除します。他の種目の目標は残ります。"
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </div>
      {visible.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-body">
            {goals.length
              ? "条件に合う目標はありません"
              : "まだ目標はありません"}
          </p>
          <p className="mt-2 text-caption">
            {goals.length
              ? "検索や絞り込みを変更してください。"
              : "右下の＋から、出場種目の目標を追加できます。"}
          </p>
        </div>
      )}
    </div>
  );
}
