import { ImageResponse } from "next/og";

// iOS のホーム画面アイコン（フォント不要の図形のみで描画）
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
        }}
      >
        <div
          style={{
            width: 108,
            height: 64,
            border: "16px solid #ffffff",
            borderRadius: 9999,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
