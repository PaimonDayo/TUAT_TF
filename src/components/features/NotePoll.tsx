"use client";

import { createClient } from "@/lib/supabase/client";
import { PollView, type PollApi, type PollOption } from "@/components/features/PollView";

/** ノート記事の投票。つぶやきの投票と同じ見た目・同じ操作で、保存先だけが違う。 */
export function NotePoll({
  articleId,
  userId,
  userName,
  userAvatarUrl,
  userBlocks,
  userGrade,
  options,
  multiple,
  anonymous,
  allowOptions,
}: {
  articleId: string;
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
  const api: PollApi = {
    async addVote(optionId) {
      const { error } = await createClient()
        .from("note_poll_votes")
        .insert({ option_id: optionId, user_id: userId });
      return !error;
    },
    async removeVotes(optionIds) {
      const { error } = await createClient()
        .from("note_poll_votes")
        .delete()
        .in("option_id", optionIds)
        .eq("user_id", userId);
      return !error;
    },
    async addOption(text, sortOrder) {
      const { data, error } = await createClient()
        .from("note_poll_options")
        .insert({ article_id: articleId, text, created_by: userId, sort_order: sortOrder })
        .select("*")
        .single();
      if (error || !data) return null;
      return { ...data, vote_count: 0, voted_by_me: false, voters: [] };
    },
  };

  return (
    <PollView
      api={api}
      userId={userId}
      userName={userName}
      userAvatarUrl={userAvatarUrl}
      userBlocks={userBlocks}
      userGrade={userGrade}
      options={options}
      multiple={multiple}
      anonymous={anonymous}
      allowOptions={allowOptions}
    />
  );
}
