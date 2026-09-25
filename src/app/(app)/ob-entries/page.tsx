import { redirect } from "next/navigation";
import { OB_PROGRAM_PATH } from "@/lib/ob-meet";

/** 旧URL。OB戦は大会ページ配下のプログラムへ移したので転送だけする（権限確認は転送先で行う）。 */
export default function ObEntriesPage() {
  redirect(OB_PROGRAM_PATH);
}
