"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, UserRound, ChevronRight } from "lucide-react";
import { FormModal } from "@/components/ui/form-modal";
import { ProfileEditForm } from "@/components/features/ProfileEditForm";
import type { Profile } from "@/types";

export function EditProfileButton({
  profile,
  autoOpen = false,
  enableSheetHeaderSetup = false,
  settingsRow = false,
}: {
  profile: Pick<
    Profile,
    | "id"
    | "display_name"
    | "blocks"
    | "events"
    | "grade"
    | "avatar_url"
    | "sheet_name"
    | "record_fields"
    | "sheet_header_signature"
    | "record_source"
    | "sheet_transition"
  >;
  autoOpen?: boolean;
  enableSheetHeaderSetup?: boolean;
  settingsRow?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="プロフィールを編集"
        className={settingsRow ? "flex w-full items-center gap-3 px-4 py-3 text-left active:bg-bg" : "h-9 px-1 flex items-center gap-1 text-accent text-[15px] pressable"}
      >
        {settingsRow ? <><UserRound size={19} className="shrink-0 text-accent" /><span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">プロフィールを編集</span><span className="block text-micro text-muted">名前・アイコン・ブロック・種目・学年</span></span><ChevronRight size={18} className="shrink-0 text-muted" /></> : <><Pencil size={18} />編集</>}
      </button>
      <FormModal open={open} onOpenChange={setOpen} title="プロフィール">
        <ProfileEditForm
          profile={profile}
          isSetup={autoOpen}
          enableSheetHeaderSetup={enableSheetHeaderSetup}
          separateRecordSettings={settingsRow}
          onDone={() => { setOpen(false); if (settingsRow && autoOpen) router.replace("/mypage/settings"); }}
        />
      </FormModal>
    </>
  );
}
