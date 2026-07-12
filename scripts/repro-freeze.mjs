// フリーズ再現・回帰テスト Chromium(システムEdge)版
// ⚠️ 本番authに使い捨てユーザーを一時作成する（finallyで必ず削除）。
//    実行はオーナー許可のもとで（2026-07-12 許可・実施済み）。
// 前提: ①`npm run start`（:3000） ②`npm i --no-save playwright`（Edge使用・DL不要）
// 1. 使い捨てテストユーザーを作成（終了時に削除）
// 2. パスワードログインでセッション取得 → @supabase/ssr と同形式のcookieを組み立て
// 3. システムEdge(headless)で ホーム→予定→タイムライン→予定 を操作し、
//    メインスレッドのハートビートでフリーズを検出する
// 実行: npx tsx --env-file=.env.local scripts/repro-freeze.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = "http://localhost:3000";
const EMAIL = `repro-freeze-${Date.now()}@st.go.tuat.ac.jp`;
const PASS = `Repro-${Math.random().toString(36).slice(2)}!9`;

const admin = createClient(url, service, { auth: { persistSession: false } });

async function main() {
  // 1. テストユーザー作成
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
    // 2. パスワードログイン → ssr形式のcookieへ
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
    const cookies = [...jar.entries()].map(([name, value]) => ({
      name,
      value,
      url: APP,
    }));
    console.log("cookies:", cookies.map((c) => c.name).join(", "));

    // 3. ブラウザ操作
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

    // メインスレッドのハートビート: 250ms間隔のsetIntervalが止まったらフリーズ
    await page.addInitScript(() => {
      window.__beats = 0;
      setInterval(() => {
        window.__beats++;
      }, 250);
    });

    async function assertAlive(label) {
      const before = await page.evaluate(() => window.__beats);
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => window.__beats).catch(() => -1);
      const alive = after - before >= 3;
      console.log(`${label}: beats +${after - before} → ${alive ? "OK" : "FROZEN?"}`);
      return alive;
    }

    console.log("goto /home ...");
    await page.goto(`${APP}/home`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000); // スプラッシュ+初期描画
    console.log("url:", page.url());
    await assertAlive("after home load");

    // タブ遷移: 予定 → タイムライン → 予定
    for (const [i, label] of [["1st", "予定"], ["2nd", "タイムライン"], ["3rd", "予定"]].map((x, i) => [i, x[1]])) {
      const t0 = Date.now();
      await page.getByRole("link", { name: label }).first().click({ timeout: 5000 });
      await page.waitForTimeout(2500);
      console.log(`nav#${i} → ${label} (${Date.now() - t0}ms) url=${page.url()}`);
      const alive = await assertAlive(`after nav to ${label}`);
      if (!alive) {
        await page.screenshot({ path: "scripts/frozen.png" });
        console.log("screenshot saved scripts/frozen.png");
        break;
      }
    }

    // ホームへ戻って router.refresh 相当（PullToRefreshはタッチ必須なので、
    // 予定→ホーム遷移後にもう一往復してキャッシュ復元パスを叩く）
    await page.getByRole("link", { name: "ホーム" }).first().click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await assertAlive("after back to home");
    await page.getByRole("link", { name: "予定" }).first().click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await assertAlive("after schedule revisit#2");

    await browser.close();
  } finally {
    // テストユーザー削除（記録が無くても必ず）
    const { error: dErr } = await admin.auth.admin.deleteUser(uid);
    console.log("deleted test user:", dErr ? `FAILED: ${dErr.message}` : "ok");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
