"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Home, NotebookTabs, Newspaper, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/home", label: "ホーム", icon: Home },
  { href: "/schedule", label: "予定", icon: CalendarDays },
  { href: "/timeline", label: "タイムライン", icon: Newspaper },
  { href: "/notes", label: "ノート", icon: NotebookTabs },
  { href: "/mypage", label: "マイページ", icon: User },
];

export function DesktopNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col py-6 lg:flex">
      <Link
        href="/home"
        className="mx-2 flex items-center gap-3 rounded-2xl px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-sm font-black tracking-tight text-white shadow-sm">
          TF
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-bold leading-5 text-ink">TUAT T&amp;F</span>
          <span className="block text-[11px] leading-4 text-muted2">Track &amp; Field</span>
        </span>
      </Link>

      <nav aria-label="メインナビゲーション" className="mt-7 space-y-1.5">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-xl px-4 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                active
                  ? "bg-card text-accent shadow-sm ring-1 ring-separator/70"
                  : "text-muted2 hover:bg-card/65 hover:text-ink",
              )}
            >
              <Icon size={21} strokeWidth={active ? 2.4 : 2} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <p className="mt-auto px-4 text-[11px] leading-5 text-muted">
        東京農工大学 陸上競技部
      </p>
    </aside>
  );
}
