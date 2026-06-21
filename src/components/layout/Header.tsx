import Link from "next/link";
import { Bell } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUnreadNotificationCount } from "@/lib/queries";

/** 全タブ統一ヘッダー（高さ48px / 右にベルアイコン固定） */
export async function Header({
  title,
  large = false,
  right,
}: {
  title: string;
  large?: boolean;
  right?: React.ReactNode;
}) {
  let unreadCount = 0;
  try {
    const profile = await getCurrentProfile();
    unreadCount = await getUnreadNotificationCount(profile.id);
  } catch (e) {
    // Ignore error if not logged in or during static generation
  }

  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      <div className="h-12 px-4 flex items-center justify-between">
        <h1 className={large ? "text-large-title" : "text-title"}>{title}</h1>
        <div className="flex items-center gap-1">
          {right}
          <Link
            href="/notices"
            aria-label="お知らせ"
            className="relative h-9 w-9 flex items-center justify-center text-accent active:opacity-50"
          >
            <Bell size={22} strokeWidth={2} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-bg" />
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
