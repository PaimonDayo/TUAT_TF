"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "@/components/features/SheetHeaderSetupDialog";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import type { RecordFieldDef } from "@/types";

export function SheetHeaderGuard({
  sheetName,
  signature,
  recordFields,
  isMiddleLong,
}: {
  profileId: string;
  sheetName: string | null;
  signature: string | null;
  recordFields: RecordFieldDef[];
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