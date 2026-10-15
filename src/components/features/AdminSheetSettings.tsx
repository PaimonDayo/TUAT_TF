import { MemberDirectory } from "@/components/features/MemberDirectory";
import type { MemberSheetSettings } from "@/lib/queries";
import { SHEET_LINK_STATUS_LABELS } from "@/lib/sheet-input-mode";

export function AdminSheetSettings({ members }: { members: MemberSheetSettings[] }) {
  return <div className="pb-6 pt-2">
    <p className="px-4 pb-4 text-caption text-muted2">部員を選ぶと、期間ごとの連携項目を確認・編集できます。</p>
    <MemberDirectory
      members={members}
      memberHrefPrefix="/admin/sheets"
      memberBadges={Object.fromEntries(members.map((member) => [member.id, SHEET_LINK_STATUS_LABELS[member.link_status]]))}
    />
  </div>;
}
