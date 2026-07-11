"use server";

import { getSchedulePageData } from "@/lib/schedule-page-data";

export async function loadSchedulePageData() {
  return getSchedulePageData();
}
