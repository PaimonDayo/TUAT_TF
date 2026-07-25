"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "@/components/features/SheetHeaderSetupDialog";
import { createClient } from "@/lib/supabase/client";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import { safeUpdate } from "@/lib/safe-update";

export function SheetHeaderGuard({
  profileId,
  sheetName,
  signature,
  isMiddleLong,
}: {
  profileId: string;
  sheetName: string | null;
  signature: string | null;
  isMiddleLong: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<SheetHeaderData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sheetName) return;
    let active = true;
    void fetch(`/api/sheets/header?sheetName=${encodeURIComponent(sheetName)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<SheetHeaderData> : null)
      .then((current) => {
        if (active && current && current.signature !== signature) setData(current);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [sheetName, signature]);

  async function confirm(fields: Parameters<NonNullable<React.ComponentProps<typeof SheetHeaderSetupDialog>["onConfirm"]>>[0], nextSignature: string) {
    setBusy(true);
    const result = await safeUpdate(
      createClient(),
      "profiles",
      { record_fields: recordFieldsToJson(fields), sheet_header_signature: nextSignature },
      { id: profileId },
    );
    setBusy(false);
    if (!result.ok) return;
    setData(null);
    router.refresh();
  }

  return data ? (
    <SheetHeaderSetupDialog
      key={data.signature}
      open
      data={data}
      isMiddleLong={isMiddleLong}
      busy={busy}
      onCancel={() => setData(null)}
      onConfirm={(fields, nextSignature) => void confirm(fields, nextSignature)}
    />
  ) : null;
}
