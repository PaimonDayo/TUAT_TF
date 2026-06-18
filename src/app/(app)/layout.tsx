import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";
import { SessionKeepAlive } from "@/components/layout/SessionKeepAlive";
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
    <div className="mx-auto w-full max-w-md min-h-dvh bg-bg pb-[calc(52px+env(safe-area-inset-bottom))]">
      <SessionKeepAlive />
      {children}
      <FAB
        userId={profile.id}
        isMiddleLong={profile.blocks?.includes("middle_long") ?? false}
        can={{
          createSchedule: perms.createSchedule,
          createMenu: perms.createMenu,
          createNotice: perms.createNotice,
        }}
      />
      <BottomNav />
    </div>
  );
}
