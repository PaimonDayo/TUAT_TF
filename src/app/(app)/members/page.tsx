import { SubHeader } from "@/components/layout/SubHeader";
import { MemberDirectory } from "@/components/features/MemberDirectory";
import { getMembersList } from "@/lib/queries";

export default async function MembersPage() {
  const members = await getMembersList();

  return (
    <>
      <SubHeader title="メンバー一覧" backHref="/mypage" backLabel="マイページ" />
      <div className="pt-2">
        <MemberDirectory members={members} />
      </div>
    </>
  );
}
