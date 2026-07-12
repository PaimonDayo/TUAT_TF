import { Suspense } from "react";
import { HomeContent } from "@/app/(app)/home/page";
import { TabNavigationLab, type TabLabMode } from "@/components/features/TabNavigationLab";
import { ScheduleCachedView } from "@/components/features/ScheduleCachedView";
import { Header } from "@/components/layout/Header";
import { HomeSkeleton } from "@/components/ui/page-skeletons";
import { getSchedulePageData } from "@/lib/schedule-page-data";

const MODES = new Set<TabLabMode>(["empty", "light", "home", "real"]);

export default async function TabLabPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const rawMode = (await searchParams).mode;
  const mode: TabLabMode = MODES.has(rawMode as TabLabMode)
    ? rawMode as TabLabMode
    : "empty";
  const scheduleData = mode === "real" ? await getSchedulePageData() : null;


  return (
    <TabNavigationLab
      mode={mode}
      homeContent={mode === "home" || mode === "real" ? (
        <Suspense fallback={<HomeSkeleton />}>
          <HomeContent />
        </Suspense>
      ) : undefined}
      scheduleContent={scheduleData ? (
        <>
          <Header title="??" large />
          <ScheduleCachedView initialData={scheduleData} />
        </>
      ) : undefined}
    />
  );
}
