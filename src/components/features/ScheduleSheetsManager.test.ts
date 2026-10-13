import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ScheduleSheetsManager } from "./ScheduleSheetsManager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

it("keeps CSV and shared URL imports while removing Drive connection and creation controls", () => {
  const markup = renderToStaticMarkup(createElement(ScheduleSheetsManager));
  expect(markup).toContain("入力用のCSVを用意する");
  expect(markup).toContain("テンプレートCSV");
  expect(markup).toContain("スプレッドシートURL");
  expect(markup).toContain("CSVファイル");
  expect(markup).not.toContain("Google Driveと連携");
  expect(markup).not.toContain("シートを作る");
  expect(markup).not.toContain("/api/google/");
});
