"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ProfileEditForm } from "@/components/features/ProfileEditForm";
import type { Profile } from "@/types";

export function EditProfileButton({
  profile,
  autoOpen = false,
}: {
  profile: Pick<Profile, "id" | "display_name" | "blocks" | "grade" | "avatar_url" | "goal">;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="プロフィール">
          <ProfileEditForm
            profile={profile}
            isSetup={autoOpen}
            onDone={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-card border border-separator text-danger text-[15px] font-semibold active:bg-bg"
    >
      <LogOut size={18} />
      {busy ? "ログアウト中…" : "ログアウト"}
    </button>
  );
}
