/* ============================================================
   report.js — 한 판을 끝까지 돌려서 모든 화면을 담은 HTML 한 장을 만듭니다

   실행 :  node tools/report.js
   결과 :  export/시뮬레이션 화면 모음.html   (이미지까지 파일 안에 들어 있습니다)

   ★ 교육 전에 "그날 무엇이 어떤 순서로 뜨는가" 를 한 번에 훑어보는 자리입니다.
     노트북 화면과 빔 화면을 국면별로 나란히 놓습니다.

   ⚠ 회사 보안정책이 공유폴더에 .png / .jpg 쓰기를 막습니다.
     그래서 이미지 파일을 따로 만들지 않고 HTML 안에 넣습니다.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const http = require("http");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.log("playwright 가 없어 만들 수 없습니다.  설치 :  npm install playwright");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "export", "시뮬레이션 화면 모음.html");
const PORT = 8812;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".m4a": "audio/mp4", ".m4v": "video/mp4",
};

/* 빔은 1920, 노트북은 1440 으로 그립니다.
   0.8 배로 받아 파일을 가볍게 합니다 — 읽을 수 있으면 됩니다. */
const TEAM = { width: 1440, height: 900 };
const BEAM = { width: 1920, height: 1080 };
const SCALE = 0.8;
const QUALITY = 72;

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

/* 화면마다 한 줄 설명 — 캡처만 늘어놓으면 무엇을 보는 화면인지 알 수 없습니다 */
const NOTE = {
  "표지":        "참가 코드를 넣고 들어옵니다. 코드는 진행자 화면에서 나옵니다.",
  "우리 조":      "조를 고르고 역할을 하나씩 나눠 갖습니다.",
  "자원 배분":    "이 국면에 뜨는 노트북 화면은 이것 하나입니다. 예산과 정책을 정합니다.",
  "확정 직전":    "예산을 다 쓰고 정책까지 고른 상태. 이제 [확정] 이 열립니다.",
  "대기":        "확정한 뒤. 결과는 빔에서 다 같이 봅니다.",
  "2026 엔딩":    "여섯 번째 결정 뒤. 여기서부터는 정답이 없습니다.",
  "최종 결과":    "현재 경쟁력과 변화 대응력. 등수는 나오지 않습니다.",
  "회고":        "80년 중 가장 이야기하고 싶은 결정 하나를 고릅니다.",
  "회고 제출":    "제출하면 진행자 화면과 간담회 자료로 올라갑니다.",
  "2026 엔딩 2":  "엔딩의 다음 장. 시장은 멈추지 않습니다.",

  intro:     "표지. 이 화면은 진행자만 봅니다.",
  howto:     "한 국면이 어떤 순서로 흘러가는지.",
  briefing:  "이 시대를 설명합니다. 국내·세계 신호는 여기서만 볼 수 있습니다.",
  decisions: "각 조가 결정하는 동안. 다 확정해야 [다음] 이 열립니다.",
  lapse:     "연도가 한 해씩 올라갑니다. 이 연출은 빔에서만 돕니다.",
  event:     "같은 사건이 모두에게. 조마다 다르게 맞습니다.",
  phase:     "이 국면의 결과. 조별로 나란히 놓습니다.",
  actual:    "그때 DRB는 이렇게 했습니다. 조별 발표를 들은 뒤에 엽니다.",
  map:       "누가 어디에 거점을 놓았는가.",
  standings: "여기까지의 순위. 참가자 화면에는 나가지 않습니다.",
  award:     "여섯 번의 선택이 끝났습니다.",
  reflect:   "조별 회고가 올라옵니다.",
  closing:   "맺음말. 글자가 한 자씩 찍힙니다.",
  "간담회 자료": "회고를 모아 둔 문서. 교육이 끝난 뒤에도 열립니다.",
};

