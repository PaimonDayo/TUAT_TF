/** Server-only transport credentials; never import this from a browser client. */
export function pcServerOptions() {
  if (process.env.PC_TRIAL_VERCEL !== "true") return {};
  const key = process.env.PC_TRIAL_BRIDGE_KEY;
  if (!key || key.length < 32) throw new Error("Private PC bridge is not configured");
  return { global: { headers: { "x-pc-trial-bridge": key } } };
}
