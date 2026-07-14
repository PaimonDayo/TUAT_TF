import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { RoleManager } from "@/components/features/RoleManager";
import { AdminMemberList } from "@/components/features/AdminMemberList";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getAllProfiles, getAllRoleCategories, getAllRoles } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type { Profile } from "@/types";

export default async function AdminPage() {
  const profile = await getCurrentProfile();
  const permissions = permissionsOf(profile.roles);
  if (!permissions.manageMembers) redirect("/home");

  const [members, roles, categories] = await Promise.all([
    getAllProfiles() as Promise<Profile[]>,
    getAllRoles(),
    getAllRoleCategories(),
  ]);

  return (
    <>
      <SubHeader title="部員・ロール管理" backHref="/mypage" />

      <div className="px-4 pt-2 space-y-6">
        <section className="space-y-2">
          <p className="section-label">ロール</p>
          <p className="text-caption">
            ロールを作成し、システム管理・部員管理・予定・メニュー・お知らせの権限を設定できます。1人に複数のロールを付与できます。
          </p>
          <RoleManager
            roles={roles}
            members={members}
            categories={categories}
            canManageSystem={permissions.manageSystem}
          />
        </section>

        <section className="space-y-2">
          <p className="section-label">部員</p>
          <p className="text-caption">各部員にロールを付与・解除できます。</p>
          <AdminMemberList members={members} roles={roles} />
        </section>
      </div>
    </>
  );
}
