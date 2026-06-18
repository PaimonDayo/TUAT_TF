import { ImageResponse } from "next/og";
import { APP_MONO } from "@/lib/app";

// iOS のホーム画面アイコン（モノグラム文字ロゴ）
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 62,
          fontWeight: 700,
          letterSpacing: -2,
        }}
      >
        {APP_MONO}
      </div>
    ),
    { ...size },
  );
}
