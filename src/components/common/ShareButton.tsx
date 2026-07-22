"use client";

import { Share2 } from "lucide-react";
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

  async function share() {
    const url = new URL(path, window.location.origin).toString();

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await copyText(url);
      showToast("\u30ea\u30f3\u30af\u3092\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f", "success");
    } catch {
      showToast("\u5171\u6709\u30ea\u30f3\u30af\u3092\u30b3\u30d4\u30fc\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center text-muted active:opacity-50",
        className,
      )}
    >
      <Share2 size={19} />
    </button>
  );
}
