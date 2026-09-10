// Web Push の鍵と webhook の合言葉を作り、秘密の側はPC内の保護ファイルだけへ書く。
// 標準出力へ出すのは公開鍵だけ（公開鍵はブラウザにも配る前提の値）。
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const target = resolve(root, ".contingency/backend/push.env");
if (existsSync(target)) {
  throw new Error("Refusing to overwrite the existing push secrets");
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
// VAPID の公開鍵は非圧縮の楕円点そのもの。SPKI の末尾65バイトがそれにあたる。
const spki = publicKey.export({ type: "spki", format: "der" });
const point = spki.subarray(spki.length - 65);
if (point[0] !== 0x04) throw new Error("Unexpected public key encoding");
const publicKeyB64 = point.toString("base64url");
const privateKeyB64 = privateKey.export({ format: "jwk" }).d;
if (!privateKeyB64) throw new Error("Missing private scalar");

const webhookSecret = randomBytes(32).toString("base64url");
mkdirSync(resolve(root, ".contingency/backend"), { recursive: true });
writeFileSync(
  target,
  [
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKeyB64}`,
    `VAPID_PRIVATE_KEY=${privateKeyB64}`,
    `VAPID_SUBJECT=mailto:rainbowrdayo@gmail.com`,
    `PUSH_WEBHOOK_SECRET=${webhookSecret}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

console.log(publicKeyB64);
