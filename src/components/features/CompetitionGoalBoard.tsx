"use client";

import { useState } from "react";
import { Search, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ActionMenu } from "@/components/ui/action-menu";
import { cn } from "@/lib/utils";
import type { CompetitionEvent, EventOrder } from "@/lib/competition-goals";
import type { CompetitionGoal } from "./CompetitionHome";

export function CompetitionGoalBoard({
  goals,
  events,
  userId,
  meetName,
  order,
  onOrder,
  onEdit,
  onDelete,
  onManage,
  busy,
}: {
  goals: CompetitionGoal[];
  events: CompetitionEvent[];
  userId: string;
  meetName: string;
  order: EventOrder;
  onOrder: (order: EventOrder) => void;
  onEdit: (goal: CompetitionGoal) => void;
  onDelete: (id: string) => Promise<boolean>;
  onManage?: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"event" | "person">("event");
  const [query, setQuery] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [ownOnly, setOwnOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const eventNames = events
    .filter((e) => goals.some((g) => g.event === e.name))
    .map((e) => e.name);
  const activeEvent = eventNames.includes(eventFilter) ? eventFilter : "";
  const needle = query.normalize("NFKC").toLocaleLowerCase().trim();
  const visible = goals.filter(
    (g) =>
      (!activeEvent || g.event === activeEvent) &&
      (!ownOnly || g.user_id === userId) &&
      (!needle ||
        `${g.author?.display_name ?? "部員"} ${g.event} ${g.target}`
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const eventIndex = new Map(events.map((e, i) => [e.name, i]));
  const byName = (a: CompetitionGoal, b: CompetitionGoal) =>
    (a.author?.display_name ?? "部員").localeCompare(
      b.author?.display_name ?? "部員",
      "ja",
    ) || a.user_id.localeCompare(b.user_id);
  const groups =
    mode === "event"
      ? eventNames.map((name) => ({
          id: name,
          title: name,
          rows: visible.filter((g) => g.event === name).sort(byName),
        }))
      : [
          ...new Map(
            [...visible].sort(byName).map((g) => [g.user_id, g]),
          ).values(),
        ].map((g) => ({
          id: g.user_id,
          title: g.author?.display_name ?? "部員",
          rows: visible
            .filter((row) => row.user_id === g.user_id)
            .sort(
              (a, b) =>
                (eventIndex.get(a.event) ?? Infinity) -
                (eventIndex.get(b.event) ?? Infinity),
            ),
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
        <div className="flex items-center gap-2">
          <div
            className="flex min-w-0 flex-1 rounded-xl bg-separator/50 p-0.5"
            aria-label="目標の表示方法"
          >
            {(
              [
                { value: "event", label: "種目別" },
                { value: "person", label: "部員別" },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={mode === item.value}
                onClick={() => setMode(item.value)}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold",
                  mode === item.value
                    ? "bg-card text-ink shadow-sm"
                    : "text-muted",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
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
        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="目標の種目"
            value={activeEvent}
            onChange={(e) => setEventFilter(e.target.value)}
            className="h-10 min-w-0 rounded-xl border border-separator bg-card px-2 text-base"
          >
            <option value="">すべての種目</option>
            {eventNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            aria-label="種目の並び順"
            value={order}
            onChange={(e) => onOrder(e.target.value as EventOrder)}
            className="h-10 min-w-0 rounded-xl border border-separator bg-card px-2 text-base"
          >
            <option value="standard">標準の順番</option>
            <option value="middle_long">中長距離を先に</option>
            <option value="short">短距離を先に</option>
          </select>
        </div>
      </div>
      <p className="py-3 text-[12px] text-muted" role="status">
        {visible.length}件を表示
        {needle || activeEvent || ownOnly ? ` / 全${goals.length}件` : ""}
      </p>
      <div className="space-y-5">
        {groups
          .filter((group) => group.rows.length > 0)
          .map((group) => (
            <section key={group.id} aria-label={`${group.title}の目標`}>
              <h3 className="mb-2 flex items-center gap-2 text-headline">
                {group.title}
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-normal text-accent">
                  {group.rows.length}
                  {mode === "event" ? "人" : "種目"}
                </span>
                {mode === "person" && group.id === userId && (
                  <span className="text-[11px] font-normal text-muted">
                    自分
                  </span>
                )}
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
                        {mode === "event" ? "名前" : "種目"}
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
                            {mode === "event"
                              ? (g.author?.display_name ?? "部員")
                              : g.event}
                            {mode === "event" && g.user_id === userId && (
                              <span className="mt-0.5 block text-[10px] font-normal text-accent">
                                自分
                              </span>
                            )}
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
