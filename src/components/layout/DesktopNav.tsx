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
    <aside data-new-ui-surface={newUi || undefined} data-ui-sidebar className="sticky top-4 hidden h-[calc(100dvh-32px)] w-20 shrink-0 self-start flex-col overflow-y-auto p-2 md:flex">
      <nav aria-label="メインナビゲーション" className="space-y-1.5">
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
                "flex h-12 items-center justify-center rounded-control px-2 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
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
