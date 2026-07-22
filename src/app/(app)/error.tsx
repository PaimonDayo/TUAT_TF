"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("App route failed to render", { error, digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-separator bg-card p-6 text-center">
        <AlertTriangle className="mx-auto text-danger" size={28} aria-hidden="true" />
        <h1 className="mt-3 text-title">{"\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f"}</h1>
        <p className="mt-2 text-body text-muted2">
          {"\u901a\u4fe1\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u3001\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002"}
        </p>
        <Button className="mt-5 w-full" onClick={() => unstable_retry()}>
          <RefreshCw size={18} aria-hidden="true" />
          {"\u518d\u8a66\u884c"}
        </Button>
      </div>
    </main>
  );
}
