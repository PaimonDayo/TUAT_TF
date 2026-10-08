"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Home, NotebookTabs, Newspaper, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSystemGlass } from "./glass/system-glass-state";

const ITEMS = [
  { href: "/home", label: "ホーム", icon: Home },
  { href: "/schedule", label: "予定", icon: CalendarDays },
  { href: "/timeline", label: "タイムライン", icon: Newspaper },
  { href: "/notes", label: "ノート", icon: NotebookTabs },
  { href: "/mypage", label: "マイページ", icon: User },
];

export function DesktopNav() {
  const newUi = useSystemGlass();
  const pathname = usePathname();

  return (
    <aside data-new-ui-surface={newUi || undefined} data-ui-sidebar className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col py-4 md:flex lg:py-6">
      <Link
        data-ui-row
        href="/home"
        aria-label="ホーム"
        className="mx-2 flex items-center justify-center rounded-card px-2 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-sm font-black tracking-tight text-white shadow-sm">
          TF
        </span>
      </Link>

      <nav aria-label="メインナビゲーション" className="mt-5 space-y-1.5 lg:mt-7">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              data-ui-row
              key={href}
              href={href}
              aria-label={label}
              title={label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 items-center justify-center rounded-xl px-2 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                active
                  ? "bg-card text-accent shadow-sm ring-1 ring-separator/70"
                  : "text-muted2 hover:bg-card/65 hover:text-ink",
              )}
            >
              <Icon size={21} strokeWidth={active ? 2.4 : 2} />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
