import { connection, NextResponse } from "next/server";
import { getSchedulePageData } from "@/lib/schedule-page-data";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  await connection();

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
