/* ============================================================
   shots.js — 실제 브라우저로 모든 화면을 캡처합니다

   실행 :  node tools/shots.js
   준비 :  npm install playwright        (Edge/Chrome 이 이미 있으면 그걸 씁니다)
   결과 :  임시 폴더 (실행하면 경로를 알려줍니다)

   ★ 사람이 보는 것과 똑같은 화면을 파일로 남깁니다.
     디자인을 고칠 때는 이걸 먼저 찍어보고 고칩니다.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const http = require("http");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.log("playwright 가 없어 캡처를 건너뜁니다.");
  console.log("설치 :  npm install playwright");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
/* ⚠ 회사 보안정책이 공유폴더에 .png 쓰기를 막습니다.
   그래서 캡처는 임시 폴더에 저장합니다. 경로는 실행할 때 알려줍니다. */
const OUT = process.env.SHOTS_DIR || path.join(require("os").tmpdir(), "drb-shots");
const PORT = 8799;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ttf": "font/ttf", ".woff2": "font/woff2",
  ".m4a": "audio/mp4", ".m4v": "video/mp4",
};

/* 참가자 화면은 노트북, 진행자 화면은 빔프로젝터 기준 */
const TEAM = { width: 1440, height: 900 };
const BEAM = { width: 1920, height: 1080 };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => server.listen(PORT, "127.0.0.1", r));

  /* 사내 프록시가 브라우저 내려받기를 막으므로 이미 깔려 있는 Edge/Chrome 을 씁니다 */
  let browser = null;
  for (const channel of ["msedge", "chrome", undefined]) {
    try { browser = await chromium.launch(channel ? { channel } : {}); break; } catch (e) { /* 다음 것 */ }
  }
  if (!browser) {
    console.log("브라우저를 찾지 못했습니다. Edge 나 Chrome 이 설치되어 있어야 합니다.");
    server.close(); process.exit(0);
  }
  const problems = [];
  let shot = 0;

  async function capture(page, name) {
    shot += 1;
    const file = path.join(OUT, String(shot).padStart(2, "0") + "-" + name + ".png");
    await page.screenshot({ path: file });

    /* 화면 밖으로 넘친 것이 있으면 알려줍니다 — 빔에서 잘리는 것을 잡습니다 */
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return {
        x: d.scrollWidth - d.clientWidth,
        y: d.scrollHeight - d.clientHeight,
        smallest: Math.min(...[...document.querySelectorAll("body *")]
          .filter(n => n.textContent.trim() && n.children.length === 0)
          .map(n => parseFloat(getComputedStyle(n).fontSize))
          .filter(Boolean).concat([99])),
      };
    });
    const flags = [];
    if (overflow.x > 2) flags.push(`가로 ${overflow.x}px 넘침`);
    if (overflow.y > 2) flags.push(`세로 ${overflow.y}px 넘침`);
    if (flags.length) problems.push(name + " — " + flags.join(" · "));
    console.log(`  ${String(shot).padStart(2, "0")}  ${name.padEnd(22)} 최소 글자 ${overflow.smallest}px  ${flags.join(" ") || "OK"}`);
  }

  /* ---------- 참가자 화면 ---------- */
  console.log("\n참가자 화면 (1440×900)");
  const teamCtx = await browser.newContext({ viewport: TEAM, deviceScaleFactor: 1 });
  const page = await teamCtx.newPage();
  page.on("pageerror", e => problems.push("참가자 오류: " + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForTimeout(600);

  await capture(page, "표지");
  await page.click("#btnPractice");
  await page.waitForTimeout(200);
  await capture(page, "우리조");
  await page.click("#btnStart");
  await page.waitForTimeout(400);

  const seen = new Set();
  for (let i = 0; i < 90; i++) {
    const screen = await page.evaluate(() => {
      const n = document.querySelector(".screen.is-active");
      return n ? n.id.replace("sc-", "") : null;
    });
    if (!screen) break;
    const turn = await page.evaluate(() => (window.DRBState && window.DRBState.turnIndex ? window.DRBState.turnIndex() + 1 : 0));
    const key = "T" + turn + "-" + screen;
    if (!seen.has(key)) { seen.add(key); await capture(page, key); }
    if (screen === "final") break;

    const next = {
      roundOpen: "#btnRoundGo", situation: "#btnSitGo", invest: "#btnInvestGo",
      policy: null, timelapse: "#btnSkipLapse", event: "#btnEventGo",
      result: "#btnResultGo", actual: "#btnActualGo", ending: "#btnEndNext",
    }[screen];

    if (screen === "invest") {
      /* 예산을 다 씁니다 */
      for (let k = 0; k < 12; k++) {
        const done = await page.evaluate(() => {
          if (parseInt(document.getElementById("inRemain").textContent, 10) <= 0) return true;
          const btn = document.querySelector("#inList .alloc .btn--plus:not([disabled])");
          if (!btn) return true;
          btn.click(); return false;
        });
        if (done) break;
      }
    }
    if (screen === "policy") {
      await page.evaluate(() => document.querySelector("#poList .policy").click());
      await page.waitForTimeout(120);
      await page.click("#btnPolicyGo");
    } else if (screen === "actual") {
      await page.evaluate(() => {
        ["acKept", "acTradeoff", "acLesson"].forEach((id, i) => {
          const n = document.getElementById(id);
          n.value = "테스트 " + (i + 1);
          n.dispatchEvent(new Event("input", { bubbles: true }));
        });
      });
      await page.click("#btnActualGo");
    } else if (next) {
      await page.click(next).catch(() => {});
    } else break;
    await page.waitForTimeout(450);
  }
  await teamCtx.close();

  /* ---------- 진행자 화면 ---------- */
  console.log("\n진행자 화면 (1920×1080)");
  const beamCtx = await browser.newContext({ viewport: BEAM, deviceScaleFactor: 1 });
  const fac = await beamCtx.newPage();
  fac.on("pageerror", e => problems.push("진행자 오류: " + e.message));
  await fac.goto(`http://127.0.0.1:${PORT}/facilitator.html`);
  await fac.waitForTimeout(1200);

  const stages = await fac.$$eval("[data-stage]", ns => ns.map(n => n.dataset.stage));
  for (const stage of stages) {
    await fac.click(`[data-stage="${stage}"]`);
    await fac.waitForTimeout(300);
    await capture(fac, "진행자-" + stage);
  }
  await beamCtx.close();

  await browser.close();
  server.close();

  console.log("\n" + "=".repeat(70));
  if (problems.length) {
    console.log("문제 " + problems.length + "건");
    problems.forEach(p => console.log("  - " + p));
  } else {
    console.log("넘침·오류 없음");
  }
  console.log("캡처 " + shot + "장 → " + OUT);
  console.log("=".repeat(70));
})();
