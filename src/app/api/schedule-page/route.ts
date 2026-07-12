import { connection, NextResponse } from "next/server";
import { getSchedulePageData } from "@/lib/schedule-page-data";

export async function GET() {
  await connection();

  try {
    const data = await getSchedulePageData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load schedule page data", error);
    return NextResponse.json(
      { error: "Failed to load schedule data" },
      { status: 500 },
    );
  }
}
