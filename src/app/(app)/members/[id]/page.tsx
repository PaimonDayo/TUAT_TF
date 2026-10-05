import { canModerateComments } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { Target } from "lucide-react";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Linkify } from "@/components/common/Linkify";
import { ActivityFeed } from "@/components/features/ActivityFeed";
import { ResultsList } from "@/components/features/ResultsList";
import { PbManager } from "@/components/features/PbManager";
import type { CompetitionEvent } from "@/lib/competition-goals";
import { TrainingChart } from "@/components/features/TrainingChart";
import { FavoriteButton } from "@/components/features/FavoriteButton";
import { ListSkeleton } from "@/components/ui/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { NoteList } from "@/components/features/NotesView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import {
  getProfileById,
  getUserRecordsWithSocialState,
  getPbRecords,
  getCompetitionEvents,
  getCompetitions,
  getPublishedPersonalNotes,
  getUserTweets,
  isFavorite,
  sortFeedItems,
} from "@/lib/queries";
import { gradeShort } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import { RECORD_SOURCE_COOKIE, showRecordSourceFor } from "@/lib/record-source-display";
import type { FeedItem, PbRecord, Profile, RecordWithAuthor } from "@/types";

export default function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Suspense fallback={<ListSkeleton />}><MemberContent params={params} /></Suspense>;
}

async function MemberContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, viewer] = await Promise.all([
    getProfileById(id) as Promise<Profile | null>,
    getCurrentProfile(),
  ]);
  if (!profile) notFound();

  const isSelf = viewer.id === id;

  return (
    <>
      <SubHeader
        title={profile.display_name || "部員"}
        sideWidth={!isSelf ? 120 : undefined}
        right={!isSelf ? (
          <Suspense fallback={<Skeleton className="h-9 w-24 rounded-full" />}>
            <MemberFavorite viewerId={viewer.id} targetId={id} />
          </Suspense>
        ) : undefined}
      />

      <div className="px-4 space-y-5 pt-1">
        <Card className="p-4 flex items-center gap-4">
          <Avatar name={profile.display_name || "?"} blocks={profile.blocks} avatarUrl={profile.avatar_url} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-title truncate">{profile.display_name || "名無し"}</h2>
              <BlockPills blocks={profile.blocks} full />
            </div>
            <p className="text-caption mt-0.5">{gradeShort(profile.grade) ?? "学年未設定"}</p>
            {profile.events?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {profile.events.map((ev) => (
                  <span
                    key={ev}
                    className="rounded-full border border-separator bg-bg px-2 py-0.5 text-micro text-muted2"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            )}
            {profile.roles?.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {profile.roles.map((role) => (
                  <span
                    key={role.id}
                    className="rounded-full px-2 py-0.5 text-micro"
                    style={{ color: role.color, backgroundColor: `${role.color}18` }}
                  >
                    {role.name}
                  </span>
                ))}
              </div>
            )}
            {profile.goal && (
              <p className="text-caption mt-1 flex items-start gap-1">
                <Target size={12} className="text-accent mt-[2px] shrink-0" />
                <span className="text-ink whitespace-pre-wrap">
                  <Linkify text={profile.goal} />
                </span>
              </p>
            )}
          </div>
        </Card>

        <Suspense fallback={
          <div role="status" aria-label="部員の記録を読み込み中" className="space-y-5">
            <span className="sr-only">部員の記録を読み込み中</span>
            {profile.blocks.includes("middle_long") && <Skeleton className="h-[172px] w-full rounded-card" />}
            <Skeleton className="h-20 w-full rounded-card" />
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        }>
          <MemberDetails profile={profile} viewer={viewer} />
        </Suspense>
      </div>
    </>
  );
}

async function MemberFavorite({ viewerId, targetId }: { viewerId: string; targetId: string }) {
  const initial = await isFavorite(viewerId, targetId);
  return <FavoriteButton targetId={targetId} initial={initial} />;
}

/** 履歴の取得が遅くても、部員名・プロフィールと戻る操作を先に使えるようにする。 */
async function MemberDetails({ profile, viewer }: { profile: Profile; viewer: Profile }) {
  const id = profile.id;
  const isSelf = viewer.id === id;
  const canManageSystem = permissionsOf(viewer.roles).manageSystem;
  const [records, tweets, pbs, notes, cookieStore, events, competitions] = await Promise.all([
    getUserRecordsWithSocialState(id, viewer.id),
    getUserTweets(id, viewer.id),
    getPbRecords(id) as Promise<PbRecord[]>,
    getPublishedPersonalNotes(id),
    cookies(),
    getCompetitionEvents(),
    canManageSystem ? getCompetitions() : Promise.resolve([]),
  ]);
  const showRecordSource = showRecordSourceFor(
    canManageSystem,
    cookieStore.get(RECORD_SOURCE_COOKIE)?.value,
  );
  const authorMini = {
    id: profile.id,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    blocks: profile.blocks,
    grade: profile.grade,
  };
  const currentUser = {
    id: viewer.id,
    display_name: viewer.display_name,
    avatar_url: viewer.avatar_url,
    systemRecordForm: Boolean(viewer.sheet_name),
    canModerateComments: canModerateComments(viewer.roles),
  };
  const activity = sortFeedItems([
    ...records.map(
      (record): FeedItem => ({
        kind: "record",
        ...(record as RecordWithAuthor),
        author: authorMini,
      }),
    ),
    ...tweets,
  ]);

  return (
    <>
        {profile.blocks.includes("middle_long") && (
          <TrainingChart records={records} showIntensitySummary />
        )}

        {(isSelf || notes.length > 0) && (
          <section className="space-y-2">
            <p className="section-label">{profile.display_name || "部員"}のノート</p>
            <NoteList notes={notes} currentUser={{ id: viewer.id, display_name: viewer.display_name, avatar_url: viewer.avatar_url, blocks: viewer.blocks, grade: viewer.grade }} />
          </section>
        )}

        {(pbs.length > 0 || canManageSystem) && (
          <section className="space-y-2">
            <p className="section-label">大会・記録会の結果</p>
            {canManageSystem && !isSelf ? (
              <>
                <PbManager
                  userId={profile.id}
                  initial={pbs}
                  events={events as CompetitionEvent[]}
                  competitions={competitions}
                  addLabel="この部員の結果を追加"
                />
                <p className="text-caption">
                  システム管理者として、表記の統一のためにこの部員の結果を編集できます。
                </p>
              </>
            ) : (
              <ResultsList results={pbs} events={events as CompetitionEvent[]} />
            )}
          </section>
        )}

        <section className="space-y-2">
          <p className="section-label">これまでの投稿</p>
          {activity.length === 0 ? (
            <EmptyState title="まだ投稿はありません" className="min-h-24 py-4" />
          ) : (
            <ActivityFeed
              activity={activity}
              currentUser={currentUser}
              showRecordSource={showRecordSource}
            />
          )}
        </section>
    </>
  );
}
