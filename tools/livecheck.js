/* ============================================================
   livecheck.js — 배포된 주소에서 실제로 한 판 돌려봅니다

   실행 :  node tools/livecheck.js https://내주소.workers.dev
   준비 :  npm install playwright   (설치된 Edge/Chrome 을 씁니다)

   ★ 여기서만 잡히는 것들이 있습니다.
     로컬에서는 멀쩡한데 배포에서 죽는 것 — 라우팅, 세션 생성, 조 참가 —
     은 전부 이 파일이 잡았습니다. 로컬 검사만 믿지 마세요.

   ⚠ 세션 생성은 IP당 1시간에 6번으로 막혀 있습니다.
     429 가 나오면 코드가 틀린 게 아니라 그냥 한도입니다.
   ⚠ 사내 프록시가 인증서를 갈아끼우므로 ignoreHTTPSErrors 가 필요합니다.
   ============================================================ */

const BASE = (process.argv[2] || "").replace(/\/+$/, "");
if (!BASE) {
  console.error("사용법: node tools/livecheck.js https://내주소.workers.dev");
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error("playwright 가 없습니다.  npm install playwright");
  process.exit(1);
}

let passCount = 0;
let failCount = 0;
function ok(message) { passCount += 1; console.log("OK   " + message); }
function bad(message) { failCount += 1; console.error("실패 " + message); }
function expect(condition, message) { if (condition) ok(message); else bad(message); return !!condition; }
function step(title) { console.log("\n" + "─".repeat(70) + "\n" + title); }

