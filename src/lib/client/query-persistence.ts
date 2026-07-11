"use client";

import { clear, createStore, del, get, set } from "idb-keyval";
import type { Persister, PersistedClient } from "@tanstack/react-query-persist-client";

const store = createStore("tuat-tf-app", "query-cache");

export function queryPersister(userId: string): Persister {
  const key = `query-cache:${userId}`;
  return {
    persistClient: (client: PersistedClient) => set(key, client, store),
    restoreClient: () => get<PersistedClient>(key, store),
    removeClient: () => del(key, store),
  };
}

export function clearPersistedQueries() {
  return clear(store);
}
