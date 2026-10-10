import { OctoberSheetSetup } from "@/components/features/OctoberSheetSetup";
import { needsSheetSetupConfirmation } from "@/lib/sheet-period";
import { Suspense } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { SystemGlassMarker } from "@/components/layout/glass/system-glass-state";
import { DesktopNav } from "@/components/layout/DesktopNav";
import { FAB } from "@/components/layout/FAB";
import { FloatingActionPosition } from "@/components/ui/floating-action";
import { SessionKeepAlive } from "@/components/layout/SessionKeepAlive";
import { PullToRefresh } from "@/components/layout/PullToRefresh";
import { VersionWatcher } from "@/components/features/VersionWatcher";
import { PushSubscriptionSync } from "@/components/features/PushSubscriptionSync";
import { SheetHeaderGuard } from "@/components/features/SheetHeaderGuard";
import { ToastProvider } from "@/components/ui/toast";
import { AppQueryProvider } from "@/components/providers/QueryProvider";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { ObEntryPrompt } from "@/components/features/ObEntryPrompt";
import { getMyObEntry } from "@/lib/queries/ob-entries";
import { jstToday } from "@/lib/date";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppQueryProvider>
    <ToastProvider>
      <div className="min-h-dvh bg-bg md:bg-[#eef1f5] lg:bg-[#e9edf3]">
        <div className="app-frame mx-auto flex min-h-dvh w-full md:gap-3 md:px-3 lg:gap-6 lg:px-6">
          <DesktopNav />
          <div className="app-main mx-auto min-h-dvh w-full max-w-md min-w-0 overflow-x-hidden md:overflow-x-clip bg-bg pb-[calc(52px+env(safe-area-inset-bottom))] md:mx-0 md:max-w-none md:flex-1 md:pb-24 md:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_28px_rgba(35,45,65,0.06)] lg:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_12px_40px_rgba(35,45,65,0.08)]">
            <SystemGlassMarker />
            <SessionKeepAlive />
            <PullToRefresh />
            {children}
            <Suspense fallback={<FabPlaceholder />}><AuthenticatedFab /></Suspense>
            <BottomNav />
            <Suspense fallback={null}><AuthenticatedObEntryPrompt /></Suspense>
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
    <FloatingActionPosition>
      <div aria-hidden="true" className="absolute right-5 bottom-[calc(74px+env(safe-area-inset-bottom))] h-14 w-14 rounded-full bg-separator/60 md:bottom-6 md:right-6 md:h-12 md:w-12" />
    </FloatingActionPosition>
  );
}

async function AuthenticatedFab() {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);
  return (
    <>

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
      sheetTransition={profile.sheet_transition}
      systemRecordForm={Boolean(profile.sheet_name)}
      can={{
        createSchedule: perms.createSchedule,
        createMenu: perms.createMenu,
        createNotice: perms.createNotice,
        manageMembers: perms.manageMembers,
      }}
    />
    </>
  );
}

async function AuthenticatedSheetHeaderGuard() {
  const profile = await getCurrentProfile();
  if (needsSheetSetupConfirmation(profile.sheet_transition)) return <OctoberSheetSetup profile={profile} prompt />;
  if (!profile.sheet_name) return null;
  return (
    <SheetHeaderGuard
      profileId={profile.id}
      sheetName={profile.sheet_name}
      signature={profile.sheet_header_signature}
      isMiddleLong={profile.blocks.includes("middle_long")}
      recordFields={profile.record_fields}
      octoberProfile={profile}
    />
  );
}

/** OB戦のエントリー確認。まずはシステムロールだけに出して様子を見る（オーナー指示 2026-09-26）。 */
async function AuthenticatedObEntryPrompt() {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) return null;
  if (needsSheetSetupConfirmation(profile.sheet_transition)) return null;
  const entry = await getMyObEntry(profile.id);
  return <ObEntryPrompt hasEntry={!!entry} today={jstToday()} />;
}
