"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FormModal } from "@/components/ui/form-modal";
import { cn } from "@/lib/utils";
import type { TweetPollOption } from "@/types";

export function TweetPoll({
  tweetId,
  userId,
  userName,
  options: initialOptions,
  multiple,
  anonymous,
  allowOptions,
}: {
  tweetId: string;
  userId: string;
  userName: string;
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
      setOptions((items) => items.map((item) => item.id === optionId ? { ...item, voted_by_me: false, vote_count: Math.max(0, item.vote_count - 1), voters: item.voters.filter((name) => name !== userName) } : item));
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
          voters: anonymous ? item.voters : item.id === optionId ? [...item.voters.filter((name) => name !== userName), userName] : !multiple && item.voted_by_me ? item.voters.filter((name) => name !== userName) : item.voters,
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
    <section className="space-y-2 rounded-[16px] border border-separator bg-bg p-3">
      {options.map((option) => {
        const percent = totalVotes ? Math.round(option.vote_count / totalVotes * 100) : 0;
        return (
          <div key={option.id} className="space-y-1">
            <button
            type="button"
            disabled={saving}
            onClick={() => handleOptionClick(option.id)}
            onPointerDown={() => startLongPress(option.id)}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onContextMenu={(event) => {
              if (anonymous) return;
              event.preventDefault();
              setDetailOptionId(option.id);
            }}
            className={cn(
              "relative flex min-h-11 w-full select-none touch-manipulation items-center overflow-hidden rounded-xl border px-3 text-left",
              option.voted_by_me ? "border-accent text-accent" : "border-separator bg-card",
            )}
          >
            <span className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${percent}%` }} />
            <span className="relative min-w-0 flex-1 truncate text-[14px] font-medium">{option.text}</span>
            <span className="relative ml-3 text-[12px] tabular-nums">{percent}%</span>
          </button>
            {!anonymous && option.voters.length > 0 && (
              <p className="px-1 text-micro">{option.voters.join("、")}</p>
            )}
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
      {!anonymous && <p className="text-micro">{"\u9078\u629e\u80a2\u3092\u9577\u62bc\u3057\u3059\u308b\u3068\u6295\u7968\u8005\u3092\u78ba\u8a8d\u3067\u304d\u307e\u3059"}</p>}
      {!anonymous && detailOptionId && detailOption && (
        <FormModal open onOpenChange={(open) => !open && setDetailOptionId(null)} title={"\u6295\u7968\u8005"}>
          <div className="space-y-4 pb-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDetailOptionId(option.id)}
                  className={cn(
                    "min-h-10 shrink-0 rounded-full border px-4 text-[13px] font-semibold",
                    detailOption.id === option.id ? "border-accent bg-accent text-white" : "border-separator bg-card",
                  )}
                >
                  {option.text} ({option.vote_count})
                </button>
              ))}
            </div>
            <section className="overflow-hidden rounded-[16px] border border-separator bg-card">
              <div className="border-b border-separator px-4 py-3">
                <p className="text-[15px] font-semibold">{detailOption.text}</p>
                <p className="text-micro">{detailOption.vote_count}{"\u7968"}</p>
              </div>
              {detailOption.voters.length > 0 ? (
                <ul className="divide-y divide-separator">
                  {detailOption.voters.map((name, index) => <li key={`${name}-${index}`} className="px-4 py-3 text-[14px] font-medium">{name}</li>)}
                </ul>
              ) : <p className="px-4 py-8 text-center text-caption">{"\u307e\u3060\u6295\u7968\u306f\u3042\u308a\u307e\u305b\u3093"}</p>}
            </section>
          </div>
        </FormModal>
      )}
    </section>
  );
}
