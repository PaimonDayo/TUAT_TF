import type { Database } from "@/types/database";

export type LoginAllowedEmail = Database["public"]["Tables"]["login_email_allowlist"]["Row"];

export function normalizeAllowedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function allowedEmailError(value: string): string | null {
  const email = normalizeAllowedEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Googleアカウントのメールアドレスを入力してください";
  }
  if (email.endsWith("@st.go.tuat.ac.jp")) return "大学アカウントは許可リストへの登録が不要です";
  return null;
}
