const authMethods: Record<string, string[]> = {
  "/auth/v1/authorize": ["GET"], "/auth/v1/callback": ["GET", "POST"],
  "/auth/v1/token": ["POST"], "/auth/v1/user": ["GET"],
  "/auth/v1/logout": ["POST"], "/auth/v1/settings": ["GET"],
};

export function allowedPcBrowserApi(path: string, method: string, search: URLSearchParams) {
  if (/%(?:2f|5c|2e)|\\|(?:^|\/)\.{1,2}(?:\/|$)/i.test(path)) return false;
  if (path.startsWith("/rest/v1/") && ["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method)) return true;
  if (!authMethods[path]?.includes(method)) return false;
  if (path === "/auth/v1/authorize" && search.get("provider") !== "google") return false;
  if (path === "/auth/v1/token" && !["pkce", "refresh_token"].includes(search.get("grant_type") ?? "")) return false;
  return true;
}

export function isMemberBearer(value: string | null): boolean {
  if (!value?.startsWith("Bearer ")) return false;
  try {
    const parts = value.slice(7).split(".");
    if (parts.length !== 3) return false;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    // This only rejects privileged keys at the boundary; Supabase verifies the JWT signature and RLS.
    return claims.role === "authenticated" && typeof claims.sub === "string" && /^[a-f0-9-]{36}$/i.test(claims.sub);
  } catch { return false; }
}
