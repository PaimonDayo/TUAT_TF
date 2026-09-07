"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormModal } from "@/components/ui/form-modal";
import { createClient } from "@/lib/supabase/client";
import { ALL_PROFILE_EVENTS } from "@/lib/constants";
import { competitionDays } from "@/lib/competition";
import { jstToday } from "@/lib/date";

export type CompetitionGoal = {
  id: string;
  user_id: string;
  event: string;
  target: string;
  author: { display_name: string } | null;
};
export function CompetitionHome({
  competition,
  initialGoals,
  userId,
  displayName,
  canManage,
  initialToday,
}: {
  competition: { id: string; name: string; starts_on: string };
  initialGoals: CompetitionGoal[];
  userId: string;
  displayName: string;
  canManage: boolean;
  initialToday: string;
}) {
  const [meet, setMeet] = useState(competition);
  const [goals, setGoals] = useState(initialGoals);
  const [today, setToday] = useState(initialToday);
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [date, setDate] = useState(meet.starts_on);
  useEffect(() => {
    const update = () => setToday(jstToday());
    // Calendar-only timer; no network polling.
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const days = competitionDays(meet.starts_on, today);
  const events = [...new Set(goals.map((g) => g.event))].sort((a, b) =>
    a.localeCompare(b, "ja", { numeric: true }),
  );
  async function save() {
    if (!event.trim() || !target.trim()) {
      setError("種目と目標を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient()
        .from("competition_goals")
        .upsert(
          {
            competition_id: meet.id,
            user_id: userId,
            event: event.trim(),
            target: target.trim(),
          },
          { onConflict: "competition_id,user_id,event" },
        )
        .select("id,user_id,event,target")
        .single();
      if (error || !data) throw error;
      setGoals((old) => [
        ...old.filter((g) => !(g.user_id === userId && g.event === data.event)),
        { ...data, author: { display_name: displayName } },
      ]);
      setOpen(false);
    } catch {
      setError("目標を保存できませんでした。入力内容は残っています。");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
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
    } catch {
      setError("目標を削除できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="大会とみんなの目標">
      <Card className="space-y-2 p-4">
        <p className="section-label">{meet.name}まで</p>
        <p className="text-large-title tabular-nums">
          {days > 0
            ? `あと${days}日`
            : days === 0
              ? "あと0日・本日開幕"
              : "開幕しました"}
        </p>
        <p className="text-caption">
          初日 {meet.starts_on.replaceAll("-", "/")}
        </p>
        {canManage && (
          <details>
            <summary className="text-caption cursor-pointer">
              開催日を変更
            </summary>
            <div className="mt-2 flex gap-2">
              <Input
                aria-label="大会初日"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <Button
                disabled={busy || !date}
                onClick={async () => {
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
                  } catch {
                    setError("開催日を保存できませんでした");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存する
              </Button>
            </div>
          </details>
        )}
      </Card>
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-headline">みんなの目標</h2>
          <Button
            onClick={() => {
              setEvent("");
              setTarget("");
              setError("");
              setOpen(true);
            }}
          >
            自分の目標を設定
          </Button>
        </div>
        <p className="text-caption">
          {meet.name}
          に向けた種目別の目標です。プロフィールの目標とは別に設定できます。
        </p>
        {events.length > 0 && (
          <select
            aria-label="目標の種目"
            className="w-full rounded-lg border border-separator bg-card p-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">すべての種目</option>
            {events.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        )}
        {goals.length === 0 ? (
          <p className="text-caption">まだ目標はありません</p>
        ) : (
          <div className="max-h-80 space-y-4 overflow-y-auto">
            {events
              .filter((e) => !filter || filter === e)
              .map((e) => (
                <div key={e}>
                  <h3 className="font-bold text-accent">{e}</h3>
                  {goals
                    .filter((g) => g.event === e)
                    .sort((a, b) =>
                      (a.author?.display_name ?? "").localeCompare(
                        b.author?.display_name ?? "",
                        "ja",
                      ),
                    )
                    .map((g) => (
                      <div
                        key={g.id}
                        className="border-b border-separator py-2"
                      >
                        <p className="text-caption">
                          {g.author?.display_name ?? "部員"}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-body">
                          {g.target}
                        </p>
                        {g.user_id === userId && (
                          <div className="mt-1 flex gap-3">
                            <button
                              className="text-caption text-accent"
                              disabled={busy}
                              onClick={() => {
                                setEvent(g.event);
                                setTarget(g.target);
                                setOpen(true);
                              }}
                            >
                              編集
                            </button>
                            <button
                              className="text-caption text-muted"
                              disabled={busy}
                              onClick={() => void remove(g.id)}
                            >
                              削除
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              ))}
          </div>
        )}
        {error && (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        )}
      </Card>
      <FormModal
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
        title="大会の目標を設定"
      >
        <div className="space-y-4 pb-4">
          <label className="block">
            種目
            <Input
              list="competition-events"
              maxLength={50}
              value={event}
              onChange={(e) => {
                const v = e.target.value;
                setEvent(v);
                setTarget(
                  goals.find((g) => g.user_id === userId && g.event === v)
                    ?.target ?? "",
                );
              }}
              placeholder="例: 1500m"
            />
            <datalist id="competition-events">
              {ALL_PROFILE_EVENTS.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </label>
          <label className="block">
            目標
            <Textarea
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              maxLength={300}
              rows={4}
              placeholder="例: 4分10秒・決勝進出"
            />
          </label>
          <p className="text-caption">
            同じ種目を選ぶと、その種目の目標を更新します。
          </p>
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "保存中…" : "保存する"}
          </Button>
        </div>
      </FormModal>
    </section>
  );
}
