import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
const port = 3198,
  origin = `http://127.0.0.1:${port}`;
const proc = spawn(
  process.execPath,
  [
    path.resolve("node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: path.resolve("apps/web"),
    env: {
      ...process.env,
      MOCK_MODE: "true",
      AUTH_PASSWORD: "local-smoke-password-only",
      AUTH_SESSION_SECRET: "local-smoke-test-session-secret-32-characters",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));
try {
  let ready = false;
  for (let n = 0; n < 120; n++) {
    try {
      const r = await fetch(origin);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, log);
  for (const route of [
    "/api/sermons",
    "/api/status",
    "/api/sermons/sample-20261027/play-url",
    "/api/sermons/sample-20261027/download",
    "/api/mock-audio?id=sample-20261027",
  ])
    assert.equal(
      (await fetch(origin + route, { redirect: "manual" })).status,
      401,
      route,
    );
  assert.equal(
    (
      await fetch(origin + "/api/auth", {
        method: "POST",
        headers: {
          Origin: "http://evil.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: "local-smoke-password-only" }),
      })
    ).status,
    403,
  );
  const login = await fetch(origin + "/api/auth", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "local-smoke-password-only" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie };
  const response = await fetch(origin + "/api/sermons", { headers });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every((i) => !("objectKey" in i)));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await fetch(
        origin + "/api/sermons/not-in-catalog/play-url?objectKey=secret",
        { headers },
      )
    ).status,
    404,
  );
  const signed = await (
    await fetch(origin + "/api/sermons/sample-20261027/play-url", { headers })
  ).json();
  assert.ok(Date.parse(signed.expiresAt) > Date.now());
  const ranged = await fetch(origin + signed.url, {
    headers: { ...headers, Range: "bytes=0-127" },
  });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 128);
  assert.match(ranged.headers.get("content-range"), /^bytes 0-127\//);
  const download = await fetch(
    origin + "/api/sermons/sample-20261027/download",
    { headers, redirect: "manual" },
  );
  assert.equal(download.status, 302);
  const file = await fetch(origin + download.headers.get("location"), {
    headers,
  });
  assert.match(file.headers.get("content-disposition"), /^attachment/);
  console.log(
    "HTTP smoke: auth, catalog, key rejection, signing, MP3 Range and download passed",
  );
  if (process.argv.includes("--browser")) {
    const { chromium } = await import("@playwright/test");
    const fs = await import("node:fs/promises");
    await fs.mkdir("test-results", { recursive: true });
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      await page.goto(origin);
      await page.getByLabel("접속 비밀번호").fill("local-smoke-password-only");
      await page.getByRole("button", { name: "보관함 들어가기" }).click();
      await page.getByRole("heading", { name: /예배 보관함/ }).waitFor();
      await page.getByText("개발용 샘플 모드", { exact: false }).waitFor();
      await page.getByLabel("제목 검색").fill("평안");
      assert.equal(await page.locator("article").count(), 1);
      await page.getByLabel("제목 검색").fill("");
      await page.getByLabel("예배 날짜", { exact: true }).fill("2026-10-26");
      assert.equal(await page.locator("article").count(), 1);
      await page.getByRole("button", { name: "초기화" }).click();
      // Serve short-lived URLs to force the actual renewal path without waiting for production TTL.
      await page.route("**/play-url", async (route) => {
        const r = await route.fetch();
        const body = await r.json();
        await route.fulfill({
          response: r,
          json: {
            ...body,
            expiresAt: new Date(Date.now() + 1000).toISOString(),
          },
        });
      });
      await page
        .locator("article")
        .first()
        .getByRole("button", { name: /재생$/ })
        .click();
      await page.waitForFunction(() => {
        const el = document.querySelector("audio");
        return el && !el.paused && el.currentTime > 0;
      });
      await page.evaluate(() => {
        document.querySelector("audio").currentTime = 4;
      });
      await page.getByRole("button", { name: "일시정지", exact: true }).click();
      await page.getByLabel("재생 속도", { exact: true }).selectOption("1.5");
      const saved = await page
        .locator("audio")
        .evaluate((el) => el.currentTime);
      await page.getByRole("button", { name: "재생", exact: true }).click();
      await page.waitForFunction((min) => {
        const el = document.querySelector("audio");
        return !el.paused && el.currentTime >= min && el.playbackRate === 1.5;
      }, saved - 0.3);
      await page.getByRole("button", { name: "일시정지", exact: true }).click();
      await page.reload();
      await page.getByRole("button", { name: /마지막 듣던 예배/ }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: "test-results/desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "test-results/mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.getByRole("button", { name: /로그아웃/ }).click();
      await page.getByLabel("접속 비밀번호").waitFor();
      console.log(
        "Chrome browser: login, search, date filter, playback, speed, forced URL renewal, resume, mobile layout, logout passed",
      );
    } finally {
      await browser.close();
    }
  }
} catch (e) {
  console.error(log);
  throw e;
} finally {
  proc.kill();
}
