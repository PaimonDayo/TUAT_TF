import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";
import { SessionKeepAlive } from "@/components/layout/SessionKeepAlive";
import { getCurrentProfile } from "@/lib/supabase/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  return (
    <div className="mx-auto w-full max-w-md min-h-dvh bg-bg pb-[calc(52px+env(safe-area-inset-bottom))]">
      <SessionKeepAlive />
      {children}
      <FAB profile={{ id: profile.id, blocks: profile.blocks, role: profile.role }} />
      <BottomNav />
    </div>
  );
}
