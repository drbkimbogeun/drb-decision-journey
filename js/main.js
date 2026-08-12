/* ============================================================
   main.js — 게임 흐름 제어

   화면 순서
     라운드 시작 → 상황 확인 → 자원 배분 → 정책 결정 → 결과
     → (라운드 끝이면) ACTUAL DRB → 다음 라운드 … → 최종 결과
   ============================================================ */

(function () {
  "use strict";

  var CFG = window.DRB_CONFIG;
  var S   = window.DRBState;
  var UI  = window.DRBUI;
  var el  = UI.el;

  /* 이번 국면에서 팀이 만지고 있는 값 (아직 확정 전) */
  var alloc = {};
  var choices = {};          // 해외 진출처럼 '어디에/어떻게' 를 함께 정하는 항목
  var pickedPolicy = null;
  var lastResult = null;
  var timerId = null;
  var stopLapse = null;

  /* ============================================================
     시작 화면
     ============================================================ */
  var setupTeamCount = CFG.teamCountDefault;
  var setupTeamName  = CFG.teamNames[0];

  function initIntro() {
    el("introTheme").textContent = CFG.eduTheme;
    document.title = CFG.gameTitle;

    /* 조 수 선택 */
    var cp = el("teamCountPicker");
    cp.innerHTML = "";
    CFG.teamCountOptions.forEach(function (n) {
      var b = document.createElement("button");
      b.className = "team-picker__btn" + (n === setupTeamCount ? " is-selected" : "");
      b.textContent = n + "조";
      b.onclick = function () {
        setupTeamCount = n;
        if (CFG.teamNames.indexOf(setupTeamName) >= n) setupTeamName = CFG.teamNames[0];
        initIntro();
      };
      cp.appendChild(b);
    });

    /* 우리 조 선택 */
    var tp = el("teamPicker");
    tp.innerHTML = "";
    CFG.teamNames.slice(0, setupTeamCount).forEach(function (name) {
      var b = document.createElement("button");
      b.className = "team-picker__btn" + (name === setupTeamName ? " is-selected" : "");
      b.textContent = name;
      b.onclick = function () { setupTeamName = name; initIntro(); };
      tp.appendChild(b);
    });

    /* 이어서 하기 */
    if (S.hasSave()) {
      el("btnContinue").classList.remove("hidden");
      el("introHint").textContent = "이전에 하던 게임이 저장되어 있습니다. [게임 시작]을 누르면 지워집니다.";
    } else {
      el("btnContinue").classList.add("hidden");
      el("introHint").textContent = "";
    }
  }

  function startNewGame() {
    if (S.hasSave() && !confirm("저장된 게임이 지워집니다. 새로 시작할까요?")) return;
    S.clearAll();
    S.newGame(setupTeamCount);
    S.switchTeam(setupTeamName);
    enterGame();
  }

  function continueGame() {
    if (!S.load()) {
      UI.toast("저장된 게임을 찾지 못했습니다.");
      return;
    }
    enterGame();
  }

  function enterGame() {
    el("intro").classList.add("hidden");
    el("app").classList.remove("hidden");
    render();
  }

  /* ============================================================
     화면 전환
     ============================================================ */
  var SCREENS = ["roundOpen", "situation", "invest", "policy", "timelapse", "result",
                 "actual", "ending", "whatif", "final"];

  function showScreen(name) {
    SCREENS.forEach(function (s) {
      var node = el("sc-" + s);
      if (node) node.classList.toggle("is-active", s === name);
    });
    el("stage").classList.toggle("stage--full",
      name === "final" || name === "whatif" || name === "ending" || name === "timelapse");
    el("stage").querySelector(".stage__main").scrollTop = 0;
  }

  function render() {
    UI.renderTopbar();
    UI.renderSide();

    var phase = S.phase();
    stopTimer();

    switch (phase) {
      case "roundOpen":
        UI.renderRoundOpen();
        showScreen("roundOpen");
        break;

      case "situation":
        UI.renderSituation();
        showScreen("situation");
        break;

      case "invest":
        UI.renderInvest(alloc, changeAlloc, choices, pickChoice);
        showScreen("invest");
        startTimer();
        break;

      case "policy":
        UI.renderPolicy(pickedPolicy, pickPolicy);
        el("btnPolicyGo").disabled = !pickedPolicy;
        showScreen("policy");
        break;

      case "result":
        if (!lastResult) {
          /* 새로고침 등으로 결과가 사라졌으면 기록에서 복원 */
          var h = S.lastHistory();
          if (h) lastResult = { report: h.report };
        }
        if (lastResult) UI.renderResult(lastResult);
        showScreen("result");
        break;

      case "timelapse":
        showScreen("timelapse");
        runTimelapse();
        break;

      case "actual":
        UI.renderActual();
        showScreen("actual");
        break;

      case "ending":
        endingStep = 0;
        UI.showEndingStep(0);
        showScreen("ending");
        break;

      case "whatif":
        UI.renderWhatIf();
        showScreen("whatif");
        break;

      case "final":
        UI.renderFinal(pickGap);
        showScreen("final");
        break;

      default:
        S.setPhase("roundOpen");
        render();
    }
  }

  /* ============================================================
     타이머 — 토론 시간 관리 (진행자가 원하면 끌 수 있음)
     ============================================================ */
  function startTimer() {
    if (!CFG.timer.enabled) return;
    /* 시대가 뒤로 갈수록 토론 시간이 짧아집니다 (5분 → 2분 30초) */
    var era = S.era();
    var remain = (era.pace && era.pace.discussSeconds) || CFG.timer.discussSeconds;
    var box = el("tbTimer");
    box.classList.remove("hidden");

    function tick() {
      var m = Math.floor(Math.abs(remain) / 60);
      var s = Math.abs(remain) % 60;
      el("tbTimerText").textContent = (remain < 0 ? "-" : "") + m + ":" + (s < 10 ? "0" : "") + s;
      box.classList.toggle("is-urgent", remain <= CFG.timer.warnSeconds);
      remain--;
    }
    tick();
    timerId = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    el("tbTimer").classList.add("hidden");
  }

  /* ============================================================
     투자 배분
     ============================================================ */
  function changeAlloc(id, delta) {
    var budget = S.budget();
    var cur = alloc[id] || 0;
    var next = cur + delta;

    if (next < 0) {
      UI.toast("더 줄일 수 없습니다.");
      return;
    }
    if (delta > 0 && UI.allocSum(alloc) + delta > budget) {
      UI.toast("예산이 부족합니다. 다른 곳을 먼저 줄이세요.");
      return;
    }

    alloc[id] = next;
    if (next === 0) delete choices[id];
    UI.renderInvest(alloc, changeAlloc, choices, pickChoice);
  }

  function resetAlloc() {
    alloc = {};
    choices = {};
    UI.renderInvest(alloc, changeAlloc, choices, pickChoice);
  }

  /* 어디에 / 어떤 방식으로 */
  function pickChoice(itemId, dim, value) {
    if (!choices[itemId]) choices[itemId] = {};
    choices[itemId][dim] = value;
    UI.renderInvest(alloc, changeAlloc, choices, pickChoice);
  }

  /* ============================================================
     정책
     ============================================================ */
  function pickPolicy(id) {
    pickedPolicy = id;
    UI.renderPolicy(pickedPolicy, pickPolicy);
    el("btnPolicyGo").disabled = false;
  }

  /* ============================================================
     확정 → 계산
     ============================================================ */
  function commit() {
    if (!pickedPolicy) {
      UI.toast("정책을 먼저 고르세요.");
      return;
    }

    /* 남긴 예산은 자동으로 현금 보유로 넘긴다 */
    var budget = S.budget();
    var used = UI.allocSum(alloc);
    var leftover = budget - used;
    if (leftover > 0) {
      var cashItem = S.investments().filter(function (i) { return i.keepCash; })[0];
      if (cashItem) alloc[cashItem.id] = (alloc[cashItem.id] || 0) + leftover;
    }

    lastResult = S.commitSubround(alloc, pickedPolicy, choices);

    alloc = {};
    choices = {};
    pickedPolicy = null;

    /* 숫자 화면으로 바로 가지 않고, 시간이 흐르는 것을 먼저 보여줍니다 */
    S.setPhase("timelapse");
    render();
  }

  /* ============================================================
     시간 진행
     ============================================================ */
  function runTimelapse() {
    var hist = S.lastHistory();
    if (!hist) { S.setPhase("result"); render(); return; }
    stopLapse = UI.renderTimelapse(hist, function () {
      S.setPhase("result");
      render();
    });
  }

  function skipLapse() {
    if (stopLapse) { stopLapse(); stopLapse = null; }
    S.setPhase("result");
    render();
  }

  /* ============================================================
     결과 → 다음
     ============================================================ */
  function afterResult() {
    if (S.isLastSubround()) {
      S.setPhase("actual");
    } else {
      S.advance();          // 다음 소라운드
    }
    lastResult = null;
    render();
  }

  function afterActual() {
    /* 마지막 시대(2026)가 끝났다면 엔딩 연출로 */
    if (S.isLastRound()) {
      S.setPhase("ending");
    } else {
      S.advance();          // 다음 시대
    }
    lastResult = null;
    render();
  }

  /* ============================================================
     2026 엔딩 — 여기서 '시간 진행'이 사라집니다
     ============================================================ */
  var endingStep = 0;

  function nextEnding() {
    endingStep++;
    if (endingStep > 3) {
      S.setPhase("whatif");
      render();
      return;
    }
    UI.showEndingStep(endingStep);
  }

  function afterWhatIf() {
    S.advance();            // 최종 화면으로
    render();
  }

  /* ============================================================
     최종 화면
     ============================================================ */
  function pickGap(roundId) {
    S.team().gapPick = roundId;
    S.save();
    UI.renderFinal(pickGap);
  }

  function saveReason() {
    var reason = el("fiReason").value.trim();
    if (!reason) {
      UI.toast("그렇게 결정한 이유를 적어주세요.");
      el("fiReason").focus();
      return;
    }
    var t = S.team();
    t.reason = reason;
    if (!t.gapPick) t.gapPick = window.DRB_ROUNDS[window.DRB_ROUNDS.length - 1].id;
    S.save();
    UI.renderDecisionCard(t);
    UI.toast("결정 카드를 저장했습니다.");
  }

  function copyCode() {
    var code = S.exportTeamCode();
    var ta = document.createElement("textarea");
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      UI.toast("결과 코드를 복사했습니다. 진행자 화면에 붙여넣으세요.");
    } catch (e) {
      UI.openModal("결과 코드", "<p class='hint'>아래 내용을 모두 복사해서 진행자에게 전달하세요.</p>" +
        "<textarea class='textarea' style='min-height:160px'>" + UI.escapeHtml(code) + "</textarea>");
    }
    document.body.removeChild(ta);
  }

  /* ============================================================
     상단바 동작
     ============================================================ */
  function switchTeam(name) {
    S.switchTeam(name);
    alloc = {};
    pickedPolicy = null;
    lastResult = null;
    render();
    UI.toast(name + " 화면으로 전환했습니다.");
  }

  function toggleAdmin() {
    var on = S.toggleAdmin();
    UI.toast(on ? "관리자 모드 — 계산 근거가 표시됩니다." : "관리자 모드를 껐습니다.");
    render();
  }

  function resetGame() {
    if (!confirm("정말 처음부터 다시 시작할까요? 모든 조의 기록이 지워집니다.")) return;
    S.clearAll();
    location.reload();
  }

  /* ============================================================
     연결
     ============================================================ */
  function bind() {
    el("btnStart").onclick    = startNewGame;
    el("btnContinue").onclick = continueGame;

    el("btnRoundGo").onclick  = function () { S.setPhase("situation"); render(); };
    el("btnSitGo").onclick    = function () { S.setPhase("invest"); render(); };
    el("btnInvestBack").onclick = function () { S.setPhase("situation"); render(); };
    el("btnInvestGo").onclick = function () {
      if (UI.allocSum(alloc) === 0 &&
          !confirm("아무 곳에도 투자하지 않았습니다. 예산 전액을 현금으로 남길까요?")) return;
      S.setPhase("policy"); render();
    };
    el("btnAllocReset").onclick = resetAlloc;
    el("btnPolicyBack").onclick = function () { S.setPhase("invest"); render(); };
    el("btnPolicyGo").onclick = commit;
    el("btnResultGo").onclick = afterResult;
    el("btnActualGo").onclick = afterActual;
    el("btnWhatifGo").onclick = afterWhatIf;
    el("btnSkipLapse").onclick = skipLapse;
    ["btnEnd1", "btnEnd2", "btnEnd3", "btnEnd4"].forEach(function (id) {
      el(id).onclick = nextEnding;
    });

    el("btnSaveReason").onclick = saveReason;
    el("btnCopyCode").onclick = copyCode;

    el("tbTeam").onchange = function () { switchTeam(this.value); };
    el("btnAdmin").onclick = toggleAdmin;
    el("btnReset").onclick = resetGame;
    el("btnDetail").onclick = UI.showDetail;
    el("modalClose").onclick = UI.closeModal;
    el("modal").onclick = function (e) { if (e.target === this) UI.closeModal(); };

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") UI.closeModal();
    });
  }

  /* ============================================================
     시작
     ============================================================ */
  function boot() {
    /* 데이터 파일이 하나라도 빠지면 바로 알려준다 (조용히 실패하지 않기) */
    var missing = [];
    [["DRB_CONFIG", "data/config.js"], ["DRB_ERAS", "data/eras.js"],
     ["DRB_INVESTMENTS", "data/investments.js"], ["DRB_POLICIES", "data/policies.js"],
     ["DRB_EVENTS", "data/events.js"], ["DRB_ROUNDS", "data/rounds.js"],
     ["DRB_ACTUAL", "data/actual_drb.js"], ["DRB_COMPETITORS", "data/competitors.js"],
     ["DRB_WHATIF", "data/whatif.js"], ["DRB_GLOBAL", "data/global.js"],
     ["DRB_RIVALS", "data/rivals.js"]].forEach(function (p) {
      if (!window[p[0]]) missing.push(p[1]);
    });
    if (missing.length) {
      document.body.innerHTML =
        "<div style='padding:40px;font-family:sans-serif;color:#e8edf3;background:#0d1117;height:100vh'>" +
        "<h1>데이터 파일을 읽지 못했습니다</h1><p>다음 파일을 확인해주세요:</p><ul><li>" +
        missing.join("</li><li>") + "</li></ul></div>";
      return;
    }

    bind();
    initIntro();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
