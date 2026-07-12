import { Suspense } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";
import { SessionKeepAlive } from "@/components/layout/SessionKeepAlive";
import { VersionWatcher } from "@/components/features/VersionWatcher";
import { FreezeProbe } from "@/components/features/FreezeProbe";
import { ToastProvider } from "@/components/ui/toast";
import { AppQueryProvider } from "@/components/providers/QueryProvider";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppQueryProvider>
    <ToastProvider>
      <div className="mx-auto min-h-dvh w-full max-w-md overflow-x-hidden bg-bg pb-[calc(52px+env(safe-area-inset-bottom))]">
        <SessionKeepAlive />
        {children}
        <Suspense fallback={null}><AuthenticatedFab /></Suspense>
        <Suspense fallback={null}><BottomNav /></Suspense>
        <VersionWatcher />
        <FreezeProbe />
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
        createNotice: perms.createNotice,
        manageMembers: perms.manageMembers,
      }}
    />
  );
}