/* 빔 챕터의 한글 이름 — 진행자 화면 탭에 적힌 그대로입니다 */
const CHAPTER = {
  intro: "표지", howto: "진행 방법", briefing: "시대 설명", decisions: "조별 결정",
  lapse: "시간 흐름", event: "돌발상황", phase: "국면 결과", actual: "DRB 실제",
  map: "산업 지도", standings: "순위", award: "시상", reflect: "회고", closing: "맺음말",
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

(async function () {
  await new Promise(r => server.listen(PORT, "127.0.0.1", r));

  let browser = null;
  for (const channel of ["msedge", "chrome", undefined]) {
    try { browser = await chromium.launch(channel ? { channel } : {}); break; } catch (e) { /* 다음 것 */ }
  }
  if (!browser) {
    console.log("브라우저를 찾지 못했습니다. Edge 나 Chrome 이 설치되어 있어야 합니다.");
    server.close(); process.exit(0);
  }

  const shots = [];
  let bytes = 0;

  async function snap(page, who, turn, name) {
    const buf = await page.screenshot({ type: "jpeg", quality: QUALITY });
    bytes += buf.length;
    shots.push({ who, turn, name: CHAPTER[name] || name, note: NOTE[name] || "", data: buf.toString("base64") });
    console.log(`  ${who === "team" ? "노트북" : who === "beam" ? "빔    " : "문서  "}  ${String(turn + 1).padStart(2)}국면  ${name}`);
  }

  /* ---------- 참가자 노트북 ---------- */
  console.log("\n참가자 노트북 (1440×900)");
  const teamCtx = await browser.newContext({ viewport: TEAM, deviceScaleFactor: SCALE });
  const page = await teamCtx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("참가자: " + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForTimeout(700);

  await snap(page, "team", -1, "표지");
  await page.click("#btnPractice");
  await page.waitForTimeout(250);
  await snap(page, "team", -1, "우리 조");
  await page.click("#btnStart");
  await page.waitForTimeout(500);

  let endingStep = 0;
  for (let guard = 0; guard < 90; guard++) {
    const screen = await page.evaluate(() => {
      const n = document.querySelector(".screen.is-active");
      return n ? n.id.replace("sc-", "") : null;
    });
    if (!screen) break;
    const turn = await page.evaluate(() => (window.DRBState ? window.DRBState.turnIndex() : 0));

    if (screen === "invest") {
      await snap(page, "team", turn, "자원 배분");
      /* 예산을 남김없이 배분해야 확정이 열립니다 (예산은 최대 200억 = 20번) */
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
      await page.waitForTimeout(200);
      await snap(page, "team", turn, "확정 직전");
      await page.click("#btnInvestGo");
    } else if (screen === "timelapse") {
      await page.waitForTimeout(500);
      await snap(page, "team", turn, "대기");
      await page.click("#btnSkipLapse").catch(() => {});
    } else if (screen === "ending") {
      /* 엔딩은 몇 단계로 나뉘어 있습니다 — 단계마다 다른 화면입니다 */
      endingStep += 1;
      await snap(page, "team", turn, endingStep === 1 ? "2026 엔딩" : "2026 엔딩 " + endingStep);
      await page.click("#btnEndNext").catch(() => {});
    } else if (screen === "final") {
      await snap(page, "team", turn, "최종 결과");
      await page.click("#btnFinalGo").catch(() => {});
    } else if (screen === "reflect") {
      await snap(page, "team", turn, "회고");
      await page.evaluate(() => {
        const box = [...document.querySelectorAll("#rfList .rfitem__box")][1];
        if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); }
        const c = document.getElementById("rfComment");
        c.value = "다음에 이런 갈림길이 오면 한쪽에 다 걸지 않고, 작게 두 갈래를 열어두고 시장이 어느 쪽으로 가는지 보고 키우겠습니다.";
        c.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForTimeout(200);
      await page.click("#btnReflectSend");
      await page.waitForTimeout(400);
      await snap(page, "team", turn, "회고 제출");
      break;
    } else break;
    await page.waitForTimeout(450);
  }

  const save = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) out[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    return out;
  });
  await teamCtx.close();

  /* ---------- 진행자 빔 ---------- */
  console.log("\n진행자 빔 (1920×1080)");
  const beamCtx = await browser.newContext({ viewport: BEAM, deviceScaleFactor: SCALE });
  await beamCtx.addInitScript(entries => {
    Object.keys(entries).forEach(k => localStorage.setItem(k, entries[k]));
  }, save);
  const fac = await beamCtx.newPage();
  fac.on("pageerror", e => errors.push("진행자: " + e.message));
  await fac.goto(`http://127.0.0.1:${PORT}/facilitator.html`);
  await fac.waitForTimeout(1400);

  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    const at = await fac.evaluate(() => {
      const n = document.querySelector("[data-stage-panel]:not(.hidden)");
      return n ? { stage: n.dataset.stagePanel, turn: window.__facTurn === undefined ? null : window.__facTurn } : null;
    });
    if (at) {
      const label = at.stage + "@" + i;
      const turn = Number(await fac.evaluate(() => {
        const chip = document.getElementById("bProgress");
        const m = chip && /(\d+)\s*\/\s*\d+/.exec(chip.textContent);
        return m ? Number(m[1]) - 1 : 0;
      }));
      const key = at.stage + "-" + turn;
      if (!seen.has(key)) {
        seen.add(key);
        /* 연도 연출은 한창 도는 중을 담아야 의미가 있습니다 */
        if (at.stage === "lapse") await fac.waitForTimeout(2600);
        await snap(fac, "beam", turn, at.stage);
      }
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
      await fac.waitForTimeout(280);
      continue;
    }
    await fac.click("#btnNextStep");
    await fac.waitForTimeout(320);
  }

  /* ---------- 간담회 자료 ---------- */
  const rv = await beamCtx.newPage();
  rv.on("pageerror", e => errors.push("간담회 자료: " + e.message));
  await rv.goto(`http://127.0.0.1:${PORT}/review.html`);
  await rv.waitForTimeout(1000);
  await snap(rv, "doc", 99, "간담회 자료");
  await rv.close();
  await beamCtx.close();

  await browser.close();
  server.close();

  /* ---------- 데이터 읽기 (국면 연도) ---------- */
  const vm = require("vm");
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  ["data/config.js", "data/eras.js", "data/rounds.js"].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f }));
  const CFG = sandbox.window.DRB_CONFIG;
  const flat = [];
  sandbox.window.DRB_ROUNDS.forEach(r => r.subrounds.forEach(s =>
    flat.push({ year: s.year, title: s.title, era: sandbox.window.DRB_ERAS[r.era], roundNo: r.no })));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buildHtml(shots, flat, CFG, errors), "utf8");

  console.log("\n" + "=".repeat(70));
  if (errors.length) { console.log("브라우저 오류 " + errors.length + "건"); errors.slice(0, 5).forEach(e => console.log("  - " + e)); }
  else console.log("브라우저 오류 없음");
  console.log(`캡처 ${shots.length}장 · 이미지 ${(bytes / 1048576).toFixed(1)}MB`);
  console.log("→ " + OUT + `  (${(fs.statSync(OUT).size / 1048576).toFixed(1)}MB)`);
  console.log("=".repeat(70));
})();


