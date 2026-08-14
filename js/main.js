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
  var waitingBriefing = false;
  var lapseTurn = -1;
  var lastControlStage = null;   // 돌발상황 알람을 한 번만 울리기 위한 표시
  var liveParams = new URLSearchParams(location.search);
  var liveUrl = liveParams.has("session");
  var liveJoinPending = false;
  var liveJoinError = "";
  var assignedLiveTeam = null;
  var assignedLiveTeamCount = null;
  var assignedRivalCount = null;   // 경쟁사 수는 세션이 정합니다 (조마다 같아야 함)

  /* ============================================================
     시작 화면
     ============================================================ */
  function liveControl() {
    return window.DRBLive && window.DRBLive.currentControl ? window.DRBLive.currentControl() : null;
  }

  /* 다음 국면을 여는 것은 진행자입니다. 이것 하나가 노트북의 유일한 잠금장치입니다.
     (돌발상황·결과·DRB 기록은 이제 빔에서만 보므로 따로 잠글 것이 없습니다) */
  function liveNextBriefingOpen() {
    var control = liveControl();
    if (!control) return true;
    var target = S.turnIndex() + 1;
    return control.currentTurn > target ||
      (control.currentTurn === target && control.stage !== 'lobby');
  }

  function publishLiveState() {
    if (!window.DRBLive || !window.DRBLive.publishHook || !S.g()) return Promise.resolve();
    if (!liveUrl) return Promise.resolve();
    var credentials = window.DRBLive.credentials ? window.DRBLive.credentials() : null;
    var teamName = credentials && credentials.role === "team" ? credentials.teamName : assignedLiveTeam;
    if (!teamName || teamName !== assignedLiveTeam || !S.g().teams || !S.g().teams[teamName]) return Promise.resolve();
    return window.DRBLive.publishHook(S.g(), teamName || S.g().activeTeam).catch(function () {
      UI.toast("진행자 화면 동기화를 재시도합니다. 게임 기록은 이 기기에 안전하게 저장됐습니다.");
    });
  }

  var setupTeamCount = CFG.teamCountDefault;
  var setupTeamName  = CFG.teamNames[0];

  function setLiveJoinUi() {
    if (!liveUrl) return;
    el("btnStart").disabled = liveJoinPending || (!assignedLiveTeam && !liveJoinError);
    el("btnContinue").disabled = liveJoinPending || !assignedLiveTeam;
    el("btnStart").innerHTML = liveJoinPending ? "세션 연결 중…"
      : (liveJoinError ? "연결 다시 시도" : "준비 완료 <span class='btn__arrow'>→</span>");
    el("teamCountPicker").setAttribute("aria-disabled", "true");
    el("teamPicker").setAttribute("aria-disabled", "true");
  }

  function initIntro() {
    document.title = CFG.gameTitle;
    el("introTitle").textContent = "80년의 여정";

    var lockedCount = liveUrl && assignedLiveTeamCount ? assignedLiveTeamCount : setupTeamCount;
    var lockedTeam = liveUrl && assignedLiveTeam ? assignedLiveTeam : setupTeamName;

    /* ---------- 표지의 숫자 ---------- */
    el("coverTurns").textContent = S.totalTurns ? S.totalTurns() : 6;
    el("coverTeams").textContent = lockedCount;
    el("coverTime").textContent = (CFG.totalMinutes || 60) + "분";
    el("setupMeta").textContent = "노트북 1대 · " + (CFG.roles || []).length + "명";

    /* ---------- 조 수 ---------- */
    var cp = el("teamCountPicker");
    cp.innerHTML = "";
    (liveUrl ? [lockedCount] : CFG.teamCountOptions).forEach(function (n) {
      var b = document.createElement("button");
      b.className = "team-picker__btn" + (n === lockedCount ? " is-selected" : "");
      b.textContent = n + "조";
      b.disabled = liveUrl;
      b.onclick = function () {
        setupTeamCount = n;
        if (CFG.teamNames.indexOf(setupTeamName) >= n) setupTeamName = CFG.teamNames[0];
        initIntro();
      };
      cp.appendChild(b);
    });

    /* ---------- 우리 조 ---------- */
    var tp = el("teamPicker");
    tp.innerHTML = "";
    var names = liveUrl
      ? [lockedTeam || liveParams.get("team") || "배정 확인 중"]
      : CFG.teamNames.slice(0, setupTeamCount);
    names.forEach(function (name, i) {
      var picked = name === lockedTeam;
      var b = document.createElement("button");
      b.className = "teampick__btn" + (picked ? " is-selected" : "");
      b.disabled = liveUrl;
      b.innerHTML =
        "<span class='teampick__no num'>" + (i + 1) + "</span>" +
        "<span class='teampick__name'>" + UI.escapeHtml(name) + "</span>" +
        "<span class='teampick__state'>" +
          (picked ? (CFG.roles || []).length + "명 참여" : "대기 중") +
        "</span>";
      b.onclick = function () { setupTeamName = name; initIntro(); };
      tp.appendChild(b);
    });

    /* ---------- 역할 (표시만 합니다. 배정 기능은 없습니다) ---------- */
    var rc = el("roleChips");
    rc.innerHTML = (CFG.roles || []).map(function (role) {
      return "<span class='rolechip'>" + UI.escapeHtml(role.name.replace(" 관점", "")) + "</span>";
    }).join("");

    if (liveUrl) {
      el("btnContinue").classList.add("hidden");
      el("introHint").textContent = liveJoinError || (assignedLiveTeam
        ? assignedLiveTeam + " 으로 연결되었습니다"
        : "진행자 세션에 연결 중입니다");
    } else if (S.hasSave()) {
      el("btnContinue").classList.remove("hidden");
      el("introHint").textContent = "이전에 하던 게임이 저장되어 있습니다 · 진행자 화면과 연결되지 않았습니다";
    } else {
      el("btnContinue").classList.add("hidden");
      /* 세션 링크로 들어온 것이 아니면 진행자 화면에 아무것도 전송되지 않습니다.
         조용히 실패하면 고장으로 보이므로 여기서 분명히 밝힙니다. */
      el("introHint").textContent =
        "진행자 화면에 뜬 우리 조 숫자를 넣으세요";
    }
    setLiveJoinUi();
  }


  /* ============================================================
     첫 화면 — 영상과 참가 코드

     진행자는 링크 하나와 조별 코드표만 알려줍니다.
     각 조가 자기 코드를 넣으면 그 조로 들어갑니다.
     ============================================================ */

  /* 영상은 있으면 깔고, 없으면 아무 일도 없습니다.
     ⚠ 보안정책이 .mp4 쓰기를 막아서 파일이 .m4v 일 수 있습니다.
       확장자를 믿지 않고 내용을 읽어 형식을 알려줍니다. */
  function initCoverVideo() {
    var src = (CFG.audio && CFG.audio.introVideo) || "";
    var v = el("coverVideo");
    if (!src || !v) return;

    function ready() { v.classList.add("is-playing"); }
    v.addEventListener("playing", ready);
    v.addEventListener("error", function () {
      if (v.dataset.retried || !window.fetch) return;
      v.dataset.retried = "1";
      fetch(src).then(function (r) {
        if (!r.ok) throw new Error("no file");
        return r.arrayBuffer();
      }).then(function (buf) {
        var b = new Uint8Array(buf.slice(0, 12));
        var type = (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)
          ? "video/mp4"
          : (b[0] === 0x1A && b[1] === 0x45) ? "video/webm" : "video/mp4";
        v.src = URL.createObjectURL(new Blob([buf], { type: type }));
        var play = v.play(); if (play && play.catch) play.catch(function () {});
      }).catch(function () { /* 영상이 없어도 화면은 그대로입니다 */ });
    });

    v.src = src;
    var p2 = v.play();
    if (p2 && p2.catch) p2.catch(function () { /* 자동재생이 막히면 조용히 넘어갑니다 */ });
  }

  function setJoinMessage(text, kind) {
    var box = el("codeForm");
    el("joinMsg").textContent = text || "";
    box.classList.toggle("is-wrong", kind === "wrong");
    box.classList.toggle("is-ok", kind === "ok");
  }

  /* 코드가 맞으면 과거로 돌아가는 연출이 한 번 지나갑니다 */
  function warpToPast(done) {
    var years = [];
    (window.DRB_ROUNDS || []).forEach(function (r) {
      r.subrounds.forEach(function (sr) { years.push(sr.year); });
    });
    years = years.slice().reverse();          // 2026 에서 1947 로 거슬러 갑니다
    if (!years.length) { done(); return; }

    var warp = el("warp");
    el("warpYears").innerHTML = years.map(function (y) {
      return "<span class='warp__year' data-year='" + y + "'>" + y + "</span>";
    }).join("");
    el("warpCaption").textContent = years[years.length - 1] + "년으로 돌아갑니다";
    warp.classList.remove("hidden");

    var nodes = el("warpYears").children;
    var i = 0;
    var timer = setInterval(function () {
      if (i >= nodes.length) {
        clearInterval(timer);
        setTimeout(function () {
          warp.classList.add("hidden");
          done();
        }, 700);
        return;
      }
      if (i > 0) nodes[i - 1].classList.remove("is-now");
      nodes[i].classList.add("is-now", "is-passed");
      i++;
    }, 380);
  }

  /* 참가 코드를 넣고 들어갑니다 */
  function submitJoinCode(event) {
    if (event) event.preventDefault();
    var code = String(el("joinCode").value || "").replace(/\D/g, "");
    if (code.length !== 4) {
      setJoinMessage("진행자가 알려준 숫자 4자리를 넣어주세요.", "wrong");
      return;
    }

    if (!window.DRBLive || !window.DRBLive.joinWithCode) {
      setJoinMessage("라이브 모듈을 불러오지 못했습니다. 연습 모드로 진행해주세요.", "wrong");
      return;
    }

    el("btnJoin").disabled = true;
    setJoinMessage("확인하는 중…", "");

    window.DRBLive.joinWithCode(code).then(function (joined) {
      assignedLiveTeam = joined.teamName;
      assignedLiveTeamCount = Number(joined.teamCount || setupTeamCount);
      assignedRivalCount = Number(joined.rivalCount) || null;
      setupTeamCount = assignedLiveTeamCount;
      setupTeamName = assignedLiveTeam;
      liveUrl = true;                       /* 지금부터 진행자 화면에 전송합니다 */
      setJoinMessage(joined.teamName + " 로 들어갑니다", "ok");

      warpToPast(function () {
        S.clearAll();
        S.newGame(assignedLiveTeamCount, assignedRivalCount);
        S.switchTeam(assignedLiveTeam);
        enterGame();
      });
    }).catch(function (error) {
      el("btnJoin").disabled = false;
      setJoinMessage(error && error.message ? error.message : "코드를 확인하지 못했습니다.", "wrong");
      el("joinCode").select();
    });
  }

  /* 코드 없이 혼자 해보는 연습 모드 */
  function startPractice() {
    el("intro").setAttribute("data-step", "1");
  }

  function forceAssignedTeam() {
    if (!liveUrl) return true;
    if (!assignedLiveTeam || !S.g() || !S.g().teams || !S.g().teams[assignedLiveTeam]) return false;
    S.switchTeam(assignedLiveTeam);
    return true;
  }

  function startNewGame() {
    if (liveUrl && !assignedLiveTeam) {
      if (!liveJoinPending) connectLiveSession();
      return;
    }
    if (!liveUrl && S.hasSave() && !confirm("저장된 게임이 초기화됩니다. 새로 시작할까요?")) return;
    S.clearAll();
    S.newGame(liveUrl ? assignedLiveTeamCount : setupTeamCount, assignedRivalCount);
    S.switchTeam(liveUrl ? assignedLiveTeam : setupTeamName);
    enterGame();
  }

  function continueGame() {
    if (liveUrl) {
      UI.toast("라이브 세션에서는 이전 기록을 이어갈 수 없습니다. 새 게임으로 시작해주세요.");
      return;
    }
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

  /* 소리는 있으면 내고 없으면 조용히 넘어갑니다 */
  function sfx(name) { if (window.DRBAudio) window.DRBAudio.play(name); }

  /* 배경음악은 지금 무엇을 하는 중인가를 따라갑니다 — 평상시 / 시대흐름 / 엔딩.
     어느 화면이 어느 곡인지는 config 의 musicByScreen 에 있습니다.
     돌발상황은 이제 빔에서 뜨므로, 음악을 낮추는 것은 진행자 단계를 보고 합니다. */
  function musicForScreen(name) {
    if (!window.DRBAudio) return;
    window.DRBAudio.scene(name);
  }

  /* ============================================================
     화면 전환
     ============================================================ */
  /* 노트북에 남은 화면. 국면이 도는 동안은 invest 와 timelapse(대기) 둘뿐입니다. */
  var SCREENS = ["invest", "timelapse", "ending", "whatif", "final", "reflect"];

  function showScreen(name) {
    el("app").setAttribute("data-screen", name);
    /* 시간 진행에서 뜬 속보가 다음 화면을 덮지 않게 합니다 */
    if (name !== "timelapse") UI.clearNewsFlash();
    musicForScreen(name);
    SCREENS.forEach(function (s) {
      var node = el("sc-" + s);
      if (node) node.classList.toggle("is-active", s === name);
    });
    el("stage").classList.toggle("stage--full",
      name === "final" || name === "whatif" || name === "ending" || name === "timelapse");
    el("stage").querySelector(".stage__main").scrollTop = 0;
    var current = el("sc-" + name);
    var heading = current && current.querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      window.setTimeout(function () { heading.focus({ preventScroll: true }); }, 0);
    }
  }

  function render() {
    UI.renderTopbar();
    UI.renderSide();
    publishLiveState();      /* 국면이 바뀔 때마다 진행자 화면에 현재 상태를 올립니다 */

    /* 회고는 진행 순서 밖에 있습니다 — 시상이 끝난 뒤 진행자가 열어야 뜹니다.
       기다리는 중이든 어느 화면이든 이 화면으로 덮습니다. */
    if (reflectOpen()) {
      stopTimer();
      loadReflectDraft();
      UI.renderReflect(reflectDraft, toggleReflectPick);
      showScreen("reflect");
      return;
    }

    if (waitingBriefing && !liveNextBriefingOpen()) {
      showScreen('timelapse');
      UI.renderLiveWait('briefing');
      return;
    }

    var phase = S.phase();
    stopTimer();

    switch (phase) {
      case "invest":
        UI.renderInvest(alloc, changeAlloc, choices, pickChoice);
        UI.renderPolicy(pickedPolicy, pickPolicy);
        el("btnInvestGo").disabled = !pickedPolicy;
        showScreen("invest");
        startTimer();
        break;

      /* 확정한 뒤부터 다음 국면이 열릴 때까지 여기 머뭅니다.
         그 사이 돌발상황·결과·DRB 기록은 진행자 빔에서 봅니다. */
      case "timelapse":
        showScreen("timelapse");
        runTimelapse();
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
        S.setPhase("invest");
        render();
    }
  }

  /* ============================================================
     타이머 — 토론 시간 관리 (진행자가 원하면 끌 수 있음)
     ============================================================ */
  /* 토론 시간은 브리핑 → 자원 배분 → 정책을 하나로 이어서 셉니다.
     화면을 넘긴다고 시간이 되돌아가면 안 됩니다. */
  var timerRemain = null;
  var timerTurn = -1;

  function startTimer() {
    if (!CFG.timer.enabled) return;
    /* 시대가 뒤로 갈수록 토론 시간이 짧아집니다 (5분 → 3분) */
    var era = S.era();
    var turn = S.turnIndex();
    if (timerTurn !== turn || timerRemain === null) {
      timerTurn = turn;
      timerRemain = (era.pace && era.pace.discussSeconds) || CFG.timer.discussSeconds;
    }

    var box = el("tbTimer");
    box.classList.remove("hidden");

    function tick() {
      var m = Math.floor(Math.abs(timerRemain) / 60);
      var s = Math.abs(timerRemain) % 60;
      var text = (timerRemain < 0 ? "-" : "") + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
      el("tbTimerText").textContent = text;
      box.classList.toggle("is-urgent", timerRemain <= CFG.timer.warnSeconds);
      timerRemain--;
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
    sfx(delta > 0 ? "tokenUp" : "tokenDown");
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
    sfx("pick");
    UI.renderPolicy(pickedPolicy, pickPolicy);
    el("btnInvestGo").disabled = false;
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
    sfx("commit");

    alloc = {};
    choices = {};
    pickedPolicy = null;

    /* 숫자 화면으로 바로 가지 않고, 시간이 흐르는 것을 먼저 보여줍니다 */
    S.setPhase("timelapse");
    publishLiveState();
    render();
  }

  /* ============================================================
     시간 진행
     ============================================================ */
  function runTimelapse() {
    var hist = S.lastHistory();
    if (!hist) { afterLapse(); return; }
    var turn = S.turnIndex();
    if (lapseTurn === turn && stopLapse) return;
    if (stopLapse) { stopLapse(); stopLapse = null; }
    lapseTurn = turn;
    el("btnSkipLapse").classList.remove("hidden");
    stopLapse = UI.renderTimelapse(hist, function () {
      if (lapseTurn !== turn || S.phase() !== "timelapse") return;
      stopLapse = null;
      afterLapse();
    });
  }

  function skipLapse() {
    if (stopLapse) { stopLapse(); stopLapse = null; }
    lapseTurn = -1;
    afterLapse();
  }

  /* 시간이 다 흘렀습니다. 다음 국면을 여는 것은 진행자입니다.
     그 사이 돌발상황 · 결과 · DRB 기록은 빔에서 봅니다 — 노트북은 기다립니다. */
  function afterLapse() {
    if (S.isLastRound() && S.isLastSubround()) {
      waitingBriefing = false;
      lastResult = null;
      S.setPhase("ending");
      render();
      return;
    }
    if (liveControl() && !liveNextBriefingOpen()) {
      waitingBriefing = true;
      showScreen("timelapse");
      UI.renderLiveWait("briefing");
      return;
    }
    waitingBriefing = false;
    lastResult = null;
    S.advance();
    render();
  }

  /* ============================================================
     2026 엔딩 — 여기서 '시간 진행'이 사라집니다
     ============================================================ */
  var endingStep = 0;

  function nextEnding() {
    endingStep++;
    if (endingStep > 1) {
      S.advance();          // 최종 화면으로
      render();
      return;
    }
    UI.showEndingStep(endingStep);
  }

  /* 라이브 세션에서는 진행자가 시상을 마친 뒤 이 화면을 엽니다.
     혼자 연습할 때는 What If 다음에 바로 열어줍니다. */
  function afterWhatIf() {
    if (liveControl()) {
      UI.toast("회고는 진행자 화면에서 열어줍니다. 잠시 기다려주세요.");
      return;
    }
    localReflect = true;
    render();
  }

  /* ============================================================
     마지막 회고 — 여섯 번을 다 지나온 뒤 한 번만
     ============================================================ */
  var reflectDraft = { picks: {}, comment: "", submitted: false, loaded: false };
  var localReflect = false;

  function reflectOpen() {
    if (localReflect) return true;
    var control = liveControl();
    return !!(control && control.stage === "reflect");
  }

  /* 새로고침해도 적어둔 것이 남아 있어야 합니다 */
  function loadReflectDraft() {
    if (reflectDraft.loaded) return;
    reflectDraft.loaded = true;
    var saved = S.team() && S.team().finalReflection;
    if (!saved) return;
    (saved.picks || []).forEach(function (id) { reflectDraft.picks[id] = true; });
    reflectDraft.comment = saved.comment || "";
    reflectDraft.submitted = true;
  }

  function toggleReflectPick(id, on) {
    if (on) reflectDraft.picks[id] = true;
    else delete reflectDraft.picks[id];
    UI.renderReflect(reflectDraft, toggleReflectPick);
  }

  function sendReflection() {
    var picks = Object.keys(reflectDraft.picks);
    var comment = el("rfComment").value.trim();
    if (!picks.length && !comment) {
      UI.toast("바꾸고 싶은 결정을 고르거나, 한 줄이라도 남겨주세요.");
      el("rfComment").focus();
      return;
    }
    reflectDraft.comment = comment;
    reflectDraft.submitted = true;
    S.team().finalReflection = { picks: picks, comment: comment };
    S.save();
    UI.renderReflect(reflectDraft, toggleReflectPick);
    publishLiveState();
    UI.toast("제출했습니다. 진행자 화면을 보세요.");
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
    if (liveUrl && assignedLiveTeam && name !== assignedLiveTeam) {
      UI.toast("이 세션에서는 배정된 " + assignedLiveTeam + "만 사용할 수 있습니다.");
      el("tbTeam").value = assignedLiveTeam;
      return;
    }
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
    el("codeForm").onsubmit   = submitJoinCode;
    el("btnPractice").onclick = startPractice;
    el("joinCode").oninput    = function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 4);
      setJoinMessage("", "");
      /* 네 자리를 채우면 바로 들어갑니다 */
      if (this.value.length === 4) submitJoinCode();
    };
    el("btnStart").onclick    = startNewGame;
    el("btnContinue").onclick = continueGame;

    /* 최종 → What If */
    el("btnFinalGo").onclick  = function () { S.setPhase("whatif"); render(); };

    /* 배분과 정책을 한 화면에서 정하고 여기서 바로 확정합니다 */
    el("btnInvestGo").onclick = function () {
      if (UI.allocSum(alloc) === 0 &&
          !confirm("아무 곳에도 투자하지 않았습니다. 예산 전액을 현금으로 남길까요?")) return;
      commit();
    };
    el("btnAllocReset").onclick = resetAlloc;
    el("btnWhatifGo").onclick = afterWhatIf;
    el("btnReflectSend").onclick = sendReflection;
    el("rfComment").addEventListener("input", function () {
      reflectDraft.comment = this.value;
      el("rfCount").textContent = this.value.length;
    });
    el("btnSkipLapse").onclick = skipLapse;
    el("btnEndNext").onclick = nextEnding;

    el("btnSaveReason").onclick = saveReason;
    el("btnCopyCode").onclick = copyCode;

    el("tbTeam").onchange = function () { switchTeam(this.value); };
    if (liveUrl) el("tbTeam").disabled = true;
    el("btnSound").onclick = function () {
      var off = window.DRBAudio ? window.DRBAudio.toggle() : true;
      el("btnSound").textContent = off ? "🔇" : "🔊";
      el("btnSound").setAttribute("aria-pressed", off ? "true" : "false");
    };
    el("btnAdmin").onclick = toggleAdmin;
    el("btnReset").onclick = resetGame;
    el("btnDetail").onclick = UI.showDetail;
    el("modalClose").onclick = UI.closeModal;
    el("modal").onclick = function (e) { if (e.target === this) UI.closeModal(); };

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") UI.closeModal();
    });
    window.addEventListener("drb-live-control", function () {
      if (!S.g()) return;
      /* 진행자가 회고를 열었습니다. 이미 그 화면이면 적던 것을 지우지 않습니다. */
      if (reflectOpen()) {
        if (el("app").getAttribute("data-screen") !== "reflect") render();
        return;
      }
      /* 돌발상황 화면은 빔에 있지만 알람은 노트북에서 울립니다.
         조가 고개를 드는 순간이라 소리까지 빼면 사건이 지나가버립니다. */
      var control = liveControl();
      var stage = control ? control.stage : null;
      if (stage !== lastControlStage) {
        if (window.DRBAudio) window.DRBAudio.duck(stage === "event");
        if (stage === "event") {
          sfx("shock");
          if (window.DRBAudio) window.DRBAudio.alarm();
          if (waitingBriefing) UI.renderLiveWait("event");
        }
      }
      lastControlStage = stage;

      if (waitingBriefing && liveNextBriefingOpen()) {
        waitingBriefing = false;
        S.advance();
        lastResult = null;
        render();
      }
    });
  }

  /* ============================================================
     시작
     ============================================================ */
  function connectLiveSession() {
    if (!liveUrl || liveJoinPending) return;
    if (!window.DRBLive || !window.DRBLive.joinFromUrl) {
      liveJoinPending = false;
      liveJoinError = "라이브 모듈을 불러오지 못했습니다. 게임 시작을 눌러 다시 시도해주세요.";
      initIntro();
      return;
    }
    liveJoinPending = true;
    liveJoinError = "";
    initIntro();
    window.DRBLive.joinFromUrl().then(function (joined) {
      if (!joined || !joined.teamName) throw new Error("배정 조 정보를 확인하지 못했습니다.");
      assignedLiveTeam = joined.teamName;
      assignedLiveTeamCount = Number(joined.teamCount || setupTeamCount);
      assignedRivalCount = Number(joined.rivalCount) || null;
      setupTeamCount = assignedLiveTeamCount;
      setupTeamName = assignedLiveTeam;
      liveJoinPending = false;
      liveJoinError = "";
      if (S.g() && S.g().teams && S.g().teams[assignedLiveTeam]) S.switchTeam(assignedLiveTeam);
      initIntro();
      UI.toast("교육 세션 " + liveParams.get("session") + " · " + assignedLiveTeam + " 연결 완료");
    }).catch(function (error) {
      liveJoinPending = false;
      liveJoinError = (error.message || "교육 세션에 연결하지 못했습니다.") + " 게임 시작을 눌러 다시 시도해주세요.";
      initIntro();
      UI.toast(liveJoinError);
    });
  }
  function boot() {
    /* 데이터 파일이 하나라도 빠지면 바로 알려준다 (조용히 실패하지 않기) */
    var missing = [];
    [["DRB_CONFIG", "data/config.js"], ["DRB_ERAS", "data/eras.js"],
     ["DRB_INVESTMENTS", "data/investments.js"], ["DRB_POLICIES", "data/policies.js"],
     ["DRB_EVENTS", "data/events.js"], ["DRB_ROUNDS", "data/rounds.js"],
     ["DRB_ACTUAL", "data/actual_drb.js"],
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
    initCoverVideo();

    if (liveUrl) connectLiveSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
