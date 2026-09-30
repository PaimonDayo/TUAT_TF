"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { OctoberSheetSetup } from "@/components/features/OctoberSheetSetup";
import { SHEET_SETUP_PATH } from "@/lib/sheet-period";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "@/components/features/SheetHeaderSetupDialog";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import type { Profile, RecordFieldDef } from "@/types";

export function SheetHeaderGuard({
  sheetName,
  signature,
  recordFields,
  isMiddleLong,
  octoberProfile,
}: {
  profileId: string;
  sheetName: string | null;
  signature: string | null;
  recordFields: RecordFieldDef[];
  isMiddleLong: boolean;
  octoberProfile?: Profile;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const disconnected = octoberProfile?.sheet_transition?.mode === "off";
  const dedicatedSetup = !!octoberProfile && [SHEET_SETUP_PATH, "/settings/sheet-setup"].includes(pathname);
  const [data, setData] = useState<SheetHeaderData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sheetName || dedicatedSetup || disconnected) return;
    let active = true;
    void fetch(`/api/sheets/header?sheetName=${encodeURIComponent(sheetName)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<SheetHeaderData> : null)
      .then((current) => {
        if (active && current) setData(current.signature !== signature ? current : null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [sheetName, signature, dedicatedSetup, isMiddleLong, disconnected]);

  async function confirm(fields: RecordFieldDef[], nextSignature: string) {
    setBusy(true);
    const response = await fetch("/api/record-form-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: recordFieldsToJson(fields), signature: nextSignature }),
    });
    setBusy(false);
    if (!response.ok) return;
    setData(null);
    router.refresh();
  }

  if (dedicatedSetup || disconnected) return null;
  if (data && octoberProfile) return <OctoberSheetSetup key={data.signature} profile={octoberProfile} prompt />;
  return data ? (
    <SheetHeaderSetupDialog
      key={data.signature}
      open
      data={data}
      initialFields={recordFields}
      isMiddleLong={isMiddleLong}
      busy={busy}
      onCancel={() => setData(null)}
      onConfirm={(fields, nextSignature) => void confirm(fields, nextSignature)}
    />
  ) : null;
}
