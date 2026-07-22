"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { PostActions } from "@/components/cards/PostActions";
import { Linkify } from "@/components/common/Linkify";
import { TweetOwnerMenu } from "@/components/cards/PostOwnerMenu";
import { cn } from "@/lib/utils";
import { gradeShort } from "@/lib/constants";
import type { CommentAuthor, TweetWithAuthor } from "@/types";

/** タイムライン用のつぶやきカード。compact=簡易表示（本文を2行に省略） */
export function TweetCard({
  tweet,
  currentUser,
  compact = false,
  commentsExpanded = false,
}: {
  tweet: TweetWithAuthor;
  currentUser: CommentAuthor;
  compact?: boolean;
  commentsExpanded?: boolean;
}) {
  const { author } = tweet;
  const isOwner = currentUser.id === author.id;
  const gradeLabel = gradeShort(author.grade);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2.5">
        <Link href={`/members/${author.id}`} onClick={(event) => event.stopPropagation()}>
          <Avatar name={author.display_name} blocks={author.blocks} avatarUrl={author.avatar_url} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/members/${author.id}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-headline"
            >
              {author.display_name || "名無し"}
            </Link>
            <BlockPills blocks={author.blocks} />
            {gradeLabel && <span className="text-micro">{gradeLabel}</span>}
          </div>
          <p className="text-caption">
            {formatDistanceToNow(new Date(tweet.created_at), { addSuffix: true, locale: ja })}
            のつぶやき
          </p>
        </div>
        {isOwner && (
          <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <TweetOwnerMenu tweet={{ id: tweet.id, content: tweet.content }} />
          </span>
        )}
      </div>

      <p
        className={cn(
          "break-words text-[15px] leading-7",
          compact ? "line-clamp-2" : "whitespace-pre-wrap",
        )}
      >
        <Linkify text={tweet.content} />
      </p>

      <div onClick={(event) => event.stopPropagation()}>
        <PostActions
          targetType="tweet"
          targetId={tweet.id}
          initialLikes={tweet.likes_count}
          initialLiked={tweet.liked_by_me ?? false}
          initialComments={tweet.comments_count ?? 0}
          currentUser={currentUser}
          commentsExpanded={commentsExpanded}
        />
      </div>
    </Card>
  );
}
