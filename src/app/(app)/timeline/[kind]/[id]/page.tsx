import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { SubHeader } from "@/components/layout/SubHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { PostDetailSkeleton } from "@/components/ui/page-skeletons";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getFeedItemById } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 通知から1件の投稿へ直接飛ぶためのパーマリンク。返信を開いた状態で表示する。 */
export default function PostPermalinkPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  return (
    <>
      <SubHeader title="投稿" backHref="/timeline" />
      <Suspense fallback={<PostDetailSkeleton />}>
        <PostContent params={params} />
      </Suspense>
    </>
  );
}

/** 削除済み・不正なURLのときの空状態（Next の既定404はアプリ外の英語画面になるため使わない） */
function PostMissing() {
  return (
    <EmptyState
      title="投稿が見つかりません"
      description="削除されたか、閲覧できない投稿です。"
      action={
        <Link href="/timeline" className="text-[15px] text-accent">
          タイムラインを開く
        </Link>
      }
    />
  );
}

async function PostContent({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const profile = await getCurrentProfile();
  const { kind, id } = await params;
  if ((kind !== "record" && kind !== "tweet") || !UUID_RE.test(id)) return <PostMissing />;

  const [item, cookieStore] = await Promise.all([
    getFeedItemById(kind, id, profile.id),
    cookies(),
  ]);
  if (!item) return <PostMissing />;

  const showRecordSource =
    permissionsOf(profile.roles).manageSystem &&
    cookieStore.get("show-record-source")?.value === "1";
  const currentUser = {
    id: profile.id,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    systemRecordForm: Boolean(profile.sheet_name),
  };

  return (
    <div className="px-4 pt-1 pb-6">
      {item.kind === "record" ? (
        <RecordCard
          record={item}
          currentUser={currentUser}
          commentsExpanded
          showSource={showRecordSource}
        />
      ) : (
        <TweetCard tweet={item} currentUser={currentUser} commentsExpanded />
      )}
    </div>
  );
}
