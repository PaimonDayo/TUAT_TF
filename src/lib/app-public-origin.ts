/** Only an explicit deployment setting overrides the request URL. */
export function configuredAppPublicOrigin(): string | undefined {
  const value = process.env.APP_PUBLIC_ORIGIN;
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("APP_PUBLIC_ORIGIN must be an HTTPS root URL"); }
  if (value !== url.origin || url.protocol !== "https:" || url.username || url.password ||
      url.hostname.includes("*") || /[\\\u0000-\u0020\u007f]/.test(value)) {
    throw new Error("APP_PUBLIC_ORIGIN must be an HTTPS root URL");
  }
  return url.origin;
}

export function getAppPublicOrigin(requestUrl: string | URL): string {
  return configuredAppPublicOrigin() ?? new URL(requestUrl).origin;
}
