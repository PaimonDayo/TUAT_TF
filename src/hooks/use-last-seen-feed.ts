"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { newestFeedTime } from "@/lib/feed-unread";
import type { FeedItem } from "@/types";

const STORAGE_PREFIX = "timeline-last-seen:";

function readLastSeen(storageKey: string): number | null {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    // プライベートモードなどで読めないときは、未読ラインを出さないだけにする。
    return null;
  }
}

/** 端末に保存する値を購読しない（開いた時点の値を固定して使う）ための空の購読。 */
const noSubscribe = () => () => {};

/**
 * 「最後にタイムラインを見た時刻」を端末内に持つ。
 * 画面を開いた時点の値を返し続けるので、見ている最中に未読ラインが動かない。
 * 保存先は端末内なので、機種変更や再インストールでは引き継がれない（引き継げなくても
 * 線が出なくなるだけで、投稿の表示自体には影響しない）。
 */
export function useLastSeenFeed(userId: string, items: readonly FeedItem[]): number | null {
  const storageKey = STORAGE_PREFIX + userId;
  const cached = useRef<{ key: string; value: number | null } | null>(null);

  const getSnapshot = useCallback(() => {
    if (cached.current?.key !== storageKey) {
      cached.current = { key: storageKey, value: readLastSeen(storageKey) };
    }
    return cached.current.value;
  }, [storageKey]);

  const lastSeenAt = useSyncExternalStore(noSubscribe, getSnapshot, () => null);

  // 表示できた分まで既読にする。画面上の線は上の値で固定してあるので動かない。
  useEffect(() => {
    const newest = newestFeedTime(items);
    if (newest === null) return;
    const stored = readLastSeen(storageKey);
    if (stored !== null && stored >= newest) return;
    try {
      window.localStorage.setItem(storageKey, String(newest));
    } catch {
      // 保存できなくても表示は変わらないため、そのまま続行する。
    }
  }, [items, storageKey]);

  return lastSeenAt;
}
