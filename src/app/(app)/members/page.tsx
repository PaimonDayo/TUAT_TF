import { SubHeader } from "@/components/layout/SubHeader";
import { MemberDirectory } from "@/components/features/MemberDirectory";
import { PendingApprovals } from "@/components/features/PendingApprovals";
import { getMembersList, getPendingProfiles } from "@/lib/queries";

export default async function MembersPage() {
  const [members, pending] = await Promise.all([
    getMembersList(),
    getPendingProfiles(),
  ]);

  return (
    <>
      <SubHeader title="メンバー一覧" backHref="/mypage" />
      <div className="pt-2">
        <PendingApprovals pending={pending} />
        <MemberDirectory members={members} />
      </div>
    </>
  );
}
