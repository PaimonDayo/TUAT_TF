"use client";

import Link from "next/link";
import { ExternalLink, Link2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { PostActions } from "@/components/cards/PostActions";
import { Linkify } from "@/components/common/Linkify";
import { TweetOwnerMenu } from "@/components/cards/PostOwnerMenu";
import { tweetContentUrls, tweetUrlHost } from "@/lib/tweet-content";
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
  const urls = tweetContentUrls(tweet.content);
  const primaryUrl = urls[0];

  return (
    <Card className="overflow-hidden border-separator/60 bg-card p-0 shadow-[0_8px_28px_rgba(0,0,0,0.035)]">
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <Link href={`/members/${author.id}`} onClick={(event) => event.stopPropagation()}>
          <Avatar name={author.display_name} blocks={author.blocks} avatarUrl={author.avatar_url} size="sm" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/members/${author.id}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-[14px] font-semibold"
            >
              {author.display_name || "名無し"}
            </Link>
            <BlockPills blocks={author.blocks} />
            {gradeLabel && <span className="text-micro">{gradeLabel}</span>}
          </div>
          <p className="text-micro">
            {formatDistanceToNow(new Date(tweet.created_at), { addSuffix: true, locale: ja })}
            <span aria-hidden="true"> · </span>
            つぶやき
          </p>
        </div>
        {isOwner && (
          <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
            <TweetOwnerMenu tweet={{ id: tweet.id, content: tweet.content }} />
          </span>
        )}
      </div>

      <div className="px-4 pb-3 pt-3">
        <p
          className={cn(
            "break-words text-[15px] leading-7 text-ink",
            compact ? "line-clamp-2" : "whitespace-pre-wrap",
          )}
        >
          <Linkify text={tweet.content} />
        </p>

        {!compact && primaryUrl && (
          <a
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="mt-3 flex items-center gap-3 rounded-2xl border border-accent/15 bg-accent/5 px-3.5 py-3 transition-active active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-accent shadow-sm">
              <Link2 size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">
                {tweetUrlHost(primaryUrl)}
              </span>
              <span className="block text-[11px] text-muted2">
                {urls.length > 1 ? `リンクを開く・ほか${urls.length - 1}件` : "リンクを開く"}
              </span>
            </span>
            <ExternalLink size={15} className="shrink-0 text-accent" />
          </a>
        )}
      </div>

      <div className="border-t border-separator/60 bg-bg/35 px-4 pb-3 pt-2" onClick={(event) => event.stopPropagation()}>
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
