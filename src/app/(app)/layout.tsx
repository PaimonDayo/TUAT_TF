import { Suspense } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { DesktopNav } from "@/components/layout/DesktopNav";
import { FAB } from "@/components/layout/FAB";
import { SessionKeepAlive } from "@/components/layout/SessionKeepAlive";
import { PullToRefresh } from "@/components/layout/PullToRefresh";
import { VersionWatcher } from "@/components/features/VersionWatcher";
import { ToastProvider } from "@/components/ui/toast";
import { AppQueryProvider } from "@/components/providers/QueryProvider";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppQueryProvider>
    <ToastProvider>
      <div className="min-h-dvh bg-bg lg:bg-[#e9edf3]">
        <div className="mx-auto flex min-h-dvh w-full max-w-[1160px] lg:gap-6 lg:px-6">
          <DesktopNav />
          <div className="mx-auto min-h-dvh w-full max-w-md min-w-0 overflow-x-hidden bg-bg pb-[calc(52px+env(safe-area-inset-bottom))] lg:mx-0 lg:max-w-[880px] lg:pb-8 lg:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_12px_40px_rgba(35,45,65,0.08)]">
            <SessionKeepAlive />
            <PullToRefresh />
            {children}
            <Suspense fallback={null}><AuthenticatedFab /></Suspense>
            <Suspense fallback={null}><BottomNav /></Suspense>
            <VersionWatcher />
          </div>
        </div>
      </div>
    </ToastProvider>
    </AppQueryProvider>
  );
}

async function AuthenticatedFab() {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  return (
    <FAB
      userId={profile.id}
      currentUser={{
        id: profile.id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        blocks: profile.blocks,
        grade: profile.grade,
      }}
      isMiddleLong={profile.blocks?.includes("middle_long") ?? false}
      recordSource={profile.record_source}
      recordFields={profile.record_fields}
      can={{
        createSchedule: perms.createSchedule,
        createMenu: perms.createMenu,
        createNotice: perms.createNotice,
        manageMembers: perms.manageMembers,
      }}
    />
  );
}
