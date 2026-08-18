/* ============================================================
   playthrough.js — 2개 조 + 경쟁사 1개로 한 판을 실제로 플레이하고 기록합니다

   실행 :  node tools/playthrough.js
   결과 :  export/플레이 기록 2조.html   (스크린샷까지 파일 안에 들어 있습니다)

   ★ tools/report.js 와 다릅니다.
     report.js  : 화면이 어떻게 생겼는지 (한 조가 기계적으로 다 눌러봄)
     이 파일     : 실제로 두 조가 서로 다른 전략으로 붙으면 어떻게 되는지

   두 조에 뚜렷이 다른 성격을 줍니다.
     1조  만들 수 있는 회사 — 기술과 품질에 먼저 넣고, 크게 벌이지 않습니다
     2조  먼저 크게 거는 회사 — 눈앞의 시장과 확장에 몰아 넣습니다
   3국면 자동차 공동개발은 한 곳만 계약하므로, 여기서 둘이 정면으로 부딪힙니다.

   ⚠ 회사 보안정책이 공유폴더에 .png / .jpg 쓰기를 막습니다.
     그래서 이미지 파일을 따로 만들지 않고 HTML 안에 넣습니다.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const http = require("http");
const vm = require("vm");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.log("playwright 가 없어 만들 수 없습니다.  설치 :  npm install playwright");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "export", "플레이 기록 2조.html");
const PORT = 8817;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".m4a": "audio/mp4", ".m4v": "video/mp4",
};

const TEAM_VIEW = { width: 1440, height: 900 };
const BEAM_VIEW = { width: 1920, height: 1080 };
const SCALE = 0.8;
const QUALITY = 74;

const TEAMS = ["1조", "2조"];
const RIVALS = 1;

/* 조별 성격. 국면마다 '어디에 먼저 넣는가' 를 순서로 적습니다.
   앞에서부터 최대치까지 채우고, 남으면 다음 항목으로 넘어갑니다. */
/* 조별 성격. 국면마다 '어디에 얼마' 를 적습니다 (토큰 10 단위).
   ★ 예산을 전부 쓰지 않습니다 — 남긴 것은 현금이 되고, 다음 국면 예산을 지킵니다.
     전액을 매번 쏟아부으면 현금이 말라 3국면에 쓸 돈이 10까지 떨어집니다.
     실제로 그렇게 돌려봤고, 그래서 자동차 계약 문턱(20)도 못 넘었습니다. */
