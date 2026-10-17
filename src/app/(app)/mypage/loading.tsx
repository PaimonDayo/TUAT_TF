import { MyPageSkeleton } from "@/components/ui/page-skeletons";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { Suspense } from "react";

export default function Loading() {
  return <Suspense fallback={<MyPageSkeleton profilePending />}><ProfileLoading /></Suspense>;
}

async function ProfileLoading() {
  const profile = await getCurrentProfile();
  const permissions = permissionsOf(profile.roles);
  const adminRows = Number(permissions.manageMembers) + Number(permissions.createSchedule) + (permissions.manageSystem ? 2 : 0);
  return <MyPageSkeleton showTraining={profile.blocks.includes("middle_long")} adminRows={adminRows} />;
}
