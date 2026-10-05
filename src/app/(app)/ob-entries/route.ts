import { NextResponse } from "next/server";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";

/** Redirect the legacy entry before streaming an app layout or starting prefetch. */
export function GET() {
  return new NextResponse(null, { status: 307, headers: { location: OB_PROGRAM_PATH } });
}
