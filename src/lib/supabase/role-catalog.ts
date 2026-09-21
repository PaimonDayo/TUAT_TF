import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/types";

export const ROLE_CATALOG_TAG = "role-catalog";
// Only shared role definitions enter this cache, never cookies or assignments.
const cachedCatalog = unstable_cache(async (backendUrl: string): Promise<AppRole[]> => {
  if (backendUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Role cache backend mismatch");
  const { data, error } = await createAdminClient().from("roles").select("*");
  if (error || !data) throw new Error("Failed to load role definitions");
  return data;
}, ["role-catalog-v1"], { revalidate: 3 * 60 * 60, tags: [ROLE_CATALOG_TAG] });

export function getSharedRoleCatalog(): Promise<AppRole[]> {
  return cachedCatalog(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}