/* ============================================================
   HTML 한 장으로 묶기
   ============================================================ */
function buildHtml(shots, flat, CFG, errors) {
  const WHO = {
    team: { label: "노트북", full: "조별 노트북 · 참가자가 봅니다" },
    beam: { label: "빔", full: "진행자 화면 · 모두가 함께 봅니다" },
    doc:  { label: "문서", full: "교육이 끝난 뒤 여는 자료" },
  };

  function card(s) {
    const w = WHO[s.who];
    return `
      <figure class="shot shot--${s.who}">
        <button class="shot__frame" type="button" data-full="${s.who}">
          <img src="data:image/jpeg;base64,${s.data}" alt="${esc(s.name)}" loading="lazy" decoding="async">
        </button>
        <figcaption class="shot__cap">
          <span class="tag tag--${s.who}">${esc(w.label)}</span>
          <b class="shot__name">${esc(s.name)}</b>
          ${s.note ? `<span class="shot__note">${esc(s.note)}</span>` : ""}
        </figcaption>
      </figure>`;
  }

  const intro = shots.filter(s => s.turn === -1);
  const doc = shots.filter(s => s.who === "doc");
  /* 마지막 결정이 끝난 뒤의 화면들. 국면 6 에 붙이면 '아직 결정 중' 처럼 읽힙니다. */
  const AFTER = /^(2026 엔딩|최종 결과|회고)/;
  const outro = shots.filter(s => s.who === "team" && AFTER.test(s.name));

  const phases = flat.map((f, i) => {
    const mine = shots.filter(s => s.turn === i && s.who !== "doc" && !AFTER.test(s.name));
    /* 빔이 먼저 열리고, 노트북은 그 사이에 결정합니다 */
    const beam = mine.filter(s => s.who === "beam");
    const team = mine.filter(s => s.who === "team");
    if (!beam.length && !team.length) return "";
    return `
    <section class="phase" id="p${i + 1}">
      <header class="phase__head">
        <span class="phase__no">국면 ${i + 1}</span>
        <span class="phase__year">${f.year}</span>
        <span class="phase__title">${esc(String(f.title).replace(/^.*·\s*/, ""))}</span>
        <span class="phase__era">ERA ${f.roundNo} · ${esc(f.era.name)}</span>
      </header>
      <div class="grid">${beam.map(card).join("")}${team.map(card).join("")}</div>
    </section>`;
  }).join("");

  const counts = {
    team: shots.filter(s => s.who === "team").length,
    beam: shots.filter(s => s.who === "beam").length,
  };

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>80년의 여정 화면 대본</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;700;800&family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
:root {
  --ink:        #1A1327;
  --ink-2:      #5F5677;
  --ink-3:      #8E86A4;
  --ground:     #FFFFFF;
  --surface:    #FAF8FD;
  --line:       #E7E2F0;
  --line-2:     #D6CEE7;
  --accent:     #8B5CD6;
  --accent-deep:#43277F;
  --coral:      #FF7A5C;
  --shadow:     0 1px 2px rgba(26,19,39,.05), 0 12px 32px rgba(26,19,39,.06);
  --sans: "IBM Plex Sans KR", "Pretendard", "Malgun Gothic", "맑은 고딕", system-ui, sans-serif;
  --disp: "Gothic A1", "Pretendard", "Malgun Gothic", "맑은 고딕", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "Consolas", monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ink:        #EFEBF7;
    --ink-2:      #A79EBE;
    --ink-3:      #776E8D;
    --ground:     #14101F;
    --surface:    #1D1730;
    --line:       #2E2545;
    --line-2:     #3D3159;
    --accent:     #A985E6;
    --accent-deep:#C6A9EE;
    --coral:      #FF9179;
    --shadow:     0 1px 2px rgba(0,0,0,.4), 0 14px 36px rgba(0,0,0,.34);
  }
}
:root[data-theme="dark"] {
  --ink:        #EFEBF7;
  --ink-2:      #A79EBE;
  --ink-3:      #776E8D;
  --ground:     #14101F;
  --surface:    #1D1730;
  --line:       #2E2545;
  --line-2:     #3D3159;
  --accent:     #A985E6;
  --accent-deep:#C6A9EE;
  --coral:      #FF9179;
  --shadow:     0 1px 2px rgba(0,0,0,.4), 0 14px 36px rgba(0,0,0,.34);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px 96px; }

