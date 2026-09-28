/** Only browser push services supported by this application. */
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 4096) return false;
  // Match the raw authority too: reject credentials, ports, escapes and URL normalization.
  return /^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)?push\.apple\.com)\/[^\s\\#]+$/.test(endpoint);
}
