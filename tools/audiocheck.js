/* ============================================================
   audiocheck.js — 배경음악이 진짜로 걸리는지 브라우저로 확인합니다

   실행 :  node tools/audiocheck.js
   준비 :  npm install playwright   (Edge/Chrome 이 이미 있으면 그걸 씁니다)

   ★ 여기서만 잡을 수 있는 것들입니다.
     - .m4a 라는 이름에 mp3 내용이 들어 있어도 브라우저가 실제로 디코딩하는지
       (보안정책 때문에 .mp3 를 못 넣어 이렇게 하고 있습니다)
     - 곡이 2분인데 국면이 5분 — loop 가 켜져 있는지
     - 화면마다 config 가 지정한 곡이 실제로 걸리는지
   ============================================================ */

const fs = require("fs");
const path = require("path");
const http = require("http");
const vm = require("vm");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.log("playwright 가 없어 건너뜁니다.  설치 :  npm install playwright");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const PORT = 8801;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ttf": "font/ttf", ".woff2": "font/woff2",
  ".m4a": "audio/mp4", ".m4v": "video/mp4",
};

let pass = 0;
let fail = 0;
function ok(msg) { pass++; console.log("OK   " + msg); }
function bad(msg) { fail++; console.error("실패 " + msg); }
function expect(cond, msg) { cond ? ok(msg) : bad(msg); return !!cond; }

