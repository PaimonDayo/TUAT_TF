"use client";
import { useEffect, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { createClient } from "@/lib/supabase/client";
import { competitionDays } from "@/lib/competition";
import {
  normalizeGoalDrafts,
  sortCompetitionEvents,
  type GoalDraft,
  type CompetitionEvent,
} from "@/lib/competition-goals";
import { CompetitionGoalBoard } from "./CompetitionGoalBoard";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import type { Block } from "@/types";
import { jstToday } from "@/lib/date";
import { useToast } from "@/components/ui/toast";

export type CompetitionGoal = {
  id: string;
  user_id: string;
  event: string;
  target: string;
  author: { display_name: string; blocks: Block[] | null } | null;
};
const selectClass =
  "w-full rounded-xl border border-separator bg-card p-3 text-base";
export function CompetitionHome({
  competition,
  initialGoals,
  initialEvents,
  userId,
  displayName,
  viewerBlocks,
  canManage,
  initialToday,
}: {
  competition: { id: string; name: string; starts_on: string };
  initialGoals: CompetitionGoal[];
  initialEvents: CompetitionEvent[];
  userId: string;
  displayName: string;
  viewerBlocks: Block[];
  canManage: boolean;
  initialToday: string;
}) {
  const { showToast } = useToast();
  const [meet, setMeet] = useState(competition);
  const [goals, setGoals] = useState(initialGoals);
  const [catalog, setCatalog] = useState(initialEvents);
  const [today, setToday] = useState(initialToday);
  const [view, setView] = useState<"goals" | "edit" | "date" | "events" | null>(
    null,
  );
  const [drafts, setDrafts] = useState<GoalDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftBaseline, setDraftBaseline] = useState("");
  const [pendingExit, setPendingExit] = useState<"goals" | "close" | null>(
    null,
  );
  const [date, setDate] = useState(meet.starts_on);
  const [eventDraft, setEventDraft] = useState<CompetitionEvent>({
    name: "",
    sort_order: 0,
  });
  const [originalEvent, setOriginalEvent] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(jstToday());
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const days = competitionDays(meet.starts_on, today);
  const events = sortCompetitionEvents(catalog);
  const ownGoals = goals.filter((g) => g.user_id === userId);
  const people = new Set(goals.map((g) => g.user_id)).size;
  function open(next: typeof view) {
    setError("");
    setView(next);
  }
  function edit(goal?: CompetitionGoal) {
    const nextDrafts = goal
      ? [{ event: goal.event, target: goal.target }]
      : [{ event: "", target: "" }];
    setEditingId(goal?.id ?? null);
    setDrafts(nextDrafts);
    setDraftBaseline(JSON.stringify(nextDrafts));
    open("edit");
  }
  function leaveEditor(next: "goals" | "close") {
    if (busy) return;
    if (JSON.stringify(drafts) !== draftBaseline) setPendingExit(next);
    else open(next === "close" ? null : "goals");
  }
  async function saveGoals() {
    setBusy(true);
    setError("");
    try {
      const rows = normalizeGoalDrafts(drafts);
      if (rows.some((row) => !catalog.some((e) => e.name === row.event)))
        throw new Error("種目を選択してください");
      const sb = createClient();
      const { data, error } = editingId
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
                competition_id: meet.id,
                user_id: userId,
              })),
            )
            .select("id,user_id,event,target");
      if (error || data?.length !== rows.length)
        throw new Error("目標を保存できませんでした。入力内容は残っています。");
      setGoals((old) => [
        ...old.filter((g) => !data.some((saved) => saved.id === g.id)),
        ...data.map((g) => ({
          ...g,
          author: { display_name: displayName, blocks: viewerBlocks },
        })),
      ]);
      showToast(
        editingId ? "目標を更新しました" : "目標を追加しました",
        "success",
      );
      open(pendingExit === "close" ? null : "goals");
      setPendingExit(null);
    } catch (e) {
      setPendingExit(null);
      setError(e instanceof Error ? e.message : "目標を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  async function removeGoal(id: string) {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient()
        .from("competition_goals")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id");
      if (error || !data?.length) throw error;
      setGoals((old) => old.filter((g) => g.id !== id));
      return true;
    } catch {
      setError("目標を削除できませんでした");
      showToast("目標を削除できませんでした", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveDate() {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient()
        .from("competitions")
        .update({ starts_on: date })
        .eq("id", meet.id)
        .select("id,name,starts_on")
        .single();
      if (error || !data) throw error;
      setMeet(data);
      setView(null);
    } catch {
      setError("開催日を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  async function saveEvent() {
    const name = eventDraft.name.trim();
    if (
      !name ||
      !Number.isInteger(eventDraft.sort_order) ||
      eventDraft.sort_order < 0
    ) {
      setError("種目名と0以上の表示順を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const sb = createClient();
      const payload = { name, sort_order: eventDraft.sort_order };
      const result =
        originalEvent === null
          ? await sb
              .from("competition_events")
              .insert(payload)
              .select()
              .single()
          : await sb
              .from("competition_events")
              .update(payload)
              .eq("name", originalEvent)
              .select()
              .single();
      if (result.error || !result.data) throw result.error;
      setCatalog((old) => [
        ...old.filter((e) => e.name !== originalEvent),
        result.data,
      ]);
      if (originalEvent !== null) {
        setGoals((old) =>
          old.map((g) =>
            g.event === originalEvent ? { ...g, event: name } : g,
          ),
        );
      }
      setOriginalEvent(null);
      setEventDraft({ name: "", sort_order: eventDraft.sort_order + 10 });
    } catch {
      setError(
        "種目を保存できませんでした。同じ名前の種目がないか確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function removeEvent(name: string) {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient()
        .from("competition_events")
        .delete()
        .eq("name", name)
        .select("name");
      if (error || !data?.length) throw error;
      setCatalog((old) => old.filter((e) => e.name !== name));
      if (originalEvent === name) {
        setOriginalEvent(null);
        setEventDraft({ name: "", sort_order: 0 });
      }
    } catch {
      setError(
        "種目を削除できませんでした。目標が登録されている種目は削除できません。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="大会とみんなの目標">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <button
            type="button"
            className="w-full p-4 text-left active:opacity-70"
            onClick={() => {
              setDate(meet.starts_on);
              open("date");
            }}
            aria-label={`${meet.name}の開催情報`}
          >
            <p className="flex items-center justify-between gap-1 text-caption">
              <span>{meet.name}まで</span>
              <ChevronRight size={14} className="shrink-0" />
            </p>
            <p className="mt-1 text-large-title tabular-nums">
              {days >= 0 ? (
                <>
                  {days}
                  <span className="ml-1 text-body text-muted">日</span>
                </>
              ) : (
                <span className="text-title2">開幕しました</span>
              )}
            </p>
          </button>
        </Card>
        <Card>
          <button
            type="button"
            className="w-full p-4 text-left active:opacity-70"
            onClick={() => open("goals")}
            aria-label="みんなの目標を開く"
          >
            <p className="flex items-center justify-between gap-1 text-caption">
              <span>みんなの目標</span>
              <ChevronRight size={14} className="shrink-0" />
            </p>
            <p className="mt-1 text-large-title tabular-nums">
              {people}
              <span className="ml-1 text-body text-muted">人</span>
            </p>
          </button>
        </Card>
      </div>
      <FormModal
        autoFocus={false}
        floatingAction={
          view === "goals" ? (
            <button
              type="button"
              aria-label="目標を追加"
              title={
                ownGoals.length >= catalog.length
                  ? "すべての種目に目標を設定済みです"
                  : "目標を追加"
              }
              disabled={busy || ownGoals.length >= catalog.length}
              onClick={() => edit()}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-xl active:scale-95 disabled:opacity-40"
            >
              <Plus size={26} />
            </button>
          ) : undefined
        }
        open={view !== null}
        onOpenChange={(value) => {
          if (!busy && !value) {
            if (view === "edit") leaveEditor("close");
            else setView(null);
          }
        }}
        title={
          view === "date"
            ? `${meet.name}の開催情報`
            : view === "events"
              ? "大会の種目を管理"
              : view === "edit"
                ? editingId
                  ? "目標を編集"
                  : "目標を追加"
                : "みんなの目標"
        }
      >
        <div className="space-y-4 pb-4">
          {view === "date" && (
            <>
              <p className="text-body">
                初日: {meet.starts_on.replaceAll("-", "/")}
              </p>
              <p className="text-caption">
                大会初日を0日として数えます。
                {days === 0 ? "本日開幕です。" : ""}
              </p>
              {canManage && (
                <>
                  <label className="block text-body">
                    大会初日
                    <Input
                      type="date"
                      value={date}
                      disabled={busy}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <FormModalFooter>
                    <Button
                      size="lg"
                      disabled={busy || !date}
                      onClick={() => void saveDate()}
                    >
                      {busy ? "保存中…" : "保存する"}
                    </Button>
                  </FormModalFooter>
                </>
              )}
            </>
          )}
          <div hidden={view !== "goals"}>
            <CompetitionGoalBoard
              goals={goals}
              events={events}
              userId={userId}
              meetName={meet.name}
              onEdit={edit}
              onDelete={removeGoal}
              busy={busy}
              onManage={
                canManage
                  ? () => {
                      setOriginalEvent(null);
                      setEventDraft({
                        name: "",
                        sort_order:
                          Math.max(0, ...catalog.map((e) => e.sort_order)) + 10,
                      });
                      open("events");
                    }
                  : undefined
              }
            />
          </div>
          {view === "edit" && (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => leaveEditor("goals")}
              >
                一覧に戻る
              </Button>
              <p className="text-caption">
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
                      {events
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
                  disabled={
                    busy || drafts.length >= events.length - ownGoals.length
                  }
                  onClick={() =>
                    setDrafts((old) => [...old, { event: "", target: "" }])
                  }
                >
                  <Plus size={16} />
                  種目を追加
                </Button>
              )}
              <p className="text-caption">
                プロフィールの目標とは別に保存します。
              </p>
              <FormModalFooter>
                <Button
                  size="lg"
                  disabled={busy || !events.length}
                  onClick={() => void saveGoals()}
                >
                  {busy
                    ? "保存中…"
                    : editingId
                      ? "変更を保存する"
                      : "目標を追加する"}
                </Button>
              </FormModalFooter>
            </>
          )}
          {view === "events" && canManage && (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => open("goals")}
              >
                一覧に戻る
              </Button>
              <p className="text-caption">
                種目名の変更は登録済みの目標にも反映します。目標がある種目は削除できません。
              </p>
              <Card className="space-y-3 p-3">
                <h3 className="text-headline">
                  {originalEvent === null ? "種目を追加" : "種目を編集"}
                </h3>
                <label className="block text-body">
                  種目名
                  <Input
                    maxLength={50}
                    value={eventDraft.name}
                    disabled={busy}
                    onChange={(e) =>
                      setEventDraft((old) => ({ ...old, name: e.target.value }))
                    }
                  />
                </label>
                <label className="block text-body">
                  表示順（小さい順）
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={eventDraft.sort_order}
                    disabled={busy}
                    onChange={(e) =>
                      setEventDraft((old) => ({
                        ...old,
                        sort_order: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <Button disabled={busy} onClick={() => void saveEvent()}>
                  {busy ? "保存中…" : "種目を保存する"}
                </Button>
                {originalEvent !== null && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setOriginalEvent(null);
                      setEventDraft({
                        name: "",
                        sort_order:
                          Math.max(0, ...catalog.map((e) => e.sort_order)) + 10,
                      });
                    }}
                  >
                    追加に切り替える
                  </Button>
                )}
              </Card>
              {events.map((e) => (
                <div
                  key={e.name}
                  className="flex items-center justify-between gap-2 border-b border-separator py-2"
                >
                  <span className="min-w-0 break-words text-body">
                    {e.name}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setOriginalEvent(e.name);
                        setEventDraft(e);
                      }}
                    >
                      編集
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || goals.some((g) => g.event === e.name)}
                      onClick={() => void removeEvent(e.name)}
                    >
                      削除
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
        </div>
      </FormModal>
      <UnsavedChangesDialog
        open={pendingExit !== null}
        busy={busy}
        onContinue={() => setPendingExit(null)}
        onDiscard={() => {
          open(pendingExit === "close" ? null : "goals");
          setPendingExit(null);
        }}
        onSave={() => void saveGoals()}
      />
    </section>
  );
}
