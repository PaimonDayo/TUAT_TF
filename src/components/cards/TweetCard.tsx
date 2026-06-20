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
import type { CommentAuthor, TweetWithAuthor } from "@/types";

/** タイムライン用のつぶやきカード。compact=簡易表示（本文を2行に省略） */
export function TweetCard({
  tweet,
  currentUser,
  compact = false,
}: {
  tweet: TweetWithAuthor;
  currentUser: CommentAuthor;
  compact?: boolean;
}) {
  const { author } = tweet;
  const isOwner = currentUser.id === author.id;

  return (
    <Card className={cn("p-4", compact ? "space-y-1.5" : "space-y-2.5")}>
      <div className="flex items-center gap-2.5">
        <Link href={`/members/${author.id}`} onClick={(e) => e.stopPropagation()}>
          <Avatar name={author.display_name} blocks={author.blocks} avatarUrl={author.avatar_url} size="sm" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              href={`/members/${author.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[14px] font-semibold truncate"
            >
              {author.display_name || "名無し"}
            </Link>
            <BlockPills blocks={author.blocks} />
          </div>
          <p className="text-micro">
            {formatDistanceToNow(new Date(tweet.created_at), { addSuffix: true, locale: ja })}
          </p>
        </div>
        {isOwner && (
          <span onClick={(e) => e.stopPropagation()}>
            <TweetOwnerMenu tweet={{ id: tweet.id, content: tweet.content }} />
          </span>
        )}
      </div>

      <p className={cn("text-[15px] break-words", compact ? "line-clamp-2" : "whitespace-pre-wrap")}>
        <Linkify text={tweet.content} />
      </p>

      {!compact && (
        <div onClick={(e) => e.stopPropagation()}>
          <PostActions
            targetType="tweet"
            targetId={tweet.id}
            initialLikes={tweet.likes_count}
            initialLiked={tweet.liked_by_me ?? false}
            initialComments={tweet.comments_count ?? 0}
            currentUser={currentUser}
          />
        </div>
      )}
    </Card>
  );
}
