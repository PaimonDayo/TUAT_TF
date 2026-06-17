import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { AdminMemberList } from "@/components/features/AdminMemberList";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getAllProfiles } from "@/lib/queries";
import type { Profile } from "@/types";

export default async function AdminPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin") redirect("/home");

  const members = (await getAllProfiles()) as Profile[];

  return (
    <>
      <SubHeader title="部員管理" backHref="/mypage" backLabel="マイページ" />

      <div className="px-4 pt-2 space-y-3">
        <p className="text-caption">
          ロールを変更すると、その部員ができる操作（予定作成・お知らせ投稿など）が変わります。
        </p>
        <AdminMemberList members={members} />
      </div>
    </>
  );
}
