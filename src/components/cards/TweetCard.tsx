import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Card } from "@/components/ui/card";
import { PostActions } from "@/components/cards/PostActions";
import { TweetOwnerMenu } from "@/components/cards/PostOwnerMenu";
import type { TweetWithAuthor } from "@/types";

/** タイムライン用のつぶやきカード */
export function TweetCard({
  tweet,
  currentUserId,
}: {
  tweet: TweetWithAuthor;
  currentUserId?: string;
}) {
  const { author } = tweet;
  const isOwner = currentUserId === author.id;

  return (
    <Card className="p-4 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <Link href={`/members/${author.id}`}>
          <Avatar name={author.display_name} blocks={author.blocks} avatarUrl={author.avatar_url} size="sm" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link href={`/members/${author.id}`} className="text-[14px] font-semibold truncate">
              {author.display_name || "名無し"}
            </Link>
            <BlockPills blocks={author.blocks} />
          </div>
          <p className="text-micro">
            {formatDistanceToNow(new Date(tweet.created_at), { addSuffix: true, locale: ja })}
          </p>
        </div>
        {isOwner && <TweetOwnerMenu tweet={{ id: tweet.id, content: tweet.content }} />}
      </div>

      <p className="text-[15px] whitespace-pre-wrap break-words">{tweet.content}</p>

      <PostActions
        targetType="tweet"
        targetId={tweet.id}
        initialLikes={tweet.likes_count}
        initialLiked={tweet.liked_by_me ?? false}
        initialComments={tweet.comments_count ?? 0}
      />
    </Card>
  );
}
