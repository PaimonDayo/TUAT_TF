import { createHmac } from "node:crypto";
import { timingSafeEqualString } from "@/lib/timing-safe";

const TOKEN_PURPOSE = "legacy-app";
const TOKEN_TTL_SECONDS = 5 * 60;

type LegacyAccessPayload = {
  sub: string;
  purpose: typeof TOKEN_PURPOSE;
  exp: number;
};

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`tuat-tf:${TOKEN_PURPOSE}:v1:${encodedPayload}`)
    .digest("base64url");
}

export function issueLegacyAccessToken(
  profileId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload: LegacyAccessPayload = {
    sub: profileId,
    purpose: TOKEN_PURPOSE,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyLegacyAccessToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return false;
  if (!timingSafeEqualString(signature, sign(encodedPayload, secret))) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<LegacyAccessPayload>;
    return (
      typeof payload.sub === "string" &&
      payload.sub.length > 0 &&
      payload.purpose === TOKEN_PURPOSE &&
      typeof payload.exp === "number" &&
      Number.isInteger(payload.exp) &&
      payload.exp >= nowSeconds
    );
  } catch {
    return false;
  }
}
