import { ImageResponse } from "next/og";
import { APP_MONO } from "@/lib/app";

export const size = { width: 192, height: 192 };
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
          borderRadius: 36,
          color: "#ffffff",
          fontSize: 75,
          fontWeight: 800,
          letterSpacing: -3,
        }}
      >
        {APP_MONO}
      </div>
    ),
    { ...size },
  );
}
