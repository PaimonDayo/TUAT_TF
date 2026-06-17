import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { BlockFilter } from "@/components/features/BlockFilter";
import { GradeFilterButton } from "@/components/features/GradeFilterButton";
import { TimelineFeed } from "@/components/features/TimelineFeed";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getFeed } from "@/lib/queries";
import type { Block } from "@/types";

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string; grade?: string }>;
}) {
  const { block, grade } = await searchParams;
  const profile = await getCurrentProfile();
  const feed = await getFeed(
    profile.id,
    (block as Block | undefined) ?? "all",
    15,
    grade ?? "all",
  );

  return (
    <>
      <Header title="タイムライン" large />
      <Suspense>
        <BlockFilter />
        <div className="px-4 pb-2 flex justify-end">
          <GradeFilterButton />
        </div>
      </Suspense>

      <div className="px-4 pt-1">
        <TimelineFeed
          key={`${block ?? "all"}-${grade ?? "all"}`}
          initialItems={feed}
          currentUserId={profile.id}
          block={block ?? "all"}
          grade={grade ?? "all"}
        />
      </div>
    </>
  );
}
