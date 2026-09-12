import { Suspense } from "react";
import { getCurrentUserId } from "@/lib/supabase/auth";
import { getUnreadNotificationCount } from "@/lib/queries";
import { NotificationBell } from "@/components/layout/NotificationBell";

/**
 * 全タブ統一ヘッダー（高さ48px / 右にベルアイコン固定）。
 *
 * タイトルは何も待たずに出す。以前はヘッダー自体が自分のプロフィールと未読数を
 * 取りに行っていたため、どの画面もそこが終わるまで見出しすら出せず、画面全体が
 * スケルトンのまま止まっていた。通信が要るのはベルの未読数だけなので、そこだけを
 * 切り離して後から流し込む（待っている間もベルの場所は空けておく）。
 */
export function Header({
  title,
  large = false,
  right,
  besideTitle,
}: {
  title: string;
  large?: boolean;
  right?: React.ReactNode;
  besideTitle?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)] lg:pt-0">
      <div className="h-12 px-4 flex items-center justify-between md:px-6 lg:h-16">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className={large ? "shrink-0 text-large-title" : "shrink-0 text-title"}>{title}</h1>
          {besideTitle}
        </div>
        <div className="flex items-center gap-1">
          {right}
          <Suspense fallback={<div className="h-9 w-9" aria-hidden="true" />}>
            <HeaderBell />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

/**
 * ベルだけは未読数のために通信が要るので、ヘッダー本体とは別に読み込む。
 * 未読数に要るのは自分のIDだけなので、プロフィールの取得は待たない
 * （待つとどの画面でもDBへの往復が1回ぶん直列に増える）。
 */
async function HeaderBell() {
  let unreadCount = 0;
  let userId = "";
  try {
    userId = await getCurrentUserId();
    unreadCount = await getUnreadNotificationCount(userId);
  } catch {
    // Ignore error if not logged in or during static generation
  }
  if (!userId) return null;
  return (
    <NotificationBell
      key={`${userId}-${unreadCount}`}
      userId={userId}
      initialUnread={unreadCount}
    />
  );
}
