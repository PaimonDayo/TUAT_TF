"use client";

import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

async function copyText(text: string) {
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
  label = "\u5171\u6709\u3059\u308b",
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
      showToast("\u30ea\u30f3\u30af\u3092\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f", "success");
    } catch {
      showToast("\u5171\u6709\u30ea\u30f3\u30af\u3092\u30b3\u30d4\u30fc\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f");
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
        <SheetContent title={"\u5171\u6709"}>
          <div className="space-y-2 pb-4">
            <button
              type="button"
              onClick={() => void copyLink()}
              className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 text-left active:bg-bg"
            >
              <Copy size={20} className="shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-headline">{"\u30ea\u30f3\u30af\u3092\u30b3\u30d4\u30fc"}</span>
                <span className="mt-0.5 block text-caption">
                  {"\u304a\u77e5\u3089\u305b\u306a\u3069\u306b\u8cbc\u308a\u4ed8\u3051\u3089\u308c\u307e\u3059"}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void shareExternally()}
              className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3.5 text-left active:bg-bg"
            >
              <Share2 size={20} className="shrink-0 text-accent" />
              <span className="text-headline">{"\u307b\u304b\u306e\u30a2\u30d7\u30ea\u3067\u5171\u6709"}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
