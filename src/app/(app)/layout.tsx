import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";
import { SessionKeepAlive } from "@/components/layout/SessionKeepAlive";
import { VersionWatcher } from "@/components/features/VersionWatcher";
import { PullToRefresh } from "@/components/layout/PullToRefresh";
import { ToastProvider } from "@/components/ui/toast";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const perms = permissionsOf(profile.roles);

  return (
    <ToastProvider>
      <div className="mx-auto w-full max-w-md min-h-dvh bg-bg overflow-x-hidden pb-[calc(52px+env(safe-area-inset-bottom))]">
        <SessionKeepAlive />
        <PullToRefresh />
        {children}
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
          can={{
            createSchedule: perms.createSchedule,
            createNotice: perms.createNotice,
            manageMembers: perms.manageMembers,
          }}
        />
        <BottomNav />
        <VersionWatcher />
      </div>
    </ToastProvider>
  );
}
