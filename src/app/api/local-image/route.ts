import { LocalImageStorageError, localImageStorageEnabled, readLocalImage, verifyLocalImageSignature } from "@/lib/local-image-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(request: Request) {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const failure = (status: number) => Response.json({ error: status === 503 ? "画像を取得できませんでした" : "画像が見つかりません" }, { status, headers });
  try {
    if (!localImageStorageEnabled()) return failure(404);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].length !== 3 || ["key", "expires", "signature"].some(name => query.getAll(name).length !== 1)) return failure(403);
    const key = query.get("key")!;
    if (!verifyLocalImageSignature(key, query.get("expires")!, query.get("signature")!)) return failure(403);
    // The signature is a bounded bearer capability, like a private R2 signed URL.
    // It can only be issued after the existing image route's auth/RLS checks.
    const image = await readLocalImage(key, request.method === "HEAD");
    // Keep the avatar's existing six-day private cache within the signature lifetime.
    const remaining = Math.max(0, Number(query.get("expires")) - Math.floor(Date.now() / 1000));
    headers.set("cache-control", `private, max-age=${Math.min(remaining, key.startsWith("avatars/") ? 6 * 86400 : 240)}`);
    headers.set("content-type", image.contentType);
    headers.set("content-length", String(image.size));
    return new Response(image.bytes ? new Uint8Array(image.bytes) : null, { headers });
  } catch (error) {
    return failure(error instanceof LocalImageStorageError && error.code === "MISSING" ? 404 : 503);
  }
}

export const GET = serve;
export const HEAD = serve;