const STRATEGY = {
  "1조": {
    label: "만들 수 있는 회사",
    note: "기술과 품질에 먼저 넣습니다. 눈앞의 매출보다 만들 수 있는 능력을 쌓고, 현금을 남깁니다.",
    policy: { era1: "techfirst", era2: "techfirst", era3: "techLead" },
    plan: {
      era1: [["quality", 20], ["people", 20]],
      era2: [["rnd", 30], ["auto", 20], ["quality", 10]],
      era3: [["aiRnd", 30], ["newMaterial", 20], ["esg", 10]],
    },
  },
  "2조": {
    label: "먼저 크게 거는 회사",
    note: "지금 팔리는 것과 확장에 몰아 넣습니다. 기회가 보이면 먼저, 크게 움직입니다.",
    policy: { era1: "growth", era2: "growth", era3: "transform" },
    plan: {
      era1: [["consumer", 30], ["facility", 20]],
      era2: [["auto", 40], ["beltExpand", 20], ["globalPlant", 10]],
      era3: [["mobility", 40], ["globalReshape", 20], ["smartFactory", 10]],
    },
  },
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

const CHAPTER = {
  intro: "표지", howto: "진행 방법", briefing: "시대 설명", decisions: "조별 결정",
  lapse: "시간 흐름", event: "돌발상황", phase: "국면 결과", actual: "DRB 실제",
  map: "산업 지도", standings: "순위", award: "시상", reflect: "회고", closing: "맺음말",
};

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  const log = [];
  const errors = [];
  let bytes = 0;

  async function snap(page, who, turn, name, note) {
    const buf = await page.screenshot({ type: "jpeg", quality: QUALITY });
    bytes += buf.length;
    shots.push({ who, turn, name, note: note || "", data: buf.toString("base64") });
  }

  /* ---------- 판 만들기 : 2개 조 + 경쟁사 1개 ---------- */
  const ctx = await browser.newContext({ viewport: TEAM_VIEW, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("참가자: " + e.message));
  /* 아무 데도 투자하지 않으면 "전액 현금으로 둘까요?" 를 묻습니다.
     자동으로 취소되면 확정이 안 된 채 넘어가므로 받아둡니다. */
  page.on("dialog", d => d.accept().catch(() => {}));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForTimeout(700);
  await snap(page, "team", -1, "표지", "참가 코드를 넣고 들어옵니다.");

  /* 조 수와 경쟁사 수는 진행자가 세션을 만들 때 정합니다.
     연습 모드에는 경쟁사 수 고르는 자리가 없어 여기서 직접 만듭니다. */
  await page.evaluate(([names, rivals]) => {
    window.DRBState.newGame(names.length, rivals);
  }, [TEAMS, RIVALS]);
  await page.reload();
  await page.waitForTimeout(800);
  await page.click("#btnPractice");
  await page.waitForTimeout(300);
  await snap(page, "team", -1, "우리 조", `이번 판은 ${TEAMS.length}개 조 · 경쟁사 ${RIVALS}곳입니다.`);
  await page.click("#btnContinue").catch(async () => { await page.click("#btnStart"); });
  await page.waitForTimeout(700);

  const setup = await page.evaluate(() => {
    const g = window.DRBState.g();
    return { teams: g.teamNames, rivals: Object.keys(g.rivals).map(k => g.rivals[k].name) };
  });
  console.log(`\n판 구성 : ${setup.teams.join(" · ")}  |  경쟁사 ${setup.rivals.join(", ")}`);

  /* 조를 바꿉니다.
     ★ 상단 [조 전환] 은 배분·대기 화면에서만 열립니다. 엔딩·최종 화면에서는
       잠기므로, 그때는 저장된 상태 그대로 다시 들어갑니다. */
  async function focusTeam(name) {
    const switched = await page.evaluate((n) => {
      const sel = document.getElementById("tbTeam");
      if (!sel || sel.offsetParent === null || sel.disabled) return false;
      if (window.DRBState.g().activeTeam !== n) {
        sel.value = n;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }, name);
    if (switched) { await page.waitForTimeout(450); return; }

    await page.evaluate((n) => window.DRBState.switchTeam(n), name);
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#btnPractice").catch(() => {});
    await page.waitForTimeout(250);
    await page.click("#btnContinue").catch(() => {});
    await page.waitForTimeout(800);
  }

  /* ---------- 한 조의 한 국면을 실제로 플레이 ---------- */
  async function playTurn(teamName, turn) {
    await focusTeam(teamName);

    const at = await page.evaluate(() => {
      const S = window.DRBState;
      return { turn: S.turnIndex(), phase: S.phase(), era: S.era().id, year: S.subround().year };
    });
    if (at.phase !== "invest" || at.turn !== turn) {
      console.log(`      (건너뜀 이유 — 지금 ${teamName}: ${at.turn + 1}국면 · ${at.phase} · 기대 ${turn + 1}국면 invest)`);
      return null;
    }

    const strat = STRATEGY[teamName];
    await snap(page, teamName, turn, "자원 배분",
      `${at.year}년 · ${strat.label}. 아직 아무것도 넣지 않은 상태입니다.`);

    /* 계획한 만큼 + 버튼을 실제로 누릅니다 (사람이 하는 것과 같은 경로) */
    const order = strat.plan[at.era] || [];
    for (const [id, want] of order) {
      const times = Math.round(want / 10);
      for (let k = 0; k < times; k++) {
        const done = await page.evaluate((itemId) => {
          if (parseInt(document.getElementById("inRemain").textContent, 10) <= 0) return true;
          const card = [...document.querySelectorAll("#inList .alloc")]
            .filter(n => n.dataset.id === itemId)[0];
          if (!card) return true;
          const plus = card.querySelector(".btn--plus:not([disabled])");
          if (!plus) return true;
          plus.click();
          return false;
        }, id);
        if (done) break;
      }
    }
    /* 남은 예산이 있으면 아무 데나 밀어넣지 않고 현금으로 둡니다 — 그것도 전략입니다 */

    await page.evaluate((policyId) => {
      const list = [...document.querySelectorAll("#poList .policy")];
      const want = list.filter(n => n.dataset.id === policyId)[0];
      (want || list[0]).click();
    }, strat.policy[at.era]);
    await page.waitForTimeout(250);

    const picked = await page.evaluate(() => {
      const S = window.DRBState;
      const items = S.investments();
      const out = [];
      document.querySelectorAll("#inList .alloc").forEach(n => {
        const v = parseInt((n.querySelector(".alloc__amount") || {}).textContent || "0", 10);
        if (v > 0) {
          const item = items.filter(i => i.id === n.dataset.id)[0];
          out.push((item ? item.name : n.dataset.id) + " " + v);
        }
      });
      /* 이름 안에 '지난 국면' 딱지가 같이 들어 있어 떼어냅니다 */
      const pol = document.querySelector("#poList .policy.is-selected .policy__name");
      let policy = "";
      if (pol) {
        policy = [...pol.childNodes]
          .filter(n => n.nodeType === 3 || !n.classList || !n.classList.contains("policy__current"))
          .map(n => n.textContent).join("").trim();
      }
      return { picks: out, policy: policy, budget: S.budget() };
    });

    await snap(page, teamName, turn, "확정 직전",
      `예산 ${picked.budget} → ${picked.picks.join(" · ")} · 정책 ${picked.policy}`);
    log.push({ turn, team: teamName, ...picked, year: at.year });

    await page.click("#btnInvestGo");
    await page.waitForTimeout(700);

    /* 연습 모드에서는 노트북에서도 연도가 흐릅니다 (라이브에서는 빔에서만) */
    await snap(page, teamName, turn, "확정 뒤",
      "확정했습니다. 교육 당일에는 이 자리에서 진행자 화면을 봅니다.");

    /* 연도가 흐르는 동안 기다립니다. 이미 끝났으면 [건너뛰기] 를 건드리지 않습니다 —
       끝난 뒤에 누르면 국면이 한 번 더 넘어갑니다. */
    for (let k = 0; k < 24; k++) {
      const now = await page.evaluate(() => ({
        phase: window.DRBState.phase(),
        canSkip: !document.getElementById("btnSkipLapse").classList.contains("hidden"),
      }));
      if (now.phase !== "timelapse") break;
      if (now.canSkip) await page.evaluate(() => document.getElementById("btnSkipLapse").click());
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const S = window.DRBState, g = S.g();
      return { team: g.activeTeam, turn: S.turnIndex(), phase: S.phase(),
               hist: g.teamNames.map(n => g.teams[n].history.length).join(",") };
    });
    if (after.turn === turn && after.phase === "invest") {
      errors.push(`${teamName} 가 ${turn + 1}국면을 확정하지 못했습니다`);
      return null;
    }
    return true;
  }

  /* ---------- 6국면을 두 조가 번갈아 ---------- */
  for (let turn = 0; turn < 6; turn++) {
    for (const name of TEAMS) {
      const ok = await playTurn(name, turn);
      console.log(`  ${turn + 1}국면  ${name}  ${ok ? "확정" : "건너뜀"}`);

    }
    /* 두 조가 다 잠긴 뒤에야 '한 곳만 딸 수 있는 기회' 가 판정됩니다 */
    const verdict = await page.evaluate((t) => {
      const S = window.DRBState, E = window.DRBEngine, g = S.g();
      const awards = (g.awards || {})[t] || null;
      if (!awards) return null;
      const subs = [];
      window.DRB_ROUNDS.forEach(r => r.subrounds.forEach(x => subs.push(x)));
      const offers = E.limitedOffers(subs[t]);
      const bidders = g.teamNames.map(n => {
        const h = g.teams[n].history[t];
        return h ? { team: n, state: h.before, allocation: h.allocation, policyId: h.policyId } : null;
      }).filter(Boolean);
      return {
        awards: awards,
        detail: offers.map(o => E.awardLimited(o, bidders)),
        bets: bidders.map(b => b.team + " " + JSON.stringify(b.allocation)),
      };
    }, turn);
    if (verdict) {
      console.log(`         ↳ 낙찰 : ${JSON.stringify(verdict.awards)}`);
      verdict.bets.forEach(b => console.log(`             ${b}`));
      verdict.detail.forEach(dt => dt.ranking.forEach(r =>
        console.log(`             ${r.team} 점수 ${r.score} ${r.qualified ? "응찰" : "문턱 미달"}`)));
    }
  }

  /* ---------- 끝난 뒤 노트북 화면 ----------
     마지막 국면을 막 끝낸 조가 화면에 그대로 있을 때 찍습니다.
     엔딩·최종 화면에서는 조 전환이 열리지 않습니다. */
  async function captureEnding(name) {
    {
    for (let i = 0; i < 8; i++) {
      const screen = await page.evaluate(() => {
        const n = document.querySelector(".screen.is-active");
        return n ? n.id.replace("sc-", "") : null;
      });
      if (screen === "ending") { await snap(page, name, 6, "2026 엔딩", "여기서부터는 정답이 없습니다."); await page.click("#btnEndNext").catch(() => {}); }
      else if (screen === "final") { await snap(page, name, 6, "최종 결과", "등수가 아니라 '어떤 회사를 만들었는가' 입니다."); await page.click("#btnFinalGo").catch(() => {}); }
      else if (screen === "reflect") {
        await snap(page, name, 6, "회고", "80년 중 가장 이야기하고 싶은 결정 하나를 고릅니다.");
        break;
      } else break;
      await page.waitForTimeout(600);
    }
    }
  }

  /* 엔딩·최종 화면에서는 상단 조 전환이 열리지 않습니다.
     저장된 상태를 그대로 두고 조만 바꿔 새로 고칩니다. */
  for (const name of TEAMS) {
    await focusTeam(name);
    await captureEnding(name);
  }

  const finals = await page.evaluate(() => {
    const S = window.DRBState, E = window.DRBEngine;
    return S.g().teamNames.map(n => {
      const t = S.g().teams[n];
      const style = E.styleOf ? E.styleOf(t.state) : null;
      return {
        name: n,
        cash: Math.round(t.state.cash), tech: Math.round(t.state.tech),
        quality: Math.round(t.state.quality), trust: Math.round(t.state.trust),
        capacity: Math.round(t.state.capacity), people: Math.round(t.state.people),
        adaptive: E.adaptiveCapacity(t.state).score,
        style: style ? style.name : "",
        revenue: t.history.reduce((a, h) => a + (h.report.kpi.revenue || 0), 0),
        profit: t.history.reduce((a, h) => a + (h.report.kpi.profit || 0), 0),
      };
    });
  });

  const save = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) out[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    return out;
  });
  await ctx.close();

  /* ---------- 같은 판을 진행자 빔으로 ---------- */
  console.log("\n진행자 빔");
  const beamCtx = await browser.newContext({ viewport: BEAM_VIEW, deviceScaleFactor: SCALE });
  await beamCtx.addInitScript(entries => {
    Object.keys(entries).forEach(k => localStorage.setItem(k, entries[k]));
  }, save);
  const fac = await beamCtx.newPage();
  fac.on("pageerror", e => errors.push("진행자: " + e.message));
  await fac.goto(`http://127.0.0.1:${PORT}/facilitator.html`);
  await fac.waitForTimeout(1400);

  const seen = new Set();
  for (let i = 0; i < 90; i++) {
    const at = await fac.evaluate(() => {
      const n = document.querySelector("[data-stage-panel]:not(.hidden)");
      const chip = document.getElementById("bProgress");
      const m = chip && /(\d+)\s*\/\s*\d+/.exec(chip.textContent);
      return n ? { stage: n.dataset.stagePanel, turn: m ? Number(m[1]) - 1 : 0 } : null;
    });
    if (at) {
      const key = at.stage + "-" + at.turn;
      if (!seen.has(key)) {
        seen.add(key);
        if (at.stage === "lapse") await fac.waitForTimeout(2800);
        await snap(fac, "beam", at.turn, at.stage, "");
        console.log(`  ${at.turn + 1}국면  ${CHAPTER[at.stage] || at.stage}`);
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
  await beamCtx.close();
  await browser.close();
  server.close();

  /* ---------- 데이터 ---------- */
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  ["data/config.js", "data/eras.js", "data/rounds.js"].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f }));
  const flat = [];
  sandbox.window.DRB_ROUNDS.forEach(r => r.subrounds.forEach(s =>
    flat.push({ year: s.year, title: s.title, roundNo: r.no, era: sandbox.window.DRB_ERAS[r.era] })));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buildHtml({ shots, log, finals, setup, flat, CFG: sandbox.window.DRB_CONFIG, errors }), "utf8");

  console.log("\n" + "=".repeat(70));
  if (errors.length) { console.log("브라우저 오류 " + errors.length + "건"); errors.slice(0, 5).forEach(e => console.log("  - " + e)); }
  else console.log("브라우저 오류 없음");
  console.log(`캡처 ${shots.length}장 · 이미지 ${(bytes / 1048576).toFixed(1)}MB`);
  console.log("→ " + OUT + `  (${(fs.statSync(OUT).size / 1048576).toFixed(1)}MB)`);
  console.log("=".repeat(70));
})();


