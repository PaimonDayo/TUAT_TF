"use client";

import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

export function ShareButton({
  title,
  text,
  path,
  label = "共有する",
  className,
}: {
  title: string;
  text?: string;
  path: string;
  label?: string;
  className?: string;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);

  async function copyLink() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await copyText(url);
      setOpen(false);
      showToast("リンクをコピーしました", "success");
    } catch {
      showToast("リンクをコピーできませんでした");
    }
  }

  async function shareExternally() {
    const url = new URL(path, window.location.origin).toString();

    if (navigator.share) {
      setOpen(false);
      try {
        await navigator.share({
          title,
          text: [text, url].filter(Boolean).join("\n"),
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    await copyLink();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center text-muted active:opacity-50",
          className,
        )}
      >
        <Share2 size={19} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={"共有"}>
          <div className="space-y-2 pb-4">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 text-left active:bg-bg"
            >
              <Copy size={20} className="shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-headline">{"リンクをコピー"}</span>
                <span className="mt-0.5 block text-caption">
                  {"お知らせなどに貼り付けられます"}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void shareExternally()}
              className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 text-left active:bg-bg"
            >
              <Share2 size={20} className="shrink-0 text-accent" />
              <span className="text-headline">{"ほかのアプリで共有"}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
