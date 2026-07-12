import { notFound } from "next/navigation";
import { ThreadPostsView } from "@/components/features/ThreadPostsView";
import { SubHeader } from "@/components/layout/SubHeader";
import { getThreadById, getThreadPosts } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import { getCurrentProfile } from "@/lib/supabase/auth";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [profile, thread, posts] = await Promise.all([
    getCurrentProfile(),
    getThreadById(id),
    getThreadPosts(id),
  ]);
  if (!thread) notFound();

  return (
    <>
      <SubHeader title="スレッド" backHref="/notes" />
      <div className="space-y-4 px-4 pt-1 pb-6">
        <div>
          <h1 className="text-title">{thread.title}</h1>
          <p className="mt-1 text-caption">{thread.author.display_name} が作成</p>
        </div>
        <ThreadPostsView
          threadId={thread.id}
          posts={posts}
          currentUserId={profile.id}
          isAdmin={permissionsOf(profile.roles).manageMembers}
        />
      </div>
    </>
  );
}