/* ============================================================
   HTML 한 장
   ============================================================ */
function buildHtml(d) {
  const { shots, log, finals, setup, flat, CFG, errors } = d;

  const WHO = {
    beam: { label: "빔", cls: "beam" },
    "1조": { label: "1조 노트북", cls: "t1" },
    "2조": { label: "2조 노트북", cls: "t2" },
    team: { label: "노트북", cls: "t1" },
  };

  function card(s) {
    const w = WHO[s.who] || WHO.team;
    const title = s.who === "beam" ? (CHAPTER[s.name] || s.name) : s.name;
    return `
      <figure class="shot shot--${w.cls}">
        <button class="shot__frame" type="button">
          <img src="data:image/jpeg;base64,${s.data}" alt="${esc(title)}" loading="lazy" decoding="async">
        </button>
        <figcaption>
          <span class="tag tag--${w.cls}">${esc(w.label)}</span>
          <b>${esc(title)}</b>
          ${s.note ? `<span class="note">${esc(s.note)}</span>` : ""}
        </figcaption>
      </figure>`;
  }

  const intro = shots.filter(s => s.turn === -1);
  const outro = shots.filter(s => s.turn === 6);

  const phases = flat.map((f, i) => {
    const beam = shots.filter(s => s.turn === i && s.who === "beam");
    const t1 = shots.filter(s => s.turn === i && s.who === "1조");
    const t2 = shots.filter(s => s.turn === i && s.who === "2조");
    if (!beam.length && !t1.length && !t2.length) return "";
    const decisions = log.filter(l => l.turn === i);
    return `
    <section class="phase" id="p${i + 1}">
      <header class="phase__head">
        <span class="phase__no">국면 ${i + 1}</span>
        <span class="phase__year">${f.year}</span>
        <span class="phase__title">${esc(String(f.title).replace(/^.*·\s*/, ""))}</span>
        <span class="phase__era">ERA ${f.roundNo} · ${esc(f.era.name)}</span>
      </header>
      ${decisions.length ? `
      <div class="calls">
        ${decisions.map(l => `
          <div class="call call--${WHO[l.team].cls}">
            <b>${esc(l.team)}</b>
            <span class="call__budget">예산 ${l.budget}</span>
            <span class="call__picks">${esc(l.picks.join(" · "))}</span>
            <span class="call__policy">${esc(l.policy)}</span>
          </div>`).join("")}
      </div>` : ""}
      <h3 class="sub">빔 — 다 같이 봅니다</h3>
      <div class="grid">${beam.map(card).join("")}</div>
      <h3 class="sub">노트북 — 조가 결정합니다</h3>
      <div class="grid">${t1.map(card).join("")}${t2.map(card).join("")}</div>
    </section>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>두 회사의 80년</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;700;800&family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
:root {
  --ink:#1A1327; --ink-2:#5F5677; --ink-3:#8E86A4;
  --ground:#FFFFFF; --surface:#FAF8FD; --line:#E7E2F0; --line-2:#D6CEE7;
  --accent:#8B5CD6; --accent-deep:#43277F; --coral:#FF7A5C;
  --t1:#8B5CD6; --t2:#E0733F;
  --shadow:0 1px 2px rgba(26,19,39,.05), 0 12px 32px rgba(26,19,39,.06);
  --sans:"IBM Plex Sans KR","Pretendard","Malgun Gothic","맑은 고딕",system-ui,sans-serif;
  --disp:"Gothic A1","Pretendard","Malgun Gothic","맑은 고딕",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ink:#EFEBF7; --ink-2:#A79EBE; --ink-3:#776E8D;
    --ground:#14101F; --surface:#1D1730; --line:#2E2545; --line-2:#3D3159;
    --accent:#A985E6; --accent-deep:#C6A9EE; --coral:#FF9179;
    --t1:#A985E6; --t2:#F0925C;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 14px 36px rgba(0,0,0,.34);
  }
}
:root[data-theme="dark"] {
  --ink:#EFEBF7; --ink-2:#A79EBE; --ink-3:#776E8D;
  --ground:#14101F; --surface:#1D1730; --line:#2E2545; --line-2:#3D3159;
  --accent:#A985E6; --accent-deep:#C6A9EE; --coral:#FF9179;
  --t1:#A985E6; --t2:#F0925C;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 14px 36px rgba(0,0,0,.34);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px 96px}
.top{display:flex;flex-direction:column;gap:20px;padding:64px 0 36px;border-bottom:1px solid var(--line)}
.top__kicker{font-family:var(--mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
.top__title{margin:0;font-family:var(--disp);font-weight:800;font-size:clamp(34px,5vw,56px);line-height:1.08;letter-spacing:-.035em;text-wrap:balance}
.top__lead{margin:0;max-width:64ch;color:var(--ink-2);font-size:17px}
.who{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:8px}
.who__card{padding:18px 20px;border:1px solid var(--line);border-left:5px solid var(--line-2);border-radius:12px;background:var(--surface)}
.who__card--t1{border-left-color:var(--t1)}
.who__card--t2{border-left-color:var(--t2)}
.who__name{font-family:var(--disp);font-weight:800;font-size:19px}
.who__label{color:var(--ink-2);font-size:15px}
.who__note{margin:6px 0 0;color:var(--ink-2);font-size:14px;line-height:1.5}
.tag{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;border:1px solid var(--line-2)}
.tag--beam{background:color-mix(in srgb,var(--accent) 14%,transparent);border-color:var(--accent);color:var(--accent-deep)}
.tag--t1{border-color:var(--t1);color:var(--t1)}
.tag--t2{border-color:var(--t2);color:var(--t2)}
.rail{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px;margin:0 -24px;padding:12px 24px;background:color-mix(in srgb,var(--ground) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.rail a{display:inline-flex;align-items:baseline;gap:7px;padding:5px 12px;border-radius:8px;color:var(--ink-2);text-decoration:none;font-family:var(--mono);font-size:13px}
.rail a:hover,.rail a:focus-visible{background:var(--surface);color:var(--ink)}
.rail a b{color:var(--ink);font-weight:600}
.phase{padding-top:56px}
.phase__head{display:grid;grid-template-columns:auto auto 1fr;align-items:baseline;gap:8px 16px;padding-bottom:18px;border-bottom:2px solid var(--ink)}
.phase__no{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.phase__year{font-family:var(--mono);font-weight:600;font-size:clamp(30px,4vw,44px);letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums}
.phase__title{font-family:var(--disp);font-weight:700;font-size:20px;letter-spacing:-.02em}
.phase__era{grid-column:2/-1;color:var(--ink-3);font-size:13px}
.calls{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-top:22px}
.call{display:grid;grid-template-columns:auto auto;gap:2px 12px;padding:14px 18px;border:1px solid var(--line);border-left:5px solid var(--line-2);border-radius:10px;background:var(--surface);font-size:15px}
.call--t1{border-left-color:var(--t1)}
.call--t2{border-left-color:var(--t2)}
.call b{font-family:var(--disp);font-size:17px}
.call__budget{font-family:var(--mono);color:var(--ink-2);font-size:13px;text-align:right}
.call__picks{grid-column:1/-1;color:var(--ink)}
.call__policy{grid-column:1/-1;color:var(--ink-2);font-size:14px}
.sub{margin:34px 0 0;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:26px;padding-top:16px}
.shot{margin:0;display:flex;flex-direction:column;gap:11px}
.shot__frame{display:block;width:100%;padding:0;cursor:zoom-in;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden;box-shadow:var(--shadow)}
.shot--beam .shot__frame{border-color:var(--accent)}
.shot--t1 .shot__frame{border-color:var(--t1)}
.shot--t2 .shot__frame{border-color:var(--t2)}
.shot__frame img{display:block;width:100%;height:auto}
.shot figcaption{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px}
.shot figcaption b{font-family:var(--disp);font-weight:700;font-size:16px;letter-spacing:-.02em}
.note{flex:1 1 100%;color:var(--ink-2);font-size:14px;line-height:1.5}
table.result{width:100%;border-collapse:collapse;margin-top:24px;font-size:15px}
table.result th,table.result td{padding:11px 14px;border-bottom:1px solid var(--line);text-align:right}
table.result th:first-child,table.result td:first-child{text-align:left}
table.result thead th{color:var(--ink-3);font-size:13px;font-weight:600;border-bottom:2px solid var(--ink)}
table.result td{font-family:var(--mono);font-variant-numeric:tabular-nums}
table.result td:first-child,table.result td:last-child{font-family:var(--sans)}
.wrapscroll{overflow-x:auto}
dialog{width:min(96vw,1600px);max-width:none;padding:0;border:0;border-radius:12px;background:var(--surface);color:var(--ink)}
dialog::backdrop{background:rgba(10,7,18,.82)}
dialog img{display:block;width:100%;height:auto}
.close{position:sticky;top:0;display:flex;justify-content:flex-end;padding:10px;background:var(--surface)}
.close button{padding:7px 14px;border:1px solid var(--line-2);border-radius:8px;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:14px;cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.foot{padding-top:56px;color:var(--ink-3);font-size:13px}
.foot code{font-family:var(--mono)}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <span class="top__kicker">${esc(CFG.subtitle)}</span>
    <h1 class="top__title">두 회사의 80년</h1>
    <p class="top__lead">
      성격이 다른 두 조와 경쟁사 한 곳으로 1945년부터 2026년까지 실제로 한 판을 끝까지 플레이하고,
      국면마다 빔에 뜬 화면과 두 조의 노트북 화면을 그대로 담았습니다.
      기계적으로 눌러본 것이 아니라 <b>조마다 정해둔 전략대로</b> 결정했습니다.
    </p>
    <div class="who">
      ${finals.map(f => {
        const st = STRATEGY[f.name] || {};
        return `<div class="who__card who__card--${WHO[f.name].cls}">
          <div><span class="who__name">${esc(f.name)}</span> <span class="who__label">${esc(st.label || "")}</span></div>
          <p class="who__note">${esc(st.note || "")}</p>
        </div>`;
      }).join("")}
      <div class="who__card">
        <div><span class="who__name">경쟁사</span> <span class="who__label">${esc(setup.rivals.join(", "))}</span></div>
        <p class="who__note">조들이 고민하는 동안에도 움직입니다. 같은 분야에 몰리면 수요를 나눠 갖습니다.</p>
      </div>
    </div>
  </header>

  <nav class="rail" aria-label="국면으로 이동">
    <a href="#start"><b>시작</b></a>
    ${flat.map((f, i) => `<a href="#p${i + 1}"><b>${i + 1}국면</b>${f.year}</a>`).join("")}
    <a href="#end"><b>결과</b></a>
  </nav>

  <section class="phase" id="start">
    <header class="phase__head">
      <span class="phase__no">시작</span><span class="phase__year">준비</span>
      <span class="phase__title">들어오기</span>
      <span class="phase__era">${esc(setup.teams.join(" · "))} · 경쟁사 ${setup.rivals.length}곳</span>
    </header>
    <div class="grid">${intro.map(card).join("")}</div>
  </section>

  ${phases}

  <section class="phase" id="end">
    <header class="phase__head">
      <span class="phase__no">결과</span><span class="phase__year">2026</span>
      <span class="phase__title">어떤 회사가 되었나</span>
      <span class="phase__era">등수를 매기지 않습니다 — 두 숫자와 한 문장으로 규정합니다</span>
    </header>
    <div class="wrapscroll">
      <table class="result">
        <thead><tr>
          <th>조</th><th>누적 매출</th><th>누적 손익</th><th>현금</th>
          <th>기술력</th><th>품질</th><th>고객신뢰</th><th>생산능력</th>
          <th>변화 대응력</th><th>경영 스타일</th>
        </tr></thead>
        <tbody>
        ${finals.map(f => `<tr>
          <td>${esc(f.name)}</td><td>${Math.round(f.revenue).toLocaleString("ko-KR")}</td>
          <td>${Math.round(f.profit).toLocaleString("ko-KR")}</td><td>${f.cash}</td>
          <td>${f.tech}</td><td>${f.quality}</td><td>${f.trust}</td><td>${f.capacity}</td>
          <td><b>${f.adaptive}</b></td><td>${esc(f.style)}</td>
        </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="grid">${outro.map(card).join("")}</div>
  </section>

  <p class="foot">
    <code>node tools/playthrough.js</code> 로 다시 만듭니다. 조별 전략은 그 파일 위쪽 STRATEGY 에 있습니다.
    ${errors.length ? `<br>이번 실행에서 브라우저 오류 ${errors.length}건이 있었습니다.` : ""}
  </p>
</div>

<dialog id="zoom">
  <div class="close"><button type="button" autofocus>닫기</button></div>
  <img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
</dialog>
<script>
  var zoom=document.getElementById("zoom"),big=zoom.querySelector("img");
  document.querySelectorAll(".shot__frame").forEach(function(b){
    b.addEventListener("click",function(){var i=b.querySelector("img");big.src=i.src;big.alt=i.alt;zoom.showModal();});
  });
  zoom.querySelector("button").addEventListener("click",function(){zoom.close();});
  zoom.addEventListener("click",function(e){if(e.target===zoom)zoom.close();});
</script>
</body>
</html>`;
}
