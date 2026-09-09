"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { CompetitionRow } from "@/types";

type Catalog = { events: CompetitionEvent[]; competitions: CompetitionRow[] };

const EMPTY: Catalog = { events: [], competitions: [] };
/** 一度読んだらセッション中は使い回す（結果フォームを開くたびに引かない） */
let cache: Catalog | null = null;

/**
 * 結果フォーム用の種目マスタと大会マスタ。
 * FAB は全画面に常駐するので、フォームを開いたときに初めて読む。
 */
export function useCompetitionCatalog(enabled: boolean): Catalog {
  const [catalog, setCatalog] = useState<Catalog>(cache ?? EMPTY);

  useEffect(() => {
    if (!enabled || cache) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const [events, competitions] = await Promise.all([
        supabase
          .from("competition_events")
          .select("name,sort_order,measure_type")
          .order("sort_order")
          .order("name"),
        supabase
          .from("competitions")
          .select("id,name,starts_on,ends_on,sort_order,is_countdown")
          .order("sort_order")
          .order("starts_on", { ascending: false }),
      ]);
      if (events.error || competitions.error) return;
      cache = {
        events: (events.data ?? []) as CompetitionEvent[],
        competitions: (competitions.data ?? []) as CompetitionRow[],
      };
      if (active) setCatalog(cache);
    })();
    return () => {
      active = false;
    };
  }, [enabled]);

  return catalog;
}
