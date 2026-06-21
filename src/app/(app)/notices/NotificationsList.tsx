"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionMenu } from "@/components/ui/action-menu";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { markNotificationAsRead, markAllNotificationsAsRead, deleteNotification } from "./actions";
import type { AppNotificationWithActor } from "@/types";

export function NotificationsList({
  initialNotifications,
  userId,
  onOpenNotice,
}: {
  initialNotifications: AppNotificationWithActor[];
  userId: string;
  /** お知らせ通知をタップしたとき、同じ画面の「お知らせ」タブで該当を開く */
  onOpenNotice?: (noticeId: string) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState(initialNotifications);

  const getMessage = (n: AppNotificationWithActor) => {
    const actorName = n.actor?.display_name ?? "誰か";
    switch (n.type) {
      case "comment":
        return `${actorName}さんがあなたの投稿にコメントしました`;
      case "notice":
        return `${actorName}さんがお知らせを投稿しました`;
      default:
        return "新しい通知があります";
    }
  };

  const getHref = (n: AppNotificationWithActor) => {
    if (!n.reference_id) return null;
    switch (n.reference_type) {
      case "record":
      case "tweet":
        return `/timeline#${n.reference_type}-${n.reference_id}`;
      case "notice":
        return `/notices#notice-${n.reference_id}`;
      default:
        return null;
    }
  };

  const handleTap = async (n: AppNotificationWithActor) => {
    if (!n.is_read) {
      setNotifications((prev) =>
        prev.map((it) => (it.id === n.id ? { ...it, is_read: true } : it))
      );
      markNotificationAsRead(n.id).catch(() => {});
      router.refresh();
    }
    // お知らせ通知は同じ画面の「お知らせ」タブで開く（ページ遷移しない）
    if (n.reference_type === "notice" && n.reference_id && onOpenNotice) {
      onOpenNotice(n.reference_id);
      return;
    }
    const href = getHref(n);
    if (href) {
      router.push(href);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((it) => it.id !== id));
      showToast("通知を削除しました");
    } catch (e) {
      showToast("削除に失敗しました");
      return false;
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setNotifications((prev) => prev.map((it) => ({ ...it, is_read: true })));
      await markAllNotificationsAsRead();
      router.refresh();
      showToast("すべて既読にしました");
    } catch (e) {
      showToast("エラーが発生しました");
    }
  };

  if (notifications.length === 0) {
    return <EmptyState title="通知はありません" />;
  }

  const hasUnread = notifications.some((n) => !n.is_read);

  return (
    <div className="space-y-3">
      {hasUnread && (
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="flex items-center gap-1.5 text-sm text-accent active:opacity-50 transition-opacity"
          >
            <CheckCircle2 size={16} />
            すべて既読にする
          </button>
        </div>
      )}

      {notifications.map((n) => (
        <Card
          key={n.id}
          className="relative flex items-center p-3 gap-3 overflow-hidden cursor-pointer active:bg-bg/50 transition-colors"
          onClick={() => handleTap(n)}
        >
          {/* Unread indicator */}
          <div className="w-2 flex justify-center shrink-0">
            {!n.is_read && (
              <div className="w-2 h-2 rounded-full bg-accent" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className={`text-[14px] leading-snug ${!n.is_read ? 'font-bold' : ''}`}>
              {getMessage(n)}
            </p>
            <p className="text-micro text-muted2 mt-1">
              {format(new Date(n.created_at), "M/d HH:mm", { locale: ja })}
            </p>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <ActionMenu
              onDelete={() => handleDelete(n.id)}
              deleteTitle="通知を削除しますか？"
              deleteDescription="この操作は元に戻せません。"
              deleteLabel="削除する"
            />
          </div>
        </Card>
      ))}
    </div>
  );
}
