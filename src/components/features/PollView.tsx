"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Check, Plus } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";
import type { TweetPollVoter } from "@/types";

/**
 * 投票の表示と操作。つぶやきとノート記事で同じ見た目・同じ操作にするため、
 * 保存先（どの表に書くか）だけを api で受け取り、この部品は表を知らない。
 */
export type PollOption = {
  id: string;
  text: string;
  created_by: string;
  sort_order: number;
  vote_count: number;
  voted_by_me: boolean;
  voters: TweetPollVoter[];
};

export type PollApi = {
  /** 1票入れる。失敗したら false（画面は元に戻す） */
  addVote: (optionId: string) => Promise<boolean>;
  /** 単一選択で入れ替えるときなどに、自分の票を外す */
  removeVotes: (optionIds: string[]) => Promise<boolean>;
  /** 選択肢を追加する。保存できたら追加された選択肢を返す */
  addOption: (text: string, sortOrder: number) => Promise<PollOption | null>;
};

function PollOptionTabs({
  options,
  value,
  onChange,
  panelId,
}: {
  options: PollOption[];
  value: string;
  onChange: (optionId: string) => void;
  panelId: string;
}) {
  const newUi = useSystemGlass();
  return (
    <div
      data-ui-group="segmented"
      role="tablist"
      aria-label="投票の選択肢"
      className="flex h-9 snap-x snap-mandatory gap-1 overflow-x-auto rounded-[10px] bg-[#e9e9eb] p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            data-ui-action
            key={option.id}
            type="button"
            role="tab"
            id={`${panelId}-tab-${option.id}`}
            aria-controls={panelId}
            aria-selected={active}
            tabIndex={newUi ? (active ? 0 : -1) : undefined}
            title={option.text}
            onClick={(event) => {
              onChange(option.id);
              event.currentTarget.scrollIntoView({ behavior: newUi && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
            }}
            onKeyDown={(event) => {
              if (!newUi || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = options.findIndex((item) => item.id === option.id);
              const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
              onChange(options[next].id);
              const button = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[next];
              button?.focus({ preventScroll: true });
              button?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
            }}
            className={cn(
              "h-8 min-w-24 max-w-44 shrink-0 snap-center truncate rounded-[8px] px-3 text-[13px] font-semibold transition-colors pressable",
              active ? "bg-white text-ink shadow-sm" : "text-muted2",
            )}
          >
            {option.text} <span className="tabular-nums">{option.vote_count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PollView({
  api,
  userId,
  userName,
  userAvatarUrl,
  userBlocks,
  userGrade,
  options: initialOptions,
  multiple,
  anonymous,
  allowOptions,
}: {
  api: PollApi;
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
  userBlocks: import("@/types").Block[];
  userGrade: string | null;
  options: PollOption[];
  multiple: boolean;
  anonymous: boolean;
  allowOptions: boolean;
}) {
  const newUi = useSystemGlass();
  const panelId = useId();
  const { showToast } = useToast();
  const pending = useRef(false);
  const [options, setOptions] = useState(initialOptions);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [detailOptionId, setDetailOptionId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressVote = useRef(false);
  const detailOption = options.find((option) => option.id === detailOptionId) ?? options[0];
  const pollRef = useRef<HTMLElement>(null);
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);
  useEffect(() => {
    const root = pollRef.current;
    if (!root) return;
    const preventNativeSelection = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("input, textarea")) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    };
    root.addEventListener("selectstart", preventNativeSelection);
    root.addEventListener("contextmenu", preventNativeSelection);
    root.addEventListener("dragstart", preventNativeSelection);
    return () => {
      root.removeEventListener("selectstart", preventNativeSelection);
      root.removeEventListener("contextmenu", preventNativeSelection);
      root.removeEventListener("dragstart", preventNativeSelection);
    };
  }, []);

  function startLongPress(optionId: string) {
    if (anonymous) return;
    suppressVote.current = false;
    longPressTimer.current = setTimeout(() => {
      suppressVote.current = true;
      setDetailOptionId(optionId);
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }

  function handleOptionClick(optionId: string) {
    cancelLongPress();
    if (suppressVote.current) {
      suppressVote.current = false;
      return;
    }
    void vote(optionId);
  }
  const totalVotes = options.reduce((sum, option) => sum + option.vote_count, 0);

  function removeLocalVotes(ids: string[]) {
    setOptions((items) => items.map((item) => ids.includes(item.id) ? {
      ...item, voted_by_me: false, vote_count: Math.max(0, item.vote_count - 1),
      voters: item.voters.filter((voter) => voter.profile_id !== userId),
    } : item));
  }

  async function vote(optionId: string) {
    if (pending.current) return;
    const target = options.find((option) => option.id === optionId);
    if (!target) return;
    pending.current = true;
    setSaving(true);
    try {
      const removedIds = target.voted_by_me ? [optionId] : !multiple ? options.filter((option) => option.voted_by_me).map((option) => option.id) : [];
      if (removedIds.length) {
        if (!await api.removeVotes(removedIds)) throw new Error("remove failed");
        removeLocalVotes(removedIds);
      }
      if (!target.voted_by_me) {
        if (!await api.addVote(optionId)) throw new Error("add failed");
        setOptions((items) => items.map((item) => item.id === optionId ? {
          ...item, voted_by_me: true, vote_count: item.vote_count + 1,
          voters: anonymous ? item.voters : [...item.voters.filter((voter) => voter.profile_id !== userId), { profile_id: userId, display_name: userName, avatar_url: userAvatarUrl, blocks: userBlocks, grade: userGrade }],
        } : item));
      }
    } catch {
      showToast("投票を更新できませんでした。選択状態を確認して、もう一度お試しください");
    } finally { pending.current = false; setSaving(false); }
  }

  async function addOption() {
    const text = newOption.trim();
    if (!text || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      const created = await api.addOption(text, options.length);
      if (!created) throw new Error("add option failed");
      setOptions((items) => [...items, created]);
      setNewOption(""); setAdding(false);
    } catch { showToast("選択肢を追加できませんでした。もう一度お試しください"); }
    finally { pending.current = false; setSaving(false); }
  }

  return (
    <section data-ui-panel ref={pollRef} className="space-y-2 rounded-card border border-separator bg-bg p-3">
      {options.map((option) => {
        const percent = totalVotes ? Math.round(option.vote_count / totalVotes * 100) : 0;
        return (
          <div key={option.id} className="space-y-1">
            <button
            data-ui-poll-option
            aria-pressed={option.voted_by_me}
            type="button"
            disabled={saving}
            onClick={() => handleOptionClick(option.id)}
            onPointerDown={(event) => { event.preventDefault(); window.getSelection()?.removeAllRanges(); startLongPress(option.id); }}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onContextMenu={(event) => {
              if (anonymous) return;
              event.preventDefault();
              setDetailOptionId(option.id);
            }}
            className={cn(
              "relative flex min-h-11 w-full select-none touch-manipulation items-center overflow-hidden rounded-xl border px-3 text-left [-webkit-touch-callout:none]",
              option.voted_by_me ? "border-accent text-accent" : "border-separator bg-card",
            )}
          >
            <span className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${percent}%` }} />
            <span className="relative min-w-0 flex-1 whitespace-pre-wrap break-words py-2 text-[14px] font-medium">{option.text}</span>
            {newUi && option.voted_by_me && <Check size={16} aria-hidden="true" className="relative ml-2 shrink-0" />}
            <span className="relative ml-3 text-[12px] tabular-nums">{percent}%</span>
          </button>
          </div>
        );
      })}
      {allowOptions && (
        adding ? (
          <div className="flex gap-2">
            <Input aria-label="追加する選択肢" disabled={saving} value={newOption} maxLength={80} autoFocus placeholder="選択肢を追加" onChange={(event) => setNewOption(event.target.value)} className="min-w-0 flex-1" />
            <button data-ui-action data-ui-tone="primary" type="button" onClick={addOption} disabled={saving || !newOption.trim()} className="rounded-xl bg-accent px-3 text-[13px] font-semibold text-white">追加</button>
          </div>
        ) : (
          <button data-ui-action type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-[13px] font-semibold text-accent"><Plus size={15} />選択肢を追加</button>
        )
      )}
      <p className="text-micro">{totalVotes}票 ・ {multiple ? "複数選択可" : "1つ選択"} ・ {anonymous ? "匿名" : "記名"}</p>
      {!anonymous && <button data-ui-action type="button" onClick={() => setDetailOptionId(options[0]?.id ?? null)} className="text-micro text-accent">投票者を確認</button>}
      {!anonymous && detailOptionId && detailOption && (
        <Sheet open onOpenChange={(open) => !open && setDetailOptionId(null)}>
          <SheetContent
            title={"\u6295\u7968\u8005"}
            autoFocus={false}
            className="flex h-[calc(100dvh-12px)] flex-col"
            bodyClassName="flex min-h-0 flex-1 flex-col"
          >
          <div
            className="flex min-h-0 flex-1 flex-col"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 pb-3">
              <PollOptionTabs options={options} value={detailOption.id} onChange={setDetailOptionId} panelId={panelId} />
            </div>
            <section id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${detailOption.id}`} className="min-h-0 flex-1 overflow-y-auto rounded-card border border-separator bg-card">
              <div className="border-b border-separator px-4 py-3">
                <p className="text-[15px] font-semibold">{detailOption.text}</p>
                <p className="text-micro">{detailOption.vote_count}{"\u7968"}</p>
              </div>
              {detailOption.voters.length > 0 ? (
                <ul className="divide-y divide-separator">
                  {detailOption.voters.map((voter) => (
                    <li key={voter.profile_id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                      <Avatar name={voter.display_name} blocks={voter.blocks} avatarUrl={voter.avatar_url} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{voter.display_name}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-4 py-8 text-center text-caption">{"\u307e\u3060\u6295\u7968\u306f\u3042\u308a\u307e\u305b\u3093"}</p>}
            </section>
          </div>
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
}
