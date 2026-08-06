"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { TweetPollOption } from "@/types";

export function TweetPoll({
  tweetId,
  userId,
  options: initialOptions,
  multiple,
  anonymous,
  allowOptions,
}: {
  tweetId: string;
  userId: string;
  options: TweetPollOption[];
  multiple: boolean;
  anonymous: boolean;
  allowOptions: boolean;
}) {
  const [options, setOptions] = useState(initialOptions);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newOption, setNewOption] = useState("");
  const totalVotes = options.reduce((sum, option) => sum + option.vote_count, 0);

  async function vote(optionId: string) {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();
    const target = options.find((option) => option.id === optionId);
    if (!target) return;
    if (target.voted_by_me) {
      await supabase.from("tweet_poll_votes").delete().eq("option_id", optionId).eq("user_id", userId);
      setOptions((items) => items.map((item) => item.id === optionId ? { ...item, voted_by_me: false, vote_count: Math.max(0, item.vote_count - 1) } : item));
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
      setOptions((items) => [...items, { ...data, vote_count: 0, voted_by_me: false }]);
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
          <button
            key={option.id}
            type="button"
            disabled={saving}
            onClick={() => vote(option.id)}
            className={cn(
              "relative flex min-h-11 w-full items-center overflow-hidden rounded-xl border px-3 text-left",
              option.voted_by_me ? "border-accent text-accent" : "border-separator bg-card",
            )}
          >
            <span className="absolute inset-y-0 left-0 bg-accent/10" style={{ width: `${percent}%` }} />
            <span className="relative min-w-0 flex-1 truncate text-[14px] font-medium">{option.text}</span>
            <span className="relative ml-3 text-[12px] tabular-nums">{percent}%</span>
          </button>
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
    </section>
  );
}
