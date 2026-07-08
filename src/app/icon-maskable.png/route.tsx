import { ImageResponse } from "next/og";
import { APP_MONO } from "@/lib/app";

// Android等のmaskableアイコン用。OS側で円形等にクロップされるため
// 角丸を付けず全面塗りつぶし＋ロゴをセーフゾーン内に収める。
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#007aff",
          color: "#ffffff",
          fontSize: 140,
          fontWeight: 800,
          letterSpacing: -5,
        }}
      >
        {APP_MONO}
      </div>
    ),
    { ...size },
  );
}
