import { expect, test } from "@playwright/test";
import { SYSTEM_AUTH_STATE } from "./support/users";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tuat-splash-disabled", "1");
  });
});

test("member can use authenticated navigation", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("link", { name: "予定" }).first()).toBeVisible();
  await page.getByRole("link", { name: "タイムライン" }).first().click();
  await expect(page).toHaveURL(/\/timeline$/);
  await expect(page.getByRole("heading", { name: "タイムライン" })).toBeVisible();
});

test("middle-long member can select an event from Other", async ({ page }) => {
  await page.goto("/mypage");
  await page.getByRole("button", { name: "プロフィールを編集" }).click();
  const other = page.getByText("その他", { exact: true });
  await expect(other).toBeVisible();
  await other.click();
  await expect(page.getByRole("button", { name: "400m", exact: true })).toBeVisible();
});

test.describe("system role", () => {
  test.use({ storageState: SYSTEM_AUTH_STATE });

  test("can open the RSS blog reader", async ({ page }) => {
    await page.goto("/mypage");
    const blog = page.getByRole("link", { name: "ブログ", exact: true });
    await expect(blog).toBeVisible();
    await blog.click();
    await expect(page).toHaveURL(/\/blog$/);
    await expect(page.getByRole("heading", { name: "ブログ" })).toBeVisible();
    await expect(page.getByText("東京農工大学陸上競技部ブログ")).toBeVisible();
  });
});