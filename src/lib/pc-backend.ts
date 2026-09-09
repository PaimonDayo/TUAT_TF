import { createHmac, timingSafeEqual } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type PcEndpoint = {
  version: 1;
  origin: string;
  instanceId: string;
  expiresAt: number;
  signature: string;
};

export function verifyPcEndpoint(value: unknown, key: string, instanceId: string, now = Date.now()): PcEndpoint {
  const data = value as Partial<PcEndpoint> | null;
  if (!data || data.version !== 1 || data.instanceId !== instanceId ||
      typeof data.origin !== "string" || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(data.origin) ||
      typeof data.expiresAt !== "number" || data.expiresAt <= now || data.expiresAt > now + 300_000 ||
      typeof data.signature !== "string" || !/^[a-f0-9]{64}$/.test(data.signature) || key.length < 32) {
    throw new Error("PC endpoint is unavailable");
  }
  const expected = createHmac("sha256", key).update(JSON.stringify([1, data.origin, data.instanceId, data.expiresAt])).digest();
  if (!timingSafeEqual(expected, Buffer.from(data.signature, "hex"))) throw new Error("Invalid PC endpoint signature");
  return data as PcEndpoint;
}

let cached: { data: PcEndpoint; until: number; config: string } | undefined;
let pending: Promise<PcEndpoint> | undefined;

export async function getPcEndpoint(force = false): Promise<PcEndpoint> {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, PC_BACKEND_INSTANCE_ID, PC_BACKEND_BRIDGE_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !/^[a-f0-9]{32}$/.test(R2_ACCOUNT_ID) || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME ||
      !PC_BACKEND_INSTANCE_ID || !/^[a-f0-9-]{36}$/.test(PC_BACKEND_INSTANCE_ID) || !PC_BACKEND_BRIDGE_KEY) throw new Error("PC backend is not configured");
  const config = JSON.stringify([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, PC_BACKEND_INSTANCE_ID, PC_BACKEND_BRIDGE_KEY]);
  if (!force && cached?.config === config && cached.until > Date.now() && cached.data.expiresAt > Date.now()) return cached.data;
  if (!force && pending) return pending;
  const request = (async () => {
    const client = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, maxAttempts: 2 });
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: `ops/pc-backend/${PC_BACKEND_INSTANCE_ID}/endpoint.json` }), { abortSignal: AbortSignal.timeout(6000) });
      if (!result.Body || (result.ContentLength ?? 0) > 4096) throw new Error("Invalid PC endpoint");
      const data = verifyPcEndpoint(JSON.parse(await result.Body.transformToString()), PC_BACKEND_BRIDGE_KEY, PC_BACKEND_INSTANCE_ID);
      cached = { data, config, until: Date.now() + 10_000 };
      return data;
    } finally { client.destroy(); }
  })();
  pending = request;
  try { return await request; } finally { if (pending === request) pending = undefined; }
}

/** No automatic replay: even a failed response may follow a committed write. */
export async function pcBackendFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const source = new URL(request.url);
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (source.origin !== base.origin || !source.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)) throw new Error("Invalid backend destination");
  const path = source.pathname.slice(base.pathname.replace(/\/$/, "").length);
  if (!/^\/(auth|rest|storage|functions)\/v1(?:\/|$)/.test(path)) throw new Error("Invalid backend API");
  const endpoint = await getPcEndpoint();
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("x-pc-browser");
  headers.set("x-pc-backend-key", process.env.PC_BACKEND_BRIDGE_KEY!);
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  return fetch(`${endpoint.origin}/backend${path}${source.search}`, {
    method: request.method, headers, body, cache: "no-store", redirect: "manual",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
  });
}
