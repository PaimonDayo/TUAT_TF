"use client";

import { useState } from "react";
import { useBooleanPreference } from "@/hooks/use-boolean-preference";

export function useFeedDisplay({
  initialCompact,
  cookieName,
}: {
  initialCompact: boolean;
  cookieName?: string;
}) {
  const [compact, setCompact] = useBooleanPreference(initialCompact, cookieName);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleCompact() {
    setExpanded(new Set());
    setCompact((current) => !current);
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