(async function () {
  let browser = null;
  for (const channel of ["msedge", "chrome", undefined]) {
    try { browser = await chromium.launch(channel ? { channel } : {}); break; } catch (e) { /* 다음 것 */ }
  }
  if (!browser) { console.error("Edge 나 Chrome 이 필요합니다."); process.exit(1); }

  /* 사내 프록시 때문에 인증서 검사를 끕니다 (curl 은 아예 못 뚫습니다) */
  const beam = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const fac = await beam.newPage();
  const facErrors = [];
  fac.on("pageerror", (e) => facErrors.push(e.message));

  let sessionId = null;
  let joinCode = null;

  try {
    step("1. 진행자 화면이 뜨는가");
    /* 진행자 화면은 루트입니다. /facilitator 는 라우트가 아닙니다 (404). */
    const res = await fac.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    expect(res && res.status() === 200, "GET / → " + (res ? res.status() : "응답 없음"));
    await fac.waitForTimeout(1500);
    expect(await fac.locator("#btnNextStep").isVisible(), "진행자 화면이 그려짐");

    step("2. 교육 세션 만들기");
    await fac.click("#btnTools");
    await fac.waitForTimeout(300);
    await fac.click("#btnSession");
    await fac.waitForTimeout(600);
    /* 모달에서 조 수를 고르고 만듭니다 */
    const made = await fac.evaluate(async () => {
      /* ★ AI 경쟁사 항목이 있으면 안 됩니다. 경쟁은 조들끼리만 합니다. */
      if (document.getElementById("sessionRivalCount")) {
        return { error: "세션 만들기에 AI 경쟁사 수 항목이 남아 있습니다" };
      }
      const go = document.querySelector("#modalBody button.btn--primary");
      if (!go) return { error: "세션 만들기 버튼을 찾지 못했습니다" };
      go.click();
      return { clicked: true };
    });
    if (made.error) bad(made.error);
    await fac.waitForTimeout(4000);

    const creds = await fac.evaluate(() => {
      try { return JSON.parse(sessionStorage.getItem("drb.live.facilitator.v1") || "null"); }
      catch (e) { return null; }
    });
    const toast = (await fac.locator("#toast").textContent().catch(() => "")) || "";
    if (!creds) {
      bad("세션이 만들어지지 않았습니다 — 화면 메시지: " + toast.trim());
      if (/제한|429|많습니다/.test(toast)) {
        console.log("\n※ 생성 한도(IP당 1시간 6회)일 수 있습니다. 코드 문제와는 다릅니다.");
      }
    } else {
      sessionId = creds.sessionId;
      joinCode = creds.teamClaims && creds.teamClaims["1조"];
      ok("세션 생성 — 코드 " + sessionId + " · 조 " + creds.teamCount + "개");
      expect(/^\d{4}$/.test(joinCode || ""), "1조 참가 코드가 숫자 4자리 (" + joinCode + ")");
    }

    if (sessionId) {
      step("3. 참가자가 들어오는가");
      const laptop = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
      const play = await laptop.newPage();
      const playErrors = [];
      play.on("pageerror", (e) => playErrors.push(e.message));

      const playRes = await play.goto(BASE + "/play?s=" + sessionId, { waitUntil: "domcontentloaded" });
      expect(playRes && playRes.status() === 200, "GET /play?s=... → " + (playRes ? playRes.status() : "응답 없음"));
      await play.waitForTimeout(1500);

      /* ★ 여기서 진행자 화면이 뜨면 라우팅이 깨진 것입니다 (실제로 그랬습니다) */
      const isParticipant = await play.locator("#joinCode").count();
      expect(isParticipant > 0, "/play 가 참가자 화면을 줌 (진행자 화면이 아님)");

      if (isParticipant > 0) {
        await play.fill("#joinCode", joinCode);
        await play.waitForTimeout(3000);
        const joinMsg = (await play.locator("#joinMsg").textContent()) || "";
        const assigned = await play.evaluate(() => {
          /* 조 인증 정보는 탭마다 따로입니다 (sessionStorage). 한 브라우저에서 두 조를 띄우기 위해서입니다. */
          try { return JSON.parse(sessionStorage.getItem("drb.live.team.v1") || "null"); }
          catch (e) { return null; }
        });
        expect(!!assigned, "조 참가 성공" + (assigned ? " — " + assigned.teamName : " (메시지: " + joinMsg.trim() + ")"));

        /* 코드가 맞으면 과거로 돌아가는 연출이 지나간 뒤 바로 게임으로 들어갑니다.
           조 고르는 화면을 거치지 않습니다 — 조는 코드가 정해줍니다. */
        await play.waitForFunction(
          () => !document.getElementById("app").classList.contains("hidden"),
          null, { timeout: 20000 }
        ).catch(() => {});
        await play.waitForTimeout(1500);
        const screen = await play.evaluate(() => document.getElementById("app").dataset.screen);
        expect(screen === "invest", "참가자 첫 화면이 자원 배분 (" + screen + ")");

        /* 경쟁사는 없습니다 — 남아 있으면 예전 코드가 살아 있는 것입니다 */
        const noRivals = await play.evaluate(() => !window.DRBState.rivals);
        expect(noRivals, "조 노트북에 경쟁사가 없음 (경쟁은 조들끼리만)");

        step("4. 배분 + 정책 확정이 진행자 화면에 도착하는가");
        await play.evaluate(() => {
          for (let i = 0; i < 12; i += 1) {
            if (parseInt(document.getElementById("inRemain").textContent, 10) <= 0) break;
            const plus = document.querySelector("#inList .alloc .btn--plus:not([disabled])");
            if (!plus) break;
            plus.click();
          }
          document.querySelector("#poList .policy").click();
        });
        await play.waitForTimeout(400);
        const locked = await play.locator("#btnInvestGo").isDisabled();
        expect(!locked, "정책을 고르면 확정이 열림");
        await play.click("#btnInvestGo");
        await play.waitForTimeout(4000);

        await fac.click("#btnToolsClose").catch(() => {});
        await fac.waitForTimeout(4000);
        const seen = await fac.evaluate(() => {
          const rows = [...document.querySelectorAll("#bDecisionRows .dcard")];
          return rows.map((r) => r.textContent.replace(/\s+/g, " ").trim().slice(0, 40));
        });
        expect(seen.length > 0, "진행자 화면에 조 카드가 보임 (" + seen.length + "개)");

        step("5. 회고 단계가 조 노트북까지 가는가");
        await fac.evaluate(() => {
          /* 시상까지 건너뛰고 회고 챕터로 */
          document.querySelector('[data-stage="reflect"]').click();
        });
        await fac.waitForTimeout(6000);
        const reflectScreen = await play.evaluate(() => document.getElementById("app").dataset.screen);
        expect(reflectScreen === "reflect",
          "진행자가 회고를 열자 노트북이 회고 화면으로 (" + reflectScreen + ")");

        if (reflectScreen === "reflect") {
          await play.evaluate(() => {
            const box = document.querySelector("#rfList .rfitem__box");
            if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); }
            const c = document.getElementById("rfComment");
            c.value = "라이브 점검 코멘트";
            c.dispatchEvent(new Event("input", { bubbles: true }));
          });
          const single = await play.evaluate(() =>
            [...document.querySelectorAll("#rfList .rfitem__box")].filter((b) => b.checked).length);
          expect(single === 1, "회고는 하나만 골라짐 (" + single + "개)");
          await play.click("#btnReflectSend");

          /* "1 / 4조 제출" 의 앞 숫자만 봅니다.
             뒤의 조 수를 세면 0 / 4 도 통과해버립니다 — 실제로 그랬습니다. */
          const submitted = () => fac.evaluate(() => {
            const text = document.getElementById("bReflectCount").textContent;
            const m = /^\s*(\d+)\s*\//.exec(text);
            return { text: text.trim(), count: m ? Number(m[1]) : -1 };
          });
          let arrived = await submitted();
          for (let wait = 0; wait < 12 && arrived.count < 1; wait += 1) {
            await fac.waitForTimeout(2000);
            arrived = await submitted();
          }
          expect(arrived.count >= 1, "제출한 회고가 진행자 화면에 도착 (" + arrived.text + ")");

          const shown = await fac.evaluate(() => {
            const card = document.querySelector(".rfcard:not(.rfcard--wait)");
            return card ? card.textContent.replace(/\s+/g, " ").trim() : "";
          });
          expect(shown.indexOf("라이브 점검 코멘트") >= 0,
            "회고 코멘트가 빔에 그대로 보임 — " + (shown.slice(0, 60) || "카드 없음"));
          expect(shown.indexOf("이 조의 선택") >= 0,
            "고른 국면의 상황과 그 조의 선택이 같이 붙음");

          step("6. 간담회 자료 — 서버 없이 이 PC 에서 열리는가");
          const rvRes = await fac.goto(BASE + "/review", { waitUntil: "domcontentloaded" });
          expect(rvRes && rvRes.status() === 200, "GET /review → " + (rvRes ? rvRes.status() : "응답 없음"));
          await fac.waitForTimeout(1200);
          const review = await fac.evaluate(() => ({
            isReview: !!document.querySelector(".rv-body"),
            cards: document.querySelectorAll(".rvcard:not(.rvcard--empty)").length,
            text: document.body.textContent.replace(/\s+/g, " "),
          }));
          expect(review.isReview, "/review 가 간담회 자료 화면을 줌");
          expect(review.cards >= 1, "회고를 남긴 조가 자료에 실림 (" + review.cards + "개)");
          expect(review.text.indexOf("라이브 점검 코멘트") >= 0, "간담회 자료에 그 조의 문장이 있음");
          await fac.goBack().catch(() => {});
          await fac.waitForTimeout(800);
        }

        expect(playErrors.length === 0, "참가자 화면 오류 없음" + (playErrors.length ? " — " + playErrors[0] : ""));
      }
      await laptop.close();
    }

    expect(facErrors.length === 0, "진행자 화면 오류 없음" + (facErrors.length ? " — " + facErrors[0] : ""));
  } catch (error) {
    bad("점검 도중 멈췄습니다: " + (error.message || error));
  } finally {
    /* 만든 세션은 반드시 지웁니다 — 안 지우면 24시간 떠 있습니다 */
    if (sessionId) {
      step("7. 뒷정리");
      const gone = await fac.evaluate(async () => {
        try {
          const raw = sessionStorage.getItem("drb.live.facilitator.v1");
          if (!raw) return "자격정보 없음";
          const c = JSON.parse(raw);
          const r = await fetch("/api/session/" + c.sessionId, {
            method: "DELETE",
            headers: { authorization: "Bearer " + c.facilitatorSecret },
          });
          return r.status;
        } catch (e) { return "실패 " + e.message; }
      });
      expect(gone === 200 || gone === 204, "세션 " + sessionId + " 삭제 (" + gone + ")");
    }
    await browser.close();
  }

  console.log("\n" + "=".repeat(70));
  console.log("livecheck: " + passCount + "건 통과 / " + failCount + "건 실패");
  console.log("=".repeat(70));
  process.exitCode = failCount ? 1 : 0;
})();