/* ---------- 머리말 ---------- */
.top {
  display: flex; flex-direction: column; gap: 20px;
  padding: 64px 0 40px;
  border-bottom: 1px solid var(--line);
}
.top__kicker {
  font-family: var(--mono);
  font-size: 12px; letter-spacing: .18em; text-transform: uppercase;
  color: var(--accent);
}
.top__title {
  margin: 0;
  font-family: var(--disp); font-weight: 800;
  font-size: clamp(34px, 5vw, 56px); line-height: 1.08; letter-spacing: -.035em;
  text-wrap: balance;
}
.top__lead { margin: 0; max-width: 62ch; color: var(--ink-2); font-size: 17px; }
.legend { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: center; }
.legend__item { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); font-size: 14px; }

.tag {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 999px;
  font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: .08em;
  border: 1px solid var(--line-2);
}
.tag--beam { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: var(--accent); color: var(--accent-deep); }
.tag--team { background: transparent; color: var(--ink-2); }
.tag--doc  { background: color-mix(in srgb, var(--coral) 16%, transparent); border-color: var(--coral); color: var(--coral); }

/* ---------- 국면 이동 ---------- */
.rail {
  position: sticky; top: 0; z-index: 5;
  display: flex; flex-wrap: wrap; gap: 6px;
  margin: 0 -24px; padding: 12px 24px;
  background: color-mix(in srgb, var(--ground) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.rail a {
  display: inline-flex; align-items: baseline; gap: 7px;
  padding: 5px 12px; border-radius: 8px;
  color: var(--ink-2); text-decoration: none;
  font-family: var(--mono); font-size: 13px;
}
.rail a:hover, .rail a:focus-visible { background: var(--surface); color: var(--ink); }
.rail a b { color: var(--ink); font-weight: 600; }

/* ---------- 국면 ---------- */
.phase { padding-top: 56px; }
.phase__head {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: baseline;
  gap: 8px 16px;
  padding-bottom: 18px;
  border-bottom: 2px solid var(--ink);
}
.phase__no {
  font-family: var(--mono); font-size: 12px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--accent);
}
.phase__year {
  font-family: var(--mono); font-weight: 600;
  font-size: clamp(30px, 4vw, 44px); letter-spacing: -.02em; line-height: 1;
  font-variant-numeric: tabular-nums;
}
.phase__title { font-family: var(--disp); font-weight: 700; font-size: 20px; letter-spacing: -.02em; }
.phase__era { grid-column: 2 / -1; color: var(--ink-3); font-size: 13px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 28px;
  padding-top: 28px;
}
.shot { margin: 0; display: flex; flex-direction: column; gap: 12px; }
.shot__frame {
  display: block; width: 100%; padding: 0; cursor: zoom-in;
  border: 1px solid var(--line); border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
  box-shadow: var(--shadow);
}
.shot--beam .shot__frame { border-color: var(--accent); }
.shot__frame img { display: block; width: 100%; height: auto; }
.shot__cap { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
.shot__name { font-family: var(--disp); font-weight: 700; font-size: 16px; letter-spacing: -.02em; }
.shot__note { flex: 1 1 100%; color: var(--ink-2); font-size: 14px; line-height: 1.5; }

/* ---------- 크게 보기 ---------- */
dialog {
  width: min(96vw, 1600px); max-width: none;
  padding: 0; border: 0; border-radius: 12px;
  background: var(--surface); color: var(--ink);
}
dialog::backdrop { background: rgba(10, 7, 18, .82); }
dialog img { display: block; width: 100%; height: auto; }
.close {
  position: sticky; top: 0; display: flex; justify-content: flex-end;
  padding: 10px; background: var(--surface);
}
.close button {
  padding: 7px 14px; border: 1px solid var(--line-2); border-radius: 8px;
  background: var(--ground); color: var(--ink);
  font-family: var(--sans); font-size: 14px; cursor: pointer;
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

.foot { padding-top: 64px; color: var(--ink-3); font-size: 13px; }
.foot code { font-family: var(--mono); }

@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <span class="top__kicker">${esc(CFG.subtitle)}</span>
    <h1 class="top__title">${esc(CFG.gameTitle)}</h1>
    <p class="top__lead">
      한 판을 처음부터 끝까지 돌려 그날 뜨는 화면을 순서대로 담았습니다.
      국면마다 <b>빔에 뜨는 화면</b>을 먼저, 그 사이 <b>조별 노트북에 뜨는 화면</b>을 뒤에 놓았습니다.
      그림을 누르면 크게 볼 수 있습니다.
    </p>
    <div class="legend">
      <span class="legend__item"><span class="tag tag--beam">빔</span> ${esc(WHO.beam.full)}</span>
      <span class="legend__item"><span class="tag tag--team">노트북</span> ${esc(WHO.team.full)}</span>
      <span class="legend__item"><span class="tag tag--doc">문서</span> ${esc(WHO.doc.full)}</span>
      <span class="legend__item">빔 ${counts.beam}장 · 노트북 ${counts.team}장</span>
    </div>
  </header>

  <nav class="rail" aria-label="국면으로 이동">
    <a href="#start"><b>시작</b></a>
    ${flat.map((f, i) => `<a href="#p${i + 1}"><b>${i + 1}국면</b>${f.year}</a>`).join("")}
    <a href="#end"><b>마무리</b></a>
  </nav>

  <section class="phase" id="start">
    <header class="phase__head">
      <span class="phase__no">시작</span>
      <span class="phase__year">준비</span>
      <span class="phase__title">들어오기</span>
      <span class="phase__era">참가 코드를 넣고 조를 고릅니다</span>
    </header>
    <div class="grid">${intro.map(card).join("")}</div>
  </section>

  ${phases}

  <section class="phase" id="end">
    <header class="phase__head">
      <span class="phase__no">마무리</span>
      <span class="phase__year">2026~</span>
      <span class="phase__title">그 뒤</span>
      <span class="phase__era">여섯 번째 결정이 끝난 뒤 — 엔딩 · 최종 결과 · 회고 · 간담회 자료</span>
    </header>
    <div class="grid">${outro.map(card).join("")}${doc.map(card).join("")}</div>
  </section>

  <p class="foot">
    <code>node tools/report.js</code> 로 다시 만듭니다. 화면을 고치면 이 문서도 다시 만드세요.
    ${errors.length ? `<br>이번 실행에서 브라우저 오류 ${errors.length}건이 있었습니다.` : ""}
  </p>
</div>

<dialog id="zoom">
  <div class="close"><button type="button" autofocus>닫기</button></div>
  <img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
</dialog>

<script>
  var zoom = document.getElementById("zoom");
  var big = zoom.querySelector("img");
  document.querySelectorAll(".shot__frame").forEach(function (b) {
    b.addEventListener("click", function () {
      var img = b.querySelector("img");
      big.src = img.src;
      big.alt = img.alt;
      zoom.showModal();
    });
  });
  zoom.querySelector("button").addEventListener("click", function () { zoom.close(); });
  zoom.addEventListener("click", function (e) { if (e.target === zoom) zoom.close(); });
</script>
</body>
</html>`;
}
