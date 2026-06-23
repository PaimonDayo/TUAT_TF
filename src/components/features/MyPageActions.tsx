"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { FormModal } from "@/components/ui/form-modal";
import { ProfileEditForm } from "@/components/features/ProfileEditForm";
import type { Profile } from "@/types";

export function EditProfileButton({
  profile,
  autoOpen = false,
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
  >;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="プロフィールを編集"
        className="h-9 px-1 flex items-center gap-1 text-accent text-[15px] active:opacity-50"
      >
        <Pencil size={18} />
        編集
      </button>
      <FormModal open={open} onOpenChange={setOpen} title="プロフィール">
        <ProfileEditForm
          profile={profile}
          isSetup={autoOpen}
          onDone={() => setOpen(false)}
        />
      </FormModal>
    </>
  );
}
