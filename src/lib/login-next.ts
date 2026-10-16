/** OAuth may return only to a root-relative path in this application. */
export function safeLoginNext(value: string | null | undefined): string {
  const fallback = "/home";
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const base = "https://login.invalid";
    const destination = new URL(value, base);
    if (destination.origin !== base || destination.pathname.startsWith("//")) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch { return fallback; }
}
