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
import { RecordCard } from "@/components/cards/RecordCard";
import { ResultsList } from "@/components/features/ResultsList";
import { TrainingChart } from "@/components/features/TrainingChart";
import { FavoriteButton } from "@/components/features/FavoriteButton";
import { SheetLiveRefresh } from "@/components/features/SheetLiveRefresh";
import { ListSkeleton } from "@/components/ui/page-skeletons";
import { NoteList } from "@/components/features/NotesView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import {
  getProfileById,
  getUserRecordsWithSocialState,
  getPbRecords,
  getPublishedPersonalNotes,
  isFavorite,
} from "@/lib/queries";
import { gradeShort } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import type { PbRecord, Profile, RecordWithAuthor } from "@/types";

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
  const profile = (await getProfileById(id)) as Profile | null;
  if (!profile) notFound();

  const viewer = await getCurrentProfile();
  const isSelf = viewer.id === id;
  // スプシメインの本人がここ(/members/自分)から記録を見る場合も、毎時同期を待たず最新化する

  const [records, pbs, notes, favorited, cookieStore] = await Promise.all([
    getUserRecordsWithSocialState(id, viewer.id),
    getPbRecords(id) as Promise<PbRecord[]>,
    getPublishedPersonalNotes(id),
    isSelf ? Promise.resolve(false) : isFavorite(viewer.id, id),
    cookies(),
  ]);
  const showRecordSource =
    permissionsOf(viewer.roles).manageSystem &&
    cookieStore.get("show-record-source")?.value === "1";

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
  };

  return (
    <>
      <SheetLiveRefresh enabled={isSelf && viewer.record_source === "sheet" && Boolean(viewer.sheet_name)} />
      <SubHeader
        title={profile.display_name || "部員"}
        right={!isSelf ? <FavoriteButton targetId={id} initial={favorited} /> : undefined}
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

        <TrainingChart records={records} showIntensitySummary={profile.blocks.includes("middle_long")} />

        {(isSelf || notes.length > 0) && (
          <section className="space-y-2">
            <p className="section-label">{profile.display_name || "部員"}のノート</p>
            <NoteList notes={notes} currentUser={{ id: viewer.id, display_name: viewer.display_name, avatar_url: viewer.avatar_url, blocks: viewer.blocks, grade: viewer.grade }} />
          </section>
        )}

        {pbs.length > 0 && (
          <section className="space-y-2">
            <p className="section-label">大会・記録会の結果</p>
            <ResultsList results={pbs} />
          </section>
        )}

        <section className="space-y-2">
          <p className="section-label">これまでの記録</p>
          {records.length === 0 ? (
            <EmptyState title="まだ記録がありません" className="min-h-24 py-4" />
          ) : (
            <div className="space-y-3">
              {records.map((r) => (
                <RecordCard
                  key={r.id}
                  record={{ ...r, author: authorMini } as RecordWithAuthor}
                  currentUser={currentUser}
                  showSource={showRecordSource}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
