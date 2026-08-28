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
    /* 간담회 자료는 스크롤해서 읽는 문서입니다 — 세로로 길어야 정상입니다 */
    if (overflow.y > 2 && name !== "간담회자료") flags.push(`세로 ${overflow.y}px 넘침`);
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
    if (screen === "reflect" && seen.has("T6-reflect-제출")) break;

    const next = {
      timelapse: "#btnSkipLapse", ending: "#btnEndNext",
      final: "#btnFinalGo",
    }[screen];

    if (screen === "invest") {
      /* 예산을 다 쓰고, 같은 화면 아래 띠에서 정책까지 고른 뒤 확정합니다.
         한 푼이라도 남으면 확정이 잠긴 채 열리지 않으므로 넉넉히 돕니다
         (예산은 최대 200억 = 20번). */
      for (let k = 0; k < 40; k++) {
        const done = await page.evaluate(() => {
          if (Number(document.getElementById("inRemain").dataset.remain) <= 0) return true;
          const btn = document.querySelector("#inList .alloc .btn--plus:not([disabled])");
          if (!btn) return true;
          btn.click(); return false;
        });
        if (done) break;
      }
      await page.evaluate(() => document.querySelector("#poList .policy").click());
      await page.waitForTimeout(150);
      await capture(page, "T" + turn + "-invest-정책까지");
      await page.click("#btnInvestGo");
    } else if (screen === "reflect") {
      /* 마지막 회고 — 국면 하나만 고르고 앞으로의 판단을 적습니다 */
      await page.evaluate(() => {
        const box = [...document.querySelectorAll("#rfList .rfitem__box")][1];
        if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); }
        const comment = document.getElementById("rfComment");
        comment.value = "다음에 이런 갈림길이 오면 한쪽에 다 걸지 않고, 작게 두 갈래를 열어두고 시장이 어느 쪽으로 가는지 보고 키우겠습니다.";
        comment.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForTimeout(150);
      await page.click("#btnReflectSend");
      await page.waitForTimeout(300);
      seen.add("T6-reflect-제출");
      await capture(page, "T6-reflect-제출");
    } else if (next) {
      await page.click(next).catch(() => {});
    } else break;
    await page.waitForTimeout(450);
  }
  /* 방금 끝낸 판을 진행자 화면으로 옮깁니다 — 빈 화면이 아니라 진짜 데이터로 봐야 합니다 */
  const save = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) out[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    return out;
  });
  await teamCtx.close();

  /* ---------- 진행자 화면 ---------- */
  console.log("\n진행자 화면 (1920×1080)");
  const beamCtx = await browser.newContext({ viewport: BEAM, deviceScaleFactor: 1 });
  await beamCtx.addInitScript(entries => {
    Object.keys(entries).forEach(k => localStorage.setItem(k, entries[k]));
  }, save);
  const fac = await beamCtx.newPage();
  fac.on("pageerror", e => problems.push("진행자 오류: " + e.message));
  await fac.goto(`http://127.0.0.1:${PORT}/facilitator.html`);
  await fac.waitForTimeout(1200);

  /* 진행자가 실제로 쓰는 방식 그대로 — [다음] 만 눌러 챕터를 끝까지 넘깁니다 */
  const seenStage = new Set();
  for (let i = 0; i < 60; i++) {
    const stage = await fac.evaluate(() => {
      const n = document.querySelector("[data-stage-panel]:not(.hidden)");
      return n ? n.dataset.stagePanel : null;
    });
    if (stage && !seenStage.has(stage)) {
      seenStage.add(stage);
      await capture(fac, "진행자-" + stage);
    }
    const stuck = await fac.evaluate(() => document.getElementById("btnNextStep").disabled);
    if (stuck) {
      /* 아직 결정 중인 조가 있어 잠긴 상태 — 진행자가 쓰는 [그래도 넘기기] 로 통과합니다 */
      const forced = await fac.evaluate(() => {
        const lock = document.getElementById("bLock");
        if (lock.classList.contains("hidden")) return false;
        document.getElementById("btnForce").click();
        return true;
      });
      if (!forced) break;
      await fac.waitForTimeout(280);
      continue;
    }
    await fac.click("#btnNextStep");
    await fac.waitForTimeout(280);
  }
  /* 간담회 자료 — 진행자 화면이 회고 챕터에서 이 PC 에 저장해둔 것을 읽습니다 */
  const rv = await beamCtx.newPage();
  rv.on("pageerror", (e) => problems.push("간담회 자료 오류: " + e.message));
  await rv.goto(`http://127.0.0.1:${PORT}/review.html`);
  await rv.waitForTimeout(900);
  await capture(rv, "간담회자료");
  await rv.close();

  await fac.click("#btnTools");
  await fac.waitForTimeout(250);
  await capture(fac, "진행자-도구");
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
