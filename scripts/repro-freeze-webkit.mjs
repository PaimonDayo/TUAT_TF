// フリーズ再現・回帰テスト WebKit版（iOS Safari相当・pull-to-refreshタッチ合成込み）
// ⚠️ 本番authに使い捨てユーザーを一時作成する（finallyで必ず削除）。
//    実行はオーナー許可のもとで（2026-07-12 許可・実施済み）。
// 前提: ①`npm run start` でローカル本番サーバー起動（:3000）
//       ②`npm i --no-save playwright && npx playwright install webkit`
// 実行: npx tsx --env-file=.env.local scripts/repro-freeze-webkit.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { webkit, devices } from "playwright";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = "http://localhost:3000";
const EMAIL = `repro-freeze-${Date.now()}@st.go.tuat.ac.jp`;
const PASS = `Repro-${Math.random().toString(36).slice(2)}!9`;

const admin = createClient(url, service, { auth: { persistSession: false } });

async function main() {
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASS,
    email_confirm: true,
    user_metadata: { full_name: "検証用ユーザー(削除予定)" },
  });
  if (cErr) throw cErr;
  const uid = created.user.id;
  console.log("created test user", uid);

  try {
    const authClient = createClient(url, anon, { auth: { persistSession: false } });
    const { data: signIn, error: sErr } = await authClient.auth.signInWithPassword({
      email: EMAIL,
      password: PASS,
    });
    if (sErr) throw sErr;

    const jar = new Map();
    const ssr = createServerClient(url, anon, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)),
      },
    });
    await ssr.auth.setSession({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
    const cookies = [...jar.entries()].map(([name, value]) => ({ name, value, url: APP }));

    const browser = await webkit.launch({ headless: true });
    const ctx = await browser.newContext({
      ...devices["iPhone 14"],
      // devicesのuserAgent等を使いつつlocalhostへ
    });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

    await page.addInitScript(() => {
      window.__beats = 0;
      setInterval(() => {
        window.__beats++;
      }, 250);
    });

    async function assertAlive(label) {
      const before = await page.evaluate(() => window.__beats).catch(() => -1);
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => window.__beats).catch(() => -1);
      const alive = after - before >= 3;
      console.log(`${label}: beats +${after - before} → ${alive ? "OK" : "FROZEN?"}`);
      return alive;
    }

    // 合成タッチで pull-to-refresh を実行
    async function pullToRefresh() {
      await page.evaluate(async () => {
        // WebKitは new Touch() 不可。ハンドラーは touches[0].clientX/Y と length
        // しか読まないため、プレーンEventにtouches配列を載せて代用する。
        const mk = (type, y) => {
          const ev = new Event(type, { bubbles: true, cancelable: true });
          const touch = { identifier: 1, target: document.body, clientX: 200, clientY: y };
          Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [touch] });
          Object.defineProperty(ev, "changedTouches", { value: [touch] });
          return ev;
        };
        // window宛てだと event.target=window になり closest が無く実装が
        // 早期returnする。実機同様 body から bubble させる。
        document.body.dispatchEvent(mk("touchstart", 100));
        for (let y = 110; y <= 320; y += 30) {
          document.body.dispatchEvent(mk("touchmove", y));
          await new Promise((r) => setTimeout(r, 30));
        }
        document.body.dispatchEvent(mk("touchend", 320));
      });
    }

    async function spinnerState() {
      return page.evaluate(() => {
        const el = document.querySelector(".animate-spin");
        return !!el;
      });
    }

    console.log("goto /home ...");
    await page.goto(`${APP}/home`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
    console.log("url:", page.url());
    await assertAlive("after home load");

    // ホームで引っ張って更新
    console.log("--- pull to refresh on home ---");
    await pullToRefresh();
    await page.waitForTimeout(300);
    console.log("spinner visible right after pull:", await spinnerState());
    await assertAlive("during refresh");
    await page.waitForTimeout(1500);
    console.log("spinner visible after ~1.8s:", await spinnerState());
    await page.waitForTimeout(3000);
    console.log("spinner visible after ~4.8s:", await spinnerState());
    await assertAlive("after refresh settle");

    // タブ往復
    for (const label of ["予定", "タイムライン", "予定", "ホーム", "予定"]) {
      const t0 = Date.now();
      await page.getByRole("link", { name: label }).first().click({ timeout: 8000 });
      await page.waitForTimeout(2000);
      console.log(`nav → ${label} (${Date.now() - t0}ms) url=${page.url()}`);
      const alive = await assertAlive(`after nav to ${label}`);
      if (!alive) {
        await page.screenshot({ path: "scripts/frozen-webkit.png" });
        console.log("screenshot saved scripts/frozen-webkit.png");
        break;
      }
    }

    // 予定タブ上でも引っ張って更新
    console.log("--- pull to refresh on schedule ---");
    await pullToRefresh();
    await page.waitForTimeout(300);
    console.log("spinner visible right after pull:", await spinnerState());
    await assertAlive("during schedule refresh");
    await page.waitForTimeout(4000);
    console.log("spinner visible after ~4.3s:", await spinnerState());
    await assertAlive("final");

    await browser.close();
  } finally {
    const { error: dErr } = await admin.auth.admin.deleteUser(uid);
    console.log("deleted test user:", dErr ? `FAILED: ${dErr.message}` : "ok");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
