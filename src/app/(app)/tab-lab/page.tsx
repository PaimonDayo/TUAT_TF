import { Suspense } from "react";
import { HomeContent } from "@/app/(app)/home/page";
import { TabNavigationLab, type TabLabMode } from "@/components/features/TabNavigationLab";
import { HomeSkeleton } from "@/components/ui/page-skeletons";

const MODES = new Set<TabLabMode>(["empty", "light", "home"]);

export default async function TabLabPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const rawMode = (await searchParams).mode;
  const mode: TabLabMode = MODES.has(rawMode as TabLabMode)
    ? rawMode as TabLabMode
    : "empty";

  return (
    <TabNavigationLab
      mode={mode}
      homeContent={mode === "home" ? (
        <Suspense fallback={<HomeSkeleton />}>
          <HomeContent />
        </Suspense>
      ) : undefined}
    />
  );
}
