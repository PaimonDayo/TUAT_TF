import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Google Drive連携による予定表の発行機能は終了しました。CSVまたは共有URLから予定を読み込んでください。" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export const DELETE = GET;