/* config 를 그대로 읽습니다 — 화면과 곡의 짝은 여기가 원본입니다 */
function loadConfig() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "data/config.js"), "utf8"), sandbox);
  return sandbox.window.DRB_CONFIG;
}

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
  const CFG = loadConfig();
  const music = (CFG.audio && CFG.audio.music) || {};
  const byScreen = (CFG.audio && CFG.audio.musicByScreen) || {};

  console.log("\n1. 파일이 제자리에 있는가");
  Object.keys(music).forEach(name => {
    const file = path.join(ROOT, music[name]);
    const there = fs.existsSync(file);
    expect(there, `${name} → ${music[name]}` + (there ? ` (${(fs.statSync(file).size / 1048576).toFixed(1)}MB)` : " 없음"));
  });
  expect(fs.existsSync(path.join(ROOT, CFG.audio.shock)), `shock → ${CFG.audio.shock}`);

  console.log("\n2. 챕터와 곡의 짝");
  expect(Object.keys(music).length === 4, "배경음악이 네 곡임 (" + Object.keys(music).join(" · ") + ")");
  const unknown = Object.keys(byScreen).filter(s => !music[byScreen[s]]);
  expect(unknown.length === 0, "musicByScreen 이 없는 곡을 가리키지 않음" + (unknown.length ? " — " + unknown.join(", ") : ""));
  /* ★ 음악은 진행자 빔에서만 납니다. 그래서 짝을 맞춰야 하는 것은 진행자 챕터입니다.
     설명하는 동안은 평상시, 결과가 흐르는 동안은 시대흐름, 시상부터는 엔딩. */
  expect(byScreen.briefing === "normal" && byScreen.decisions === "normal",
    "시대 설명 · 조별 결정은 평상시 곡");
  expect(byScreen.event === "lapse" && byScreen.phase === "lapse",
    "돌발상황 · 국면 결과는 시대흐름 곡");
  expect(byScreen.award === "ending" && byScreen.reflect === "ending",
    "시상과 회고는 엔딩 곡");
  /* 사진이 흐르는 동안 시작해서 맺음말까지 끊기지 않아야 합니다 —
     두 챕터가 같은 곡을 가리켜야 넘어갈 때 다시 시작하지 않습니다 */
  expect(byScreen.finale === "finale" && byScreen.closing === "finale",
    "회사 사진과 맺음말은 같은 곡(finale)으로 이어짐");

  console.log("\n2-2. 음악이 나는 화면은 한 곳뿐인가");
  const facHtml = fs.readFileSync(path.join(ROOT, "facilitator.html"), "utf8");
  const teamHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  expect(/<html[^>]*data-music\s*=\s*"on"/.test(facHtml), "진행자 화면에 data-music=\"on\" 이 있음");
  expect(!/<html[^>]*data-music\s*=/.test(teamHtml), "참가자 화면에는 data-music 이 없음 (노트북에서 음악이 나오면 안 됩니다)");
  expect(/js\/audio\.js/.test(facHtml), "진행자 화면이 audio.js 를 불러옴");

  await new Promise(r => server.listen(PORT, "127.0.0.1", r));

  let browser = null;
  for (const channel of ["msedge", "chrome", undefined]) {
    try { browser = await chromium.launch(channel ? { channel } : {}); break; } catch (e) { /* 다음 것 */ }
  }
  if (!browser) {
    console.log("\n브라우저를 찾지 못해 재생 검사는 건너뜁니다 (Edge 나 Chrome 필요).");
    server.close();
    console.log(`\naudiocheck: ${pass}건 통과 / ${fail}건 실패`);
    process.exit(fail ? 1 : 0);
  }

  /* 자동재생 정책 때문에 소리를 허용한 문맥으로 엽니다 */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForTimeout(500);

  console.log("\n3. 브라우저가 실제로 디코딩하는가");
  /* .m4a 라는 이름에 mp3 내용 — sniff 후 Blob 으로 다시 넘기는 경로까지 태웁니다 */
  const decoded = await page.evaluate(async (files) => {
    function sniff(b) {
      if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return "audio/mpeg";
      if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return "audio/mpeg";
      if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "audio/mp4";
      return "audio/mpeg";
    }
    const out = {};
    for (const name of Object.keys(files)) {
      const buf = await (await fetch(files[name])).arrayBuffer();
      const type = sniff(new Uint8Array(buf.slice(0, 16)));
      const el = new Audio();
      el.src = URL.createObjectURL(new Blob([buf], { type }));
      out[name] = await new Promise(res => {
        const done = v => res(v);
        el.addEventListener("loadedmetadata", () => done({ type, seconds: el.duration }));
        el.addEventListener("error", () => done({ type, seconds: 0 }));
        setTimeout(() => done({ type, seconds: el.duration || 0 }), 8000);
      });
    }
    return out;
  }, music);

  Object.keys(music).forEach(name => {
    const d = decoded[name] || {};
    expect(d.seconds > 1,
      `${name} 재생 가능 — ${d.type} · ${d.seconds ? Math.round(d.seconds) + "초" : "디코딩 실패"}`);
  });

  console.log("\n4. 참가자 노트북은 조용한가");
  await page.click("#btnPractice");
  await page.waitForTimeout(200);
  await page.click("#btnStart");
  await page.waitForTimeout(900);
  const quiet = await page.evaluate(() => ({
    now: window.DRBAudio.nowPlaying(),
    tags: document.querySelectorAll("audio").length
  }));
  expect(!quiet.now.playing, "확정 화면에서 배경음악이 걸리지 않음 (" + (quiet.now.name || "없음") + ")");
  expect(quiet.tags === 0, "음악 파일을 아예 받아오지도 않음 (오디오 태그 " + quiet.tags + "개)");
  await ctx.close();

  console.log("\n5. 진행자 챕터를 넘기면 곡이 따라오는가");
  /* 브라우저 자동재생 정책 — 사람이 한 번 클릭한 뒤에야 소리가 납니다.
     교육장에서는 진행자가 화면을 넘기는 것이 그 클릭입니다. */
  const facCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const fac = await facCtx.newPage();
  fac.on("pageerror", e => errors.push("진행자: " + e.message));
  await fac.goto(`http://127.0.0.1:${PORT}/facilitator.html`);
  await fac.waitForTimeout(900);
  await fac.mouse.click(960, 540);
  await fac.waitForTimeout(1200);

  const seen = {};
  for (let i = 0; i < 60; i++) {
    const stage = await fac.evaluate(() => {
      const n = document.querySelector("[data-stage-panel]:not(.hidden)");
      return n ? n.dataset.stagePanel : null;
    });
    if (stage && !seen[stage]) {
      seen[stage] = await fac.evaluate(() => window.DRBAudio.nowPlaying());
    }
    const stuck = await fac.evaluate(() => document.getElementById("btnNextStep").disabled);
    if (stuck) {
      const forced = await fac.evaluate(() => {
        const lock = document.getElementById("bLock");
        if (lock.classList.contains("hidden")) return false;
        document.getElementById("btnForce").click();
        return true;
      });
      if (!forced) break;
      await fac.waitForTimeout(240);
      continue;
    }
    await fac.click("#btnNextStep");
    await fac.waitForTimeout(320);
  }

  Object.keys(seen).forEach(stage => {
    const want = byScreen[stage] || "normal";
    const got = seen[stage] || {};
    expect(got.name === want, `${stage.padEnd(10)} → ${got.name || "없음"} (기대 ${want})`);
  });
  expect(Object.keys(seen).length >= 6, "챕터를 " + Object.keys(seen).length + "개 지나감");

  console.log("\n6. 무한 반복 — 곡보다 국면이 깁니다");
  const loops = await fac.evaluate(() => window.DRBAudio.nowPlaying());
  expect(loops.loop === true, "지금 걸린 곡이 loop 로 걸려 있음");
  const shortest = Math.min.apply(null, Object.keys(decoded).map(n => decoded[n].seconds || 999));
  const phaseSeconds = (CFG.phasePlan || []).reduce((s, x) => s + x.minutes, 0) * 60;
  console.log(`     가장 짧은 곡 ${Math.round(shortest)}초 · 한 국면 ${phaseSeconds}초` +
    (shortest < phaseSeconds ? "  → 반복이 반드시 필요합니다" : ""));
  expect(/addEventListener\(\s*["']ended["']/.test(fs.readFileSync(path.join(ROOT, "js/audio.js"), "utf8")),
    "loop 가 안 먹는 브라우저를 위한 ended 되감기가 있음");

  expect(errors.length === 0, "브라우저 오류 없음" + (errors.length ? " — " + errors[0] : ""));

  await facCtx.close();
  await browser.close();
  server.close();

  console.log("\n" + "=".repeat(70));
  console.log(`audiocheck: ${pass}건 통과 / ${fail}건 실패`);
  console.log("=".repeat(70));
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("검사기 실행 오류:", e);
  server.close();
  process.exit(1);
});
