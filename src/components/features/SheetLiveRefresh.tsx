"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Keeps a sheet refresh off the server-rendering critical path. */
export function SheetLiveRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const attempted = useRef(false);

  useEffect(() => {
    if (!enabled || attempted.current) return;
    attempted.current = true;
    void fetch("/api/sheets/refresh-self", { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { changed?: boolean } | null) => {
        if (result?.changed) router.refresh();
      })
      .catch(() => undefined);
  }, [enabled, router]);

  return null;
}
