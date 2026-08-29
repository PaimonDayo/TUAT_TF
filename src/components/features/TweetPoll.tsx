"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/common/Avatar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { TweetPollOption } from "@/types";

function PollOptionTabs({
  options,
  value,
  onChange,
}: {
  options: TweetPollOption[];
  value: string;
  onChange: (optionId: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="投票の選択肢"
      className="flex h-9 snap-x snap-mandatory gap-1 overflow-x-auto rounded-[10px] bg-[#e9e9eb] p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.text}
            onClick={(event) => {
              onChange(option.id);
              event.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            }}
            className={cn(
              "h-8 min-w-24 max-w-44 shrink-0 snap-center truncate rounded-[8px] px-3 text-[13px] font-semibold transition-colors active:opacity-70",
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

export function TweetPoll({
  tweetId,
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
  tweetId: string;
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
  userBlocks: import("@/types").Block[];
  userGrade: string | null;
  options: TweetPollOption[];
  multiple: boolean;
  anonymous: boolean;
  allowOptions: boolean;
}) {
  const [options, setOptions] = useState(initialOptions);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [detailOptionId, setDetailOptionId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressVote = useRef(false);
  const detailOption = options.find((option) => option.id === detailOptionId) ?? options[0];
  const pollRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = pollRef.current;
    if (!root) return;
    const preventNativeSelection = (event: Event) => {
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

  async function vote(optionId: string) {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();
    const target = options.find((option) => option.id === optionId);
    if (!target) return;
    if (target.voted_by_me) {
      await supabase.from("tweet_poll_votes").delete().eq("option_id", optionId).eq("user_id", userId);
      setOptions((items) => items.map((item) => item.id === optionId ? { ...item, voted_by_me: false, vote_count: Math.max(0, item.vote_count - 1), voters: item.voters.filter((voter) => voter.profile_id !== userId) } : item));
    } else {
      if (!multiple) {
        const selected = options.filter((option) => option.voted_by_me);
        if (selected.length) {
          await supabase.from("tweet_poll_votes").delete().in("option_id", selected.map((option) => option.id)).eq("user_id", userId);
        }
      }
      const { error } = await supabase.from("tweet_poll_votes").insert({ option_id: optionId, user_id: userId });
      if (!error) {
        setOptions((items) => items.map((item) => ({
          ...item,
          voted_by_me: item.id === optionId ? true : multiple ? item.voted_by_me : false,
          vote_count: item.id === optionId ? item.vote_count + 1 : !multiple && item.voted_by_me ? Math.max(0, item.vote_count - 1) : item.vote_count,
          voters: anonymous ? item.voters : item.id === optionId ? [...item.voters.filter((voter) => voter.profile_id !== userId), { profile_id: userId, display_name: userName, avatar_url: userAvatarUrl, blocks: userBlocks, grade: userGrade }] : !multiple && item.voted_by_me ? item.voters.filter((voter) => voter.profile_id !== userId) : item.voters,
        })));
      }
    }
    setSaving(false);
  }

  async function addOption() {
    const text = newOption.trim();
    if (!text || saving) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("tweet_poll_options").insert({
      tweet_id: tweetId,
      text,
      created_by: userId,
      sort_order: options.length,
    }).select("*").single();
    if (!error && data) {
      setOptions((items) => [...items, { ...data, vote_count: 0, voted_by_me: false, voters: [] }]);
      setNewOption("");
      setAdding(false);
    }
    setSaving(false);
  }

  return (
    <section ref={pollRef} className="space-y-2 rounded-[16px] border border-separator bg-bg p-3">
      {options.map((option) => {
        const percent = totalVotes ? Math.round(option.vote_count / totalVotes * 100) : 0;
        return (
          <div key={option.id} className="space-y-1">
            <button
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
            <span className="relative min-w-0 flex-1 truncate text-[14px] font-medium">{option.text}</span>
            <span className="relative ml-3 text-[12px] tabular-nums">{percent}%</span>
          </button>
          </div>
        );
      })}
      {allowOptions && (
        adding ? (
          <div className="flex gap-2">
            <input value={newOption} maxLength={80} autoFocus placeholder="選択肢を追加" onChange={(event) => setNewOption(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-separator bg-card px-3 text-[14px]" />
            <button type="button" onClick={addOption} className="rounded-xl bg-accent px-3 text-[13px] font-semibold text-white">追加</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-[13px] font-semibold text-accent"><Plus size={15} />選択肢を追加</button>
        )
      )}
      <p className="text-micro">{totalVotes}票 ・ {multiple ? "複数選択可" : "1つ選択"} ・ {anonymous ? "匿名" : "記名"}</p>
      {!anonymous && <p className="text-micro">{"選択肢を長押しすると投票者を確認できます"}</p>}
      {!anonymous && detailOptionId && detailOption && (
        <Sheet open onOpenChange={(open) => !open && setDetailOptionId(null)}>
          <SheetContent
            title={"投票者"}
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
              <PollOptionTabs options={options} value={detailOption.id} onChange={setDetailOptionId} />
            </div>
            <section className="min-h-0 flex-1 overflow-y-auto rounded-[16px] border border-separator bg-card">
              <div className="border-b border-separator px-4 py-3">
                <p className="text-[15px] font-semibold">{detailOption.text}</p>
                <p className="text-micro">{detailOption.vote_count}{"票"}</p>
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
              ) : <p className="px-4 py-8 text-center text-caption">{"まだ投票はありません"}</p>}
            </section>
          </div>
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
}
