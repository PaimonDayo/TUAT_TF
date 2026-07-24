import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUnreadNotificationCount } from "@/lib/queries";
import { NotificationBell } from "@/components/layout/NotificationBell";

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
  let userId = "";
  try {
    const profile = await getCurrentProfile();
    userId = profile.id;
    unreadCount = await getUnreadNotificationCount(profile.id);
  } catch {
    // Ignore error if not logged in or during static generation
  }

  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)] lg:pt-0">
      <div className="h-12 px-4 flex items-center justify-between lg:h-16 lg:px-6">
        <h1 className={large ? "text-large-title" : "text-title"}>{title}</h1>
        <div className="flex items-center gap-1">
          {right}
          {userId && (
            <NotificationBell
              key={`${userId}-${unreadCount}`}
              userId={userId}
              initialUnread={unreadCount}
            />
          )}
        </div>
      </div>
    </header>
  );
}
