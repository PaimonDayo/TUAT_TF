"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { formatRecord, measureTypeOf } from "@/lib/competition-record";
import {
  normalizeGoalDrafts,
  sortCompetitionEvents,
  type CompetitionEvent,
  type GoalDraft,
} from "@/lib/competition-goals";
import { cn } from "@/lib/utils";
import { CompetitionGoalBoard } from "./CompetitionGoalBoard";
import type {
  Block,
  CompetitionGoalRow,
  CompetitionRow,
  PersonalBestRow,
} from "@/types";

const selectClass = "w-full rounded-xl border border-separator bg-card p-3 text-base";

/** 大会ごとの目標ページ（全画面）。大会の切替・一覧・自分の目標の追加編集 */
export function CompetitionGoalsView({
  competition,
  competitions,
  initialGoals,
  events,
  personalBests,
  userId,
  displayName,
  viewerBlocks,
}: {
  competition: CompetitionRow;
  competitions: CompetitionRow[];
  initialGoals: CompetitionGoalRow[];
  events: CompetitionEvent[];
  personalBests: PersonalBestRow[];
  userId: string;
  displayName: string;
  viewerBlocks: Block[];
}) {
  const { showToast } = useToast();
  const [goals, setGoals] = useState(initialGoals);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<GoalDraft[]>([]);
  const [baseline, setBaseline] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ordered = sortCompetitionEvents(events);
  const ownGoals = goals.filter((g) => g.user_id === userId);
  const bestByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of personalBests) {
      const text = formatRecord(row, measureTypeOf(events, row.event_name));
      if (text) map.set(`${row.user_id} ${row.event_name}`, text);
    }
    return map;
  }, [personalBests, events]);

  function openEditor(goal?: CompetitionGoalRow) {
    const next = goal
      ? [{ event: goal.event, target: goal.target }]
      : [{ event: "", target: "" }];
    setEditingId(goal?.id ?? null);
    setDrafts(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setEditorOpen(true);
  }

  function requestClose() {
    if (busy) return;
    if (JSON.stringify(drafts) !== baseline) setConfirmClose(true);
    else setEditorOpen(false);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const rows = normalizeGoalDrafts(drafts);
      if (rows.some((row) => !events.some((e) => e.name === row.event)))
        throw new Error("種目を選択してください");
      const sb = createClient();
      const { data, error: saveError } = editingId
        ? await sb
            .from("competition_goals")
            .update(rows[0])
            .eq("id", editingId)
            .eq("user_id", userId)
            .select("id,user_id,event,target")
        : await sb
            .from("competition_goals")
            .insert(
              rows.map((row) => ({
                ...row,
                competition_id: competition.id,
                user_id: userId,
              })),
            )
            .select("id,user_id,event,target");
      if (saveError || data?.length !== rows.length)
        throw new Error("目標を保存できませんでした。入力内容は残っています。");
      setGoals((old) => [
        ...old.filter((g) => !data.some((saved) => saved.id === g.id)),
        ...data.map((g) => ({ ...g, author: { display_name: displayName, blocks: viewerBlocks } })),
      ]);
      showToast(editingId ? "目標を更新しました" : "目標を追加しました", "success");
      setConfirmClose(false);
      setEditorOpen(false);
    } catch (e) {
      setConfirmClose(false);
      setError(e instanceof Error ? e.message : "目標を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const { data, error: deleteError } = await createClient()
        .from("competition_goals")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id");
      if (deleteError || !data?.length) throw deleteError;
      setGoals((old) => old.filter((g) => g.id !== id));
      return true;
    } catch {
      showToast("目標を削除できませんでした", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pb-24">
      {competitions.length > 1 && (
        <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
          {competitions.map((item) => (
            <Link
              key={item.id}
              href={`/competitions/${item.id}/goals`}
              aria-current={item.id === competition.id ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[13px]",
                item.id === competition.id
                  ? "border-accent bg-accent/10 font-semibold text-accent"
                  : "border-separator text-muted",
              )}
            >
              {item.name}
            </Link>
          ))}
        </div>
      )}

      <CompetitionGoalBoard
        goals={goals}
        events={ordered}
        userId={userId}
        personalBests={bestByKey}
        meetName={competition.name}
        onEdit={openEditor}
        onDelete={remove}
        busy={busy}
      />

      <button
        type="button"
        aria-label="目標を追加"
        title={
          ownGoals.length >= events.length
            ? "すべての種目に目標を設定済みです"
            : "目標を追加"
        }
        disabled={busy || ownGoals.length >= events.length}
        onClick={() => openEditor()}
        className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-xl disabled:opacity-40"
      >
        <Plus size={26} />
      </button>

      <FormModal
        open={editorOpen}
        autoFocus={false}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        title={editingId ? "目標を編集" : "目標を追加"}
      >
        <div className="space-y-4 pb-4">
          <p className="text-caption">
            {competition.name}の目標です。
            {editingId
              ? "この種目の目標を編集します。"
              : "出場する種目を選んで目標を入力してください。複数種目をまとめて追加できます。"}
          </p>
          {drafts.map((row, index) => (
            <Card key={index} className="space-y-3 p-3">
              <label className="block text-body">
                種目{index + 1}
                <select
                  className={selectClass}
                  value={row.event}
                  disabled={busy}
                  onChange={(e) =>
                    setDrafts((old) =>
                      old.map((r, i) =>
                        i === index ? { ...r, event: e.target.value } : r,
                      ),
                    )
                  }
                >
                  <option value="">種目を選択</option>
                  {ordered
                    .filter(
                      (e) =>
                        e.name === row.event ||
                        (!drafts.some((r) => r.event === e.name) &&
                          !ownGoals.some(
                            (g) => g.id !== editingId && g.event === e.name,
                          )),
                    )
                    .map((e) => (
                      <option key={e.name}>{e.name}</option>
                    ))}
                </select>
              </label>
              <label className="block text-body">
                目標
                <Textarea
                  rows={3}
                  maxLength={300}
                  value={row.target}
                  disabled={busy}
                  placeholder="例: 4分10秒・決勝進出"
                  onChange={(e) =>
                    setDrafts((old) =>
                      old.map((r, i) =>
                        i === index ? { ...r, target: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              {!editingId && drafts.length > 1 && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setDrafts((old) => old.filter((_, i) => i !== index))
                  }
                >
                  この入力欄を外す
                </Button>
              )}
            </Card>
          ))}
          {!editingId && (
            <Button
              variant="secondary"
              disabled={busy || drafts.length >= events.length - ownGoals.length}
              onClick={() => setDrafts((old) => [...old, { event: "", target: "" }])}
            >
              <Plus size={16} />
              種目を追加
            </Button>
          )}
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
          <FormModalFooter>
            <Button size="lg" disabled={busy || !events.length} onClick={() => void save()}>
              {busy ? "保存中…" : editingId ? "変更を保存する" : "目標を追加する"}
            </Button>
          </FormModalFooter>
        </div>
      </FormModal>

      <UnsavedChangesDialog
        open={confirmClose}
        busy={busy}
        onContinue={() => setConfirmClose(false)}
        onDiscard={() => {
          setConfirmClose(false);
          setEditorOpen(false);
        }}
        onSave={() => void save()}
      />
    </div>
  );
}
