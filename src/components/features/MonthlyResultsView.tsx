"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented";
import { SIMPLE_BLOCK_ITEMS, gradeShort, matchSimpleBlock, type SimpleBlockFilter } from "@/lib/constants";
import { formatRecord, formatWind, measureTypeOf, timeFormatOf } from "@/lib/competition-record";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { MonthlyResult } from "@/lib/queries";
import type { CompetitionRow } from "@/types";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal } from "@/components/ui/form-modal";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { ResultForm, type ResultFormHandle } from "@/components/post/ResultForm";

const PATH = "/mypage/monthly-results";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type ResultsPeriod =
  | { kind: "month"; value: string; current: string }
  | { kind: "year"; value: string; current: string }
  | { kind: "latest" };

const VIEW_ITEMS: { key: ResultsPeriod["kind"]; label: string }[] = [
  { key: "month", label: "月別" },
  { key: "year", label: "年別" },
  { key: "latest", label: "新着" },
];

/** 登録した日時（日本時間）を「9/26 14:05」の形に */
function formatAdded(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * 全員の大会・記録会の結果。月別・年別は大会（日付＋大会名）ごとにまとめて新しい日付を上に、
 * 新着は登録された日時の新しい順に並べる。各行の⋯から編集・削除できる。
 */
export function MonthlyResultsView({
  period,
  results: initialResults,
  events,
  competitions,
}: {
  period: ResultsPeriod;
  results: MonthlyResult[];
  events: CompetitionEvent[];
  competitions: CompetitionRow[];
}) {
  const [block, setBlock] = useState<SimpleBlockFilter>("all");
  const [results, setResults] = useState(initialResults);
  const [editing, setEditing] = useState<MonthlyResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const formRef = useRef<ResultFormHandle>(null);
  const router = useRouter();
  const { showToast } = useToast();
  async function remove(id: string) {
    const previous = results;
    setResults((rows) => rows.filter((r) => r.id !== id));
    const { error } = await createClient().from("pb_records").delete().eq("id", id);
    if (error) {
      setResults(previous);
      showToast("結果を削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }
  const visible = results.filter((r) => matchSimpleBlock(r.author?.blocks, block));
  const groups = new Map<string, { date: string; meet: string; rows: MonthlyResult[] }>();
  for (const r of visible) {
    const meet = r.competition?.name ?? r.meet_name ?? "大会名なし";
    // 同じ日に、大会を選んだ結果と同じ大会名を自由入力した結果は同じまとまりにする（全角半角・空白の違いは無視）
    const key = `${r.recorded_on} ${meet.normalize("NFKC").replace(/\s+/gu, "")}`;
    const group = groups.get(key) ?? { date: r.recorded_on ?? "", meet, rows: [] };
    group.rows.push(r);
    groups.set(key, group);
  }
  const eventIndex = (name: string) => {
    const i = events.findIndex((e) => e.name === name);
    return i < 0 ? events.length : i;
  };
  const sortInGroup = (a: MonthlyResult, b: MonthlyResult) =>
    eventIndex(a.event_name) - eventIndex(b.event_name) || (a.author?.display_name ?? "").localeCompare(b.author?.display_name ?? "", "ja");

  const row = (r: MonthlyResult, latest = false) => (
    <div key={r.id} className="flex items-center gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-headline break-words">
          <span className="mr-1.5 text-caption text-muted2">{gradeShort(r.author?.grade ?? null)}</span>
          {r.author?.display_name ?? "部員"}
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-caption">
          {r.event_name}
          {r.wind !== null && r.wind !== undefined && <span>風速 {formatWind(r.wind)}</span>}
          {r.is_pb && <span className="rounded border border-warning px-1 text-[10px] font-bold leading-tight text-warning">PB</span>}
          {r.is_ub && <span className="rounded border border-accent px-1 text-[10px] font-bold leading-tight text-accent">UB</span>}
          {r.is_official && <span className="rounded border border-success px-1 text-[10px] font-bold leading-tight text-success">公認</span>}
        </p>
        {latest && (
          <p className="mt-0.5 text-micro text-muted2">
            {r.stage === "pre_university" ? "高校以前" : r.recorded_on ? r.recorded_on.replaceAll("-", "/") : "日付なし"}
            {" ・ "}{r.competition?.name ?? r.meet_name ?? "大会名なし"}
            {" ・ "}<span className="tabular-nums">{formatAdded(r.created_at)}</span> 登録
          </p>
        )}
      </div>
      <span className="text-title tabular-nums">
        {formatRecord(r, measureTypeOf(events, r.event_name), timeFormatOf(events, r.event_name))}
      </span>
      <ActionMenu
        onEdit={() => setEditing(r)}
        onDelete={() => remove(r.id)}
        deleteDescription={`${r.author?.display_name ?? "部員"}さんの${r.event_name}の結果を削除します。元に戻せません。`}
        triggerLabel={`${r.author?.display_name ?? "部員"}の${r.event_name}の操作`}
      />
    </div>
  );

  let nav: { label: string; prev: string; next: string | null; reset: { href: string; label: string } | null } | null = null;
  if (period.kind === "month") {
    const [y, m] = period.value.split("-").map(Number);
    nav = {
      label: `${y}年${m}月`,
      prev: `${PATH}?month=${shiftMonth(period.value, -1)}`,
      next: period.value < period.current ? `${PATH}?month=${shiftMonth(period.value, 1)}` : null,
      reset: period.value !== period.current ? { href: PATH, label: "今月へ" } : null,
    };
  } else if (period.kind === "year") {
    const y = Number(period.value);
    nav = {
      label: `${y}年`,
      prev: `${PATH}?view=year&year=${y - 1}`,
      next: period.value < period.current ? `${PATH}?view=year&year=${y + 1}` : null,
      reset: period.value !== period.current ? { href: `${PATH}?view=year`, label: "今年へ" } : null,
    };
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-2">
      <SegmentedControl
        items={VIEW_ITEMS}
        value={period.kind}
        onChange={(kind) => router.push(kind === "month" ? PATH : `${PATH}?view=${kind}`)}
      />
      {nav && (
        <Card className="flex items-center gap-2 p-2">
          <Link href={nav.prev} aria-label="前へ" className="rounded-lg p-2 pressable">
            <ChevronLeft size={20} />
          </Link>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-headline">{nav.label}</p>
            {nav.reset && <Link href={nav.reset.href} className="text-caption text-accent">{nav.reset.label}</Link>}
          </div>
          {nav.next ? (
            <Link href={nav.next} aria-label="次へ" className="rounded-lg p-2 pressable">
              <ChevronRight size={20} />
            </Link>
          ) : (
            <span className="p-2 text-muted/40" aria-hidden><ChevronRight size={20} /></span>
          )}
        </Card>
      )}
      <SegmentedControl items={SIMPLE_BLOCK_ITEMS} value={block} onChange={setBlock} />
      <p className="text-caption">
        {period.kind === "latest"
          ? `新しく登録された順に${visible.length}件（最新50件から）`
          : `${visible.length}件（大学の結果で、記録日が入っているもの）`}
      </p>

      {period.kind === "latest" ? (
        visible.length === 0
          ? <Card><EmptyState title="結果はまだ登録されていません" /></Card>
          : <Card className="divide-y divide-separator">{visible.map((r) => row(r, true))}</Card>
      ) : groups.size === 0 ? (
        <Card><EmptyState title={period.kind === "year" ? "この年の大会・記録会の結果はありません" : "この月の大会・記録会の結果はありません"} /></Card>
      ) : (
        [...groups.values()].map((group) => (
          <section key={`${group.date} ${group.meet}`} className="space-y-1.5">
            <p className="flex items-baseline gap-2 text-caption font-semibold text-muted2">
              <span className="tabular-nums">{Number(group.date.slice(5, 7))}/{Number(group.date.slice(8, 10))}</span>
              <span className="min-w-0 break-words">{group.meet}</span>
              <span className="font-normal text-muted">{group.rows.length}件</span>
            </p>
            <Card className="divide-y divide-separator">{group.rows.sort(sortInGroup).map((r) => row(r))}</Card>
          </section>
        ))
      )}

      {editing && (
        <FormModal
          open
          onOpenChange={(next) => { if (!next) { if (dirty) setConfirmClose(true); else setEditing(null); } }}
          title={`${editing.author?.display_name ?? "部員"}さんの結果を編集`}
        >
          <ResultForm
            ref={formRef}
            key={editing.id}
            onDirtyChange={setDirty}
            userId={editing.user_id}
            events={events}
            competitions={competitions}
            initial={editing}
            onDone={(saved) => {
              if (saved) {
                // 大会名は選び直した大会から引き直す（一覧のまとまりが変わるため）
                const competition = competitions.find((c) => c.id === saved.competition_id);
                // 月別・年別では、高校以前に変えた・別の期間へ日付を変えたものを一覧から外す
                const stays = period.kind === "latest" || (saved.stage === "university" && (saved.recorded_on ?? "").startsWith(period.value));
                setResults((rows) => rows.flatMap((r) => (r.id !== saved.id ? [r]
                  : stays ? [{ ...r, ...saved, competition: competition ? { name: competition.name } : null }] : [])));
                router.refresh();
              }
              setDirty(false);
              setEditing(null);
            }}
          />
        </FormModal>
      )}
      <UnsavedChangesDialog open={confirmClose} busy={false} intent="update" onContinue={() => setConfirmClose(false)} onDiscard={() => { setDirty(false); setConfirmClose(false); setEditing(null); }} onSave={() => { setConfirmClose(false); formRef.current?.save(); }} />
    </div>
  );
}
