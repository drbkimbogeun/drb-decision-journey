/* ============================================================
   playtest.js — 실제 화면을 처음부터 끝까지 눌러보는 테스트

   실행 :  node tools/playtest.js
   준비 :  npm install jsdom   (없으면 안내만 하고 종료합니다)

   진짜 브라우저처럼 index.html 을 띄우고, 사람이 하듯 버튼을 눌러
   게임이 끝까지 도는지 · 화면이 비어 있지 않은지 · 오류가 없는지 확인합니다.
   ============================================================ */

const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  ({ JSDOM } = require(process.env.JSDOM_PATH || "jsdom"));
} catch (e) {
  console.log("jsdom 이 없어 화면 테스트를 건너뜁니다.");
  console.log("설치하려면 :  npm install jsdom");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
let fail = 0;
const errors = [];

function ok(m)  { console.log("OK   " + m); }
function bad(m) { console.log("실패 " + m); fail++; }

/* 실제 교육장과 같은 조건(로컬 서버)에서 테스트하기 위해
   임시 정적 서버를 띄운다. 외부 패키지 없이 node 기본 모듈만 쓴다. */
const http = require("http");
const PORT = 8791;
const MIME = { ".html": "text/html", ".js": "text/javascript",
               ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg" };

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
  await new Promise(r => server.listen(PORT, "127.0.0.1", r));

  const dom = await JSDOM.fromURL(`http://127.0.0.1:${PORT}/index.html`, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true
  });

  const win = dom.window;
  const doc = win.document;

  /* 오류를 하나도 놓치지 않도록 전부 잡는다 */
  win.addEventListener("error", e => errors.push("window.onerror: " + e.message));
  const origError = win.console.error;
  win.console.error = function () {
    errors.push("console.error: " + Array.from(arguments).join(" "));
    origError.apply(win.console, arguments);
  };

  /* jsdom 은 confirm/alert 이 없다 */
  win.confirm = () => true;
  win.alert = m => errors.push("alert: " + m);

  await new Promise(r => {
    if (doc.readyState === "complete") r();
    else win.addEventListener("load", r);
  });
  await new Promise(r => setTimeout(r, 120));

  const $ = id => doc.getElementById(id);
  const click = id => {
    const n = $(id);
    if (!n) { bad(`버튼 #${id} 이 없습니다`); return false; }
    if (n.disabled) { bad(`버튼 #${id} 이 비활성 상태입니다`); return false; }
    n.click();
    return true;
  };
  const visible = id => {
    const n = $(id);
    return n && !n.classList.contains("hidden");
  };
  const activeScreen = () => {
    const n = doc.querySelector(".screen.is-active");
    return n ? n.id.replace("sc-", "") : null;
  };

  console.log("=".repeat(80));
  console.log("화면 플레이 테스트 — 사람이 누르듯 처음부터 끝까지");
  console.log("=".repeat(80));

  /* ---------- 시작 화면 ---------- */
  if (!visible("intro")) bad("시작 화면이 보이지 않습니다");
  else ok("시작 화면 표시");

  /* 표지 — 참가 코드 창이 먼저 뜹니다 */
  if ($("intro").getAttribute("data-step") !== "0") bad("표지가 먼저 보이지 않습니다");
  if (!$("joinCode")) bad("참가 코드 입력창이 없습니다");
  else ok("표지 · 참가 코드 입력창 표시");

  /* 코드가 없으면 연습 모드로 갑니다 */
  click("btnPractice");
  if ($("intro").getAttribute("data-step") !== "1") bad("연습 모드로 넘어가지 않았습니다");
  else ok("연습 모드 → 우리 조 고르기");

  if ($("roleChips").children.length !== win.DRB_CONFIG.roles.length) bad("역할 표시가 맞지 않습니다");
  else ok(`역할 ${$("roleChips").children.length}개 표시`);

  if ($("teamCountPicker").children.length === 0) bad("조 수 선택 버튼이 그려지지 않았습니다");
  else ok(`조 수 선택 ${$("teamCountPicker").children.length}개`);

  if ($("teamPicker").children.length === 0) bad("조 선택 버튼이 그려지지 않았습니다");
  else ok(`조 선택 ${$("teamPicker").children.length}개`);

  click("btnStart");
  if (visible("intro")) bad("게임 시작을 눌렀는데 시작 화면이 남아 있습니다");
  else ok("게임 화면 진입");

  /* ---------- 본 게임 ---------- */
  const S = win.DRBState;
  const CFG = win.DRB_CONFIG;
  let guard = 0;
  let investCount = 0;
  const log = [];

  while (activeScreen() !== "final" && guard++ < 140) {
    const screen = activeScreen();

    if (screen === "invest") {
      const cards = $("inList").children;
      if (cards.length === 0) { bad("투자 항목이 하나도 없습니다"); break; }

      investCount++;

      /* 예산이 남는 동안 앞쪽 항목들의 + 를 눌러본다 */
      const budget = S.budget();
      let pressed = 0;
      for (let round = 0; round < 20; round++) {
        const remain = parseInt($("inRemain").textContent, 10);
        if (remain <= 0) break;
        const card = $("inList").children[pressed % Math.min(3, cards.length)];
        const plus = card.querySelectorAll("button")[1];
        plus.click();
        pressed++;
      }
      const remainAfter = parseInt($("inRemain").textContent, 10);
      if (remainAfter < 0) bad("예산보다 많이 배분되었습니다 (남은 예산 " + remainAfter + ")");

      /* 해외 진출 항목이 열렸다면 '어디에/어떻게' 도 실제로 눌러본다 */
      const dims = doc.querySelectorAll(".dimension");
      if (dims.length) {
        dims.forEach(d => {
          d.querySelectorAll(".dimension__opts").forEach(g => {
            const opts = g.querySelectorAll(".dim-opt");
            if (opts.length) opts[investCount % opts.length].click();
          });
        });
        const stillWarn = doc.querySelectorAll(".dimension__warn").length;
        if (stillWarn) bad("지역·방식을 다 골랐는데도 경고가 남아 있습니다");
        log.push("  해외 진출 지역·방식 선택 완료");
      }

      log.push(`  자원 배분 — 예산 ${budget}, 남은 ${remainAfter}`);

      /* 예산 초과 방지가 동작하는지 확인 */
      const before = $("inRemain").textContent;
      if (remainAfter === 0) {
        $("inList").children[0].querySelectorAll("button")[1].click();
        if ($("inRemain").textContent !== before) {
          bad("예산이 0인데 더 투자할 수 있었습니다");
        }
      }

      /* 정책은 같은 화면 아래 띠에 있습니다. 고르기 전에는 확정이 잠깁니다. */
      const policies = $("poList").children;
      if (policies.length === 0) { bad("정책 항목이 없습니다"); break; }
      if (!$("btnInvestGo").disabled) bad("정책을 고르기 전인데 확정 버튼이 활성화되어 있습니다");
      const picked = policies[guard % policies.length];
      picked.click();
      if ($("btnInvestGo").disabled) { bad("정책을 골랐는데 확정 버튼이 잠겨 있습니다"); break; }
      log.push(`  정책 — ${picked.querySelector(".policy__name").textContent.trim()}`);

      click("btnInvestGo");

    } else if (screen === "timelapse") {
      if (!$("tlYear").textContent.trim()) bad("타임랩스 연도가 비어 있습니다");
      click("btnSkipLapse");
      log.push("  시간 진행 (건너뛰기)");

    } else if (screen === "ending") {
      /* 2026 엔딩 — 한 화면이 3단계로 열린다 */
      if (!$("endYears").children.length) bad("엔딩의 연도 칩이 비어 있습니다");
      let step = 0;
      while (step < 2) {
        if ($("ending").getAttribute("data-step") !== String(step)) {
          bad(`엔딩 단계가 ${step} 이 아닙니다`); break;
        }
        if (step === 1 && !$("endMarket").children.length) {
          bad("엔딩의 '시장은 멈추지 않습니다' 목록이 비어 있습니다");
        }
        click("btnEndNext");
        step++;
      }
      if ($("sc-ending").classList.contains("is-active")) bad("엔딩이 끝나지 않았습니다");
      log.push("  2026 UNKNOWN 엔딩 2단계 통과");

    } else {
      bad("알 수 없는 화면: " + screen);
      break;
    }
  }

  log.forEach(l => console.log("     " + l));

  if (activeScreen() !== "final") bad("최종 화면까지 가지 못했습니다 (현재: " + activeScreen() + ")");
  else ok("최종 화면 도달");

  /* ---------- 최종 화면 ---------- */
  if (!$("fiStyleName").textContent.trim()) bad("경영스타일이 표시되지 않았습니다");
  else ok("경영스타일 — " + $("fiStyleName").textContent);

  if ($("fiJourney").children.length !== S.totalTurns()) {
    bad(`'우리가 걸어온 길' 항목이 ${$("fiJourney").children.length}개 (예상 ${S.totalTurns()}개)`);
  } else ok("여정 요약 " + S.totalTurns() + "줄");

  if ($("fiMetrics").children.length !== CFG.metrics.length) bad("최종 지표 개수가 맞지 않습니다");
  else ok("최종 지표 " + CFG.metrics.length + "개");

  if ($("fiInvest").children.length === 0) bad("누적 투자 요약이 비어 있습니다");
  else ok("누적 투자 요약 " + $("fiInvest").children.length + "줄");

  if ($("fiGap").children.length !== win.DRB_ROUNDS.length) bad("'가장 달랐던 순간' 선택지 개수가 맞지 않습니다");
  else ok("달랐던 순간 선택지 " + win.DRB_ROUNDS.length + "개");

  /* 선택 + 질문 저장 */
  $("fiGap").children[1].click();
  if (!S.team().gapPick) bad("가장 달랐던 순간이 저장되지 않았습니다");
  else ok("달랐던 순간 저장 — " + S.team().gapPick);

  /* 이유를 비운 채 저장하면 거부되어야 한다 */
  $("fiReason").value = "";
  click("btnSaveReason");
  if (S.team().reason) bad("이유가 비었는데도 저장되었습니다");
  else ok("빈 이유는 저장 거부");

  $("fiReason").value = "지금 확실한 현금흐름을 지키는 것이 먼저라고 판단했습니다.";
  click("btnSaveReason");
  if (!S.team().reason) bad("결정 이유가 저장되지 않았습니다");
  else ok("결정 이유 저장");

  /* 결정 카드가 실제로 채워졌는지 */
  const cardRows = $("fiCardBody").children;
  if (cardRows.length < 6) bad(`결정 카드 항목이 ${cardRows.length}개 (예상 6개)`);
  else ok("결정 카드 6개 항목 생성");
  {
    const gap = S.team().gapPick;
    const rd = win.DRB_ROUNDS.filter(r => r.id === gap)[0] || win.DRB_ROUNDS[0];
    const a = win.DRB_ACTUAL[rd.actualId];
    const cardText = $("fiCardBody").textContent;
    if (a.filled) {
      if (cardText.indexOf("입력 예정") >= 0) bad("결정 카드에 placeholder 가 남아 있습니다");
      else ok("결정 카드 · 실제 DRB 기록 표시됨");
    } else {
      if (cardText.indexOf("입력 예정") < 0) bad("결정 카드에 입력 예정 안내가 없습니다");
      else ok("결정 카드 · placeholder 유지");
    }
  }

  /* 변화 대응력이 최종 화면에서 처음 공개되는가 */
  if (!$("fiAdaptScore").textContent.trim()) bad("변화 대응력 점수가 표시되지 않았습니다");
  else ok("변화 대응력 공개 — " + $("fiAdaptScore").textContent);
  if (!$("fiPowerScore").textContent.trim()) bad("현재 경쟁력 점수가 표시되지 않았습니다");
  else ok("현재 경쟁력 — " + $("fiPowerScore").textContent);
  if (!$("fiAdaptFill").style.width || !$("fiPowerFill").style.width) bad("점수 막대가 그려지지 않았습니다");
  else ok("점수 막대 표시");
  if ($("fiAdaptParts").children.length < 5) bad("변화 대응력 구성 항목이 부족합니다");
  else ok("변화 대응력 구성 " + $("fiAdaptParts").children.length + "항목");
  if (!$("fiVerdict").textContent.trim()) bad("최종 총평이 비어 있습니다");
  else ok("최종 총평 표시");
  if ($("fiReplay").children.length !== S.totalTurns()) {
    bad(`80년 Replay 가 ${$("fiReplay").children.length}줄 (예상 ${S.totalTurns()}줄)`);
  } else ok("80년 Replay " + S.totalTurns() + "줄");
  if (!$("fiStanding").children.length) bad("최종 경쟁사 비교가 비어 있습니다");
  else ok("경쟁사 대비 위치 표시");

  /* ---------- 회사 상태는 상단 [상태] 모달에서만 봅니다 ---------- */
  click("btnDetail");
  if (!$("modal").classList.contains("is-open")) bad("회사 상태 모달이 열리지 않았습니다");
  else ok("회사 상태 모달 표시");
  click("modalClose");

  /* ---------- 조 전환 ---------- */
  const other = S.g().teamNames.find(n => n !== S.g().activeTeam);
  $("tbTeam").value = other;
  $("tbTeam").dispatchEvent(new win.Event("change"));
  if (S.g().activeTeam !== other) bad("조 전환이 되지 않았습니다");
  else if (S.team().history.length !== 0) bad("전환한 조에 남의 기록이 섞였습니다");
  else ok(`조 전환 정상 (${other} 는 시작 상태)`);
  if (activeScreen() !== "invest") bad("조를 바꿨는데 그 조의 배분 화면으로 가지 않았습니다");
  else ok("조 전환 시 해당 조 진행 위치로 이동");

  /* ---------- 관리자 모드 ---------- */
  click("btnAdmin");
  if (!S.g().adminMode) bad("관리자 모드가 켜지지 않았습니다");
  else ok("관리자 모드 전환");

  /* ---------- 상세 모달 ---------- */
  click("btnDetail");
  if (!$("modal").classList.contains("is-open")) bad("상세 지표 모달이 열리지 않았습니다");
  else ok("상세 지표 모달 열림");
  click("modalClose");
  if ($("modal").classList.contains("is-open")) bad("모달이 닫히지 않았습니다");
  else ok("모달 닫힘");

  /* ---------- 최종 → What If ---------- */
  click("btnFinalGo");
  if (activeScreen() !== "whatif") bad("최종 화면에서 What If 로 넘어가지 않았습니다");
  else {
    const rows = $("wiBody").children;
    const expected = 1 + (win.DRB_WHATIF || []).length;
    if (rows.length !== expected) bad(`What If 표가 ${rows.length}줄 (예상 ${expected}줄)`);
    else if (!rows[0] || !rows[0].classList.contains("is-ours")) bad("What If 첫 줄이 '우리 조'가 아닙니다");
    else if ($("wiHead").children.length !== 1 + (win.DRB_WHATIF_AXES || []).length) bad("What If 표 머리글 개수가 맞지 않습니다");
    else ok(`What If 비교 — ${rows.length}개 전략 × ${win.DRB_WHATIF_AXES.length}개 축`);
  }

  /* ---------- 진행자 화면 ---------- */
  const facDom = await JSDOM.fromURL(`http://127.0.0.1:${PORT}/facilitator.html`, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    /* 부팅 중에 난 오류도 잡으려면 파싱 전에 붙여야 합니다 */
    beforeParse(w) {
      w.addEventListener("error", e => errors.push("진행자화면 오류: " + ((e.error && e.error.stack) || e.message)));
    }
  });
  facDom.window.addEventListener("error", e => errors.push("진행자화면 오류: " + e.message));
  const facErr = facDom.window.console.error;
  facDom.window.console.error = function () {
    errors.push("진행자화면 console.error: " + Array.from(arguments).join(" "));
    facErr.apply(facDom.window.console, arguments);
  };
  /* 진행자 화면이 첫 render 를 끝낼 때까지 기다립니다 */
  const fdoc = facDom.window.document;
  for (let i = 0; i < 60; i++) {
    const map = fdoc.getElementById("bMap");
    if (map && map.children.length) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!fdoc.getElementById("bDecisionRows")) bad("진행자 화면이 그려지지 않았습니다");
  else if (!fdoc.getElementById("bMap").children.length) bad("진행자 지도가 비어 있습니다");
  else if (!fdoc.getElementById("bCue").children.length) bad("'지금 진행자가 할 일' 이 비어 있습니다");
  else ok("진행자 화면(지도 " + fdoc.querySelectorAll("#bMap .region").length +
          "지역 · " + fdoc.getElementById("bNewsCount").textContent + ") 정상");
  facDom.window.close();

  /* ---------- 오류 종합 ---------- */
  console.log("\n" + "=".repeat(80));
  if (errors.length) {
    console.log("브라우저 오류 " + errors.length + "건");
    errors.slice(0, 20).forEach(e => console.log("  - " + e));
    fail += errors.length;
  } else {
    console.log("브라우저 오류 없음");
  }
  console.log(fail ? `\n문제 ${fail}건` : "\n문제 없음");
  console.log("=".repeat(80));

  win.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error("테스트 자체가 실패했습니다:", e);
  server.close();
  process.exit(1);
});
