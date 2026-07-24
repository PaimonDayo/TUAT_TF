"use client";

import { useState } from "react";

export function useFeedDisplay({
  initialCompact,
  cookieName,
}: {
  initialCompact: boolean;
  cookieName?: string;
}) {
  const [compact, setCompact] = useState(initialCompact);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleCompact() {
    setExpanded(new Set());
    setCompact((current) => {
      const next = !current;
      if (cookieName) {
        document.cookie = `${cookieName}=${next ? "1" : "0"};path=/;max-age=31536000;samesite=lax`;
      }
      return next;
    });
  }

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function isCompact(key: string) {
    return compact && !expanded.has(key);
  }

  return { compact, toggleCompact, toggleExpanded, isCompact };
}
