"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createClient } from "@/lib/supabase/client";
import { queryPersister } from "@/lib/client/query-persistence";

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
  }));
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  if (!userId) return <QueryClientProvider client={client}>{children}</QueryClientProvider>;

  const persister = queryPersister(userId);
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        buster: `timeline-v1:${userId}`,
        maxAge: 5 * 60 * 1000,
        dehydrateOptions: { shouldDehydrateQuery: (query) => query.queryKey[0] === "timeline" },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
