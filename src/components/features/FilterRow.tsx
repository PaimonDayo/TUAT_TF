"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** 部員の絞り込みと通知先の条件選択に共通する選択行。 */
export function FilterRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return <button data-ui-row aria-pressed={checked} type="button" onClick={onClick} className={cn("flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm", checked ? "bg-accent/10 font-semibold text-ink" : "active:bg-bg text-muted2")}><span className="flex-1">{label}</span>{checked && <Check size={18} className="text-accent" />}</button>;
}
