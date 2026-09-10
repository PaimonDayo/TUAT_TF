import { Suspense } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { DesktopNav } from "@/components/layout/DesktopNav";
import { FAB } from "@/components/layout/FAB";
import { SessionKeepAlive } from "@/components/layout/SessionKeepAlive";
import { PullToRefresh } from "@/components/layout/PullToRefresh";
import { VersionWatcher } from "@/components/features/VersionWatcher";
import { PushSubscriptionSync } from "@/components/features/PushSubscriptionSync";
import { SheetHeaderGuard } from "@/components/features/SheetHeaderGuard";
import { ToastProvider } from "@/components/ui/toast";
import { AppQueryProvider } from "@/components/providers/QueryProvider";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppQueryProvider>
    <ToastProvider>
      <div className="min-h-dvh bg-bg md:bg-[#eef1f5] lg:bg-[#e9edf3]">
        <div className="mx-auto flex min-h-dvh w-full max-w-[1160px] md:gap-3 md:px-3 lg:gap-6 lg:px-6">
          <DesktopNav />
          <div className="mx-auto min-h-dvh w-full max-w-md min-w-0 overflow-x-hidden bg-bg pb-[calc(52px+env(safe-area-inset-bottom))] md:mx-0 md:max-w-none md:flex-1 md:pb-6 md:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_28px_rgba(35,45,65,0.06)] lg:max-w-[880px] lg:pb-8 lg:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_12px_40px_rgba(35,45,65,0.08)]">
            <SessionKeepAlive />
            <PullToRefresh />
            {children}
            <Suspense fallback={<FabPlaceholder />}><AuthenticatedFab /></Suspense>
            <Suspense fallback={null}><BottomNav /></Suspense>
            <VersionWatcher />
            {process.env.NEXT_PUBLIC_PC_TRIAL !== "true" && <PushSubscriptionSync />}
            {process.env.NEXT_PUBLIC_PC_TRIAL !== "true" && <Suspense fallback={null}><AuthenticatedSheetHeaderGuard /></Suspense>}
          </div>
        </div>
      </div>
    </ToastProvider>
    </AppQueryProvider>
  );
}

/** 作成ボタンが出るまでの場所取り。位置と大きさはFAB本体と揃えてある。 */
function FabPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto h-0 w-full max-w-md md:inset-x-auto md:right-3 md:w-0 md:max-w-none lg:right-[max(0px,calc((100vw-1160px)/2))]"
    >
      <div className="absolute right-5 bottom-[calc(74px+env(safe-area-inset-bottom))] h-14 w-14 rounded-full bg-separator/60 lg:bottom-8 lg:right-8 lg:h-12 lg:w-12" />
    </div>
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
      systemRecordForm={Boolean(profile.sheet_name)}
      can={{
        createSchedule: perms.createSchedule,
        createMenu: perms.createMenu,
        createNotice: perms.createNotice,
        manageMembers: perms.manageMembers,
      }}
    />
  );
}

async function AuthenticatedSheetHeaderGuard() {
  const profile = await getCurrentProfile();
  if (!profile.sheet_name) return null;
  return (
    <SheetHeaderGuard
      profileId={profile.id}
      sheetName={profile.sheet_name}
      signature={profile.sheet_header_signature}
      isMiddleLong={profile.blocks.includes("middle_long")}
      recordFields={profile.record_fields}
    />
  );
}
