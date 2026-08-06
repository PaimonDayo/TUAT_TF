"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { PostActions } from "@/components/cards/PostActions";
import { MentionText } from "@/components/common/MentionText";
import { TweetPoll } from "@/components/features/TweetPoll";
import { TweetOwnerMenu } from "@/components/cards/PostOwnerMenu";
import { cn } from "@/lib/utils";
import { gradeShort } from "@/lib/constants";
import type { CommentAuthor, TweetWithAuthor } from "@/types";
import { tweetImageDisplayUrl } from "@/lib/tweet-image";

/** タイムライン用のつぶやきカード。compact=簡易表示（本文を2行に省略） */
export function TweetCard({
  tweet,
  currentUser,
  compact = false,
  commentsExpanded = false,
  embedded = false,
}: {
  tweet: TweetWithAuthor;
  currentUser: CommentAuthor;
  compact?: boolean;
  commentsExpanded?: boolean;
  embedded?: boolean;
}) {
  const { author } = tweet;
  const isOwner = currentUser.id === author.id;
  const gradeLabel = gradeShort(author.grade);
  const [imageOpen, setImageOpen] = useState(false);
  const imageUrl = tweet.image_path ? tweetImageDisplayUrl(tweet.image_path) : null;

  return (
    <>
    <Card
      className={cn(
        "space-y-3 p-4",
        embedded && "rounded-none border-0",
      )}
    >
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
            {tweet.expires_at ? " · ストーリー" : " のつぶやき"}
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
        <MentionText text={tweet.content} mentions={tweet.mentions} />
      </p>
      {tweet.poll && (
        <TweetPoll
          tweetId={tweet.id}
          userId={currentUser.id}
          options={tweet.poll.options}
          multiple={tweet.poll_multiple}
          anonymous={tweet.poll_anonymous}
          allowOptions={tweet.poll_allow_options}
        />
      )}


      {tweet.image_path && (
        <button
          type="button"
          aria-label="画像を拡大"
          className="block w-full overflow-hidden rounded-2xl border border-separator bg-bg"
          onClick={(event) => { event.stopPropagation(); setImageOpen(true); }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl!} alt="投稿画像" className="max-h-[520px] w-full object-contain" />
        </button>
      )}

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
      {imageUrl && <ImageLightbox src={imageUrl} alt="投稿画像" open={imageOpen} onClose={() => setImageOpen(false)} />}
    </>
  );
}
