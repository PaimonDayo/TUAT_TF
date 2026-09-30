import { redirect } from "next/navigation";
import { SHEET_SETUP_PATH } from "@/lib/sheet-period";
export default function SheetSetupPage() {
  redirect(SHEET_SETUP_PATH);
}
