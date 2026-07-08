import { ImageResponse } from "next/og";
import { APP_MONO } from "@/lib/app";

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
          borderRadius: 96,
          color: "#ffffff",
          fontSize: 200,
          fontWeight: 800,
          letterSpacing: -8,
        }}
      >
        {APP_MONO}
      </div>
    ),
    { ...size },
  );
}
