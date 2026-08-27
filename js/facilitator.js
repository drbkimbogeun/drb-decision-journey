(function () {
  "use strict";

  /* ============================================================
     진행자 화면 — 챕터를 하나씩 넘기며 진행합니다

     화면은 "지금 할 말" 하나만 보여주고, 손은 [다음] 하나에만 둡니다.
     한 국면은 이렇게 흘러갑니다.

       시대 설명 → 각 조가 결정 → 돌발상황 → 국면 결과
       (시대 끝) → 산업 지도 → DRB 실제 선택 → 이야기 → 순위

     [다음] 은 [각 조가 결정합니다] 에서 모든 조가 확정할 때까지
     잠깁니다. 진행자가 기다리는 것이 아니라 화면이 기다립니다.
     ============================================================ */

  var CFG = window.DRB_CONFIG;
  var G = window.DRB_GLOBAL;
  var PASTED_KEY = CFG.storage.key + "_pasted";
  var FAC_KEY = CFG.storage.key + "_facilitator";
  var TEAM_COLORS = ["#e31d38", "#f2c14e", "#4dd4c0", "#7aa2f7", "#f78fb3", "#7fd18a"];
  /* 참가자에게 공개되는 7단계 — Worker 가 검증하는 목록과 같아야 합니다.
     reflect 는 시상이 끝난 뒤 조별 노트북을 회고 화면으로 돌립니다. */
  var CONTROL_STAGES = ["briefing", "decisions", "event", "actual", "map", "reflect"];
  /* 진행자 화면에만 있는 화면. 순위·시상이 들어 있어 절대 공개하지 않습니다.
     lapse(연도 흐름)도 여기 둡니다 — 참가자 노트북은 그동안 대기 화면 그대로입니다.
     연출을 조별로 또 돌리면 방이 흩어집니다. 이건 빔에서 한 번만 돕니다. */
  var LOCAL_STAGES = ["intro", "howto", "lapse", "phase", "standings", "award", "finale", "closing"];
  var STAGES = ["intro", "howto", "briefing", "decisions", "lapse", "event", "phase",
                "actual", "map", "standings", "award", "reflect", "finale", "closing"];

  /* 챕터마다 진행자가 할 말 한 줄. 화면 제목이 곧 대본입니다. */
  var CHAPTER = {
    intro:     { title: "시작합니다",                 tab: "표지" },
    howto:     { title: "오늘은 이렇게 진행합니다",    tab: "진행 방법" },
    briefing:  { title: "이 시대를 설명합니다",        tab: "시대 설명" },
    decisions: { title: "각 조가 결정합니다",          tab: "조별 결정" },
    lapse:     { title: "그리고 시간이 흘렀습니다",     tab: "시간 흐름" },
    event:     { title: "이런 일이 벌어졌습니다",      tab: "돌발상황" },
    phase:     { title: "각 조는 이렇게 되었습니다",   tab: "국면 결과" },
    map:       { title: "지금 누가 어디에 있습니까",   tab: "산업 지도" },
    actual:    { title: "그때 DRB는 이렇게 했습니다",  tab: "DRB 실제" },
    standings: { title: "여기까지의 순위",             tab: "순위" },
    award:     { title: "여섯 번의 선택이 끝났습니다", tab: "시상" },
    reflect:   { title: "앞으로는 이렇게 하겠습니다",     tab: "회고" },
    finale:    { title: "우리는 이렇게 걸어왔습니다",     tab: "회사 사진" },
    closing:   { title: "그리고 2026년부터는",         tab: "맺음말" }
  };

  var timeline = [];
  var selectedTurn = 0;
  var currentStage = "intro";
  var liveTimer = null;
  var liveSnapshot = null;
  var minTurns = 0; // 공개 화면은 가장 느린 조 기준. 미래 국면 스포일러 방지 계약.
  var openTurn = 0; // 지금 열 수 있는 마지막 국면
  var forcedTurn = -1; // 진행자가 "그래도 넘기기" 로 연 국면
  var clock = { left: 0, running: false, turn: -1, tick: null };

  window.DRB_ROUNDS.forEach(function (round, roundIndex) {
    round.subrounds.forEach(function (sub, subIndex) {
      timeline.push({ round: round, sub: sub, roundIndex: roundIndex, subIndex: subIndex, turn: timeline.length });
    });
  });

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function fmt(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "-";
  }
  function signed(value) {
    var n = Math.round(Number(value) || 0);
    return (n > 0 ? "+" : "") + n.toLocaleString("ko-KR");
  }
  function toast(message) {
    var node = el("toast");
    node.textContent = message;
    node.classList.add("is-show");
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.classList.remove("is-show"); }, 2400);
  }
  function openModal(title, html) {
    el("modalTitle").textContent = title;
    el("modalBody").innerHTML = html;
    el("modal").classList.add("is-open");
  }
  function closeModal() { el("modal").classList.remove("is-open"); }
  function openTools() { el("bToolsPanel").classList.add("is-open"); }
  function closeTools() { el("bToolsPanel").classList.remove("is-open"); }
  function teamColor(name) {
    var idx = (CFG.teamNames || []).indexOf(name);
    return TEAM_COLORS[(idx < 0 ? 0 : idx) % TEAM_COLORS.length];
  }
  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; }
    catch (err) { return fallback; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function investName(id) {
    var name = id;
    Object.keys(window.DRB_INVESTMENTS || {}).some(function (set) {
      return window.DRB_INVESTMENTS[set].some(function (item) {
        if (item.id !== id) return false;
        name = item.name;
        return true;
      });
    });
    return name;
  }
  function policyName(id, fallback) {
    var name = fallback || id || "-";
    Object.keys(window.DRB_POLICIES || {}).some(function (set) {
      return window.DRB_POLICIES[set].some(function (policy) {
        if (policy.id !== id) return false;
        name = policy.name;
        return true;
      });
    });
    return name;
  }
  function countryName(id) {
    var item = (G.countries || []).filter(function (x) { return x.id === id; })[0];
    return item ? item.name : (id || "-");
  }
  function modeName(id) {
    var item = (G.modes || []).filter(function (x) { return x.id === id; })[0];
    return item ? item.name : (id || "-");
  }

  /* 많이 넣은 순서대로. topIds 는 { id, amount } 를, topAlloc 은 사람이 읽는 문장을 줍니다.
     둘을 섞어 쓰면 "undefined" 가 화면에 나옵니다 — 실제로 그랬습니다. */
  function topIds(allocation, limit) {
    return Object.keys(allocation || {})
      .filter(function (id) { return Number(allocation[id]) > 0; })
      .sort(function (a, b) { return Number(allocation[b]) - Number(allocation[a]); })
      .slice(0, limit || 4)
      .map(function (id) { return { id: id, amount: Number(allocation[id]) }; });
  }
  function topAlloc(allocation, limit) {
    return topIds(allocation, limit).map(function (a) { return investName(a.id) + " " + a.amount; });
  }
  function allocationSum(allocation) {
    return Object.keys(allocation || {}).reduce(function (sum, id) { return sum + (Number(allocation[id]) || 0); }, 0);
  }

  function normalizeHistory(history) {
    return (history || []).map(function (h) {
      if (h.roundId) {
        if (!h.report) h.report = {
          kpi: h.kpi || {},
          events: h.events || [],
          headline: h.headline || ""
        };
        if (!h.before) h.before = { cash: h.beforeCash };
        if (!h.after) h.after = { cash: h.afterCash };
        return h;
      }
      var pos = timeline.filter(function (x) { return x.sub.id === h.sr; })[0] || timeline[Math.max(0, (Number(h.r) - 1) * 2)];
      var events = (h.ev || []).map(function (event) {
        return { id: event.id, title: event.title, reactions: event.reactions || [] };
      });
      return {
        roundId: pos ? pos.round.id : "r" + h.r,
        roundNo: Number(h.r),
        subroundId: h.sr,
        subTitle: h.title || (pos && pos.sub.title),
        year: h.y || (pos && pos.sub.year),
        allocation: h.a || {},
        choices: h.ch || {},
        policyId: h.pid,
        policyName: h.pol,
        report: { kpi: h.kpi || { revenue: h.rev, profit: h.pro }, events: events },
        before: h.before || {}, after: h.after || {}
      };
    });
  }

  function localTeams() {
    var save = readJson(CFG.storage.key, null);
    if (!save || !save.teams) return [];
    return (save.teamNames || Object.keys(save.teams)).map(function (name) {
      var team = save.teams[name];
      if (!team) return null;
      return {
        name: name,
        source: "local",
        state: team.state || {},
        history: normalizeHistory(team.history),
        phase: team.phase || "roundOpen",
        turns: (team.history || []).length,
        finished: !!team.finished,
        reflection: team.finalReflection || null,
        updatedAt: save.startedAt
      };
    }).filter(Boolean);
  }

  function pastedTeams() {
    return readJson(PASTED_KEY, []).map(function (payload) {
      return {
        name: payload.t,
        source: "code",
        state: payload.s || {},
        history: normalizeHistory(payload.p),
        phase: "final",
        turns: (payload.p || []).length,
        finished: true,
        updatedAt: payload.exportedAt
      };
    });
  }

  function remoteTeams() {
    var teams = liveSnapshot && liveSnapshot.teams;
    if (!teams) return [];
    if (!Array.isArray(teams)) teams = Object.keys(teams).map(function (key) { return teams[key]; });
    return teams.map(function (team) {
      var snap = team.snapshot || team;
      return {
        name: snap.teamName || team.teamName || team.name,
        source: "live",
        state: snap.state || {},
        history: normalizeHistory(snap.history),
        phase: snap.phase || "roundOpen",
        turns: Number(snap.turnIndex !== undefined ? snap.turnIndex : (snap.turn !== undefined ? snap.turn : (snap.history || []).length)),
        finished: !!snap.finished,
        reflection: snap.reflection || null,
        updatedAt: snap.updatedAt || team.updatedAt
      };
    }).filter(function (team) { return team.name; });
  }

  function collectTeams() {
    if (liveSnapshot && liveSnapshot.session) {
      var remote = remoteTeams();
      var byName = {};
      remote.forEach(function (team) { byName[team.name] = team; });
      var expected = Number(liveSnapshot.session.teamCount) || 0;
      (CFG.teamNames || []).slice(0, expected).forEach(function (name) {
        if (!byName[name]) byName[name] = {
          name: name,
          source: "live",
          state: { sites: [] },
          history: [],
          phase: "not-connected",
          turns: 0,
          finished: false,
          placeholder: true
        };
      });
      return Object.keys(byName).map(function (name) { return byName[name]; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
    }
    var all = localTeams().concat(pastedTeams());
    var localByName = {};
    var rank = { code: 2, local: 1 };
    all.forEach(function (team) {
      var prior = localByName[team.name];
      if (!prior || team.turns > prior.turns || (team.turns === prior.turns && rank[team.source] > rank[prior.source])) localByName[team.name] = team;
    });
    return Object.keys(localByName).map(function (name) { return localByName[name]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
  }
  function historyAt(team, turn) {
    var wanted = timeline[turn];
    return (team.history || []).filter(function (h) { return wanted && h.subroundId === wanted.sub.id; })[0] || null;
  }
  function completedRound(team, round) {
    return round.subrounds.every(function (sub) {
      return (team.history || []).some(function (h) { return h.subroundId === sub.id; });
    });
  }
  function allCompletedRound(teams, round) {
    return teams.length > 0 && teams.every(function (team) { return completedRound(team, round); });
  }
  function revealKey(roundId) { return FAC_KEY + "_revealed_" + roundId; }
  function isRevealed(roundId) { return sessionStorage.getItem(revealKey(roundId)) === "1"; }
  function decidedCount(teams, turn) {
    return teams.filter(function (team) { return !!historyAt(team, turn); }).length;
  }
  function allDecided(teams, turn) {
    return teams.length > 0 && decidedCount(teams, turn) === teams.length;
  }

  /* 카드를 몇 칸으로 늘어놓을지. 한 조뿐일 때 한 장이 화면 전체를 먹지 않게,
     여섯 조일 때 한 장이 손톱만해지지 않게 3~4칸 사이로 묶습니다. */
  function cardColumns(count) {
    var per = count <= 4 ? count : Math.ceil(count / 2);
    return "grid-template-columns:repeat(" + Math.max(3, Math.min(per, 4)) + ",minmax(0,1fr))";
  }


  /* ============================================================
     챕터 — 한 국면을 어떤 순서로 넘기는가
     ============================================================ */

  /* 돌발상황이 없는 국면에서는 그 챕터를 아예 만들지 않습니다.
     "이번엔 사건이 없습니다" 라는 빈 화면을 넘기게 하지 않으려는 겁니다. */
  function chaptersFor(turn) {
    var item = timeline[turn];
    var list = ["briefing", "decisions"];
    /* 결정을 잠근 뒤 연도가 흐릅니다. 마지막 국면(2026)에는 뒤가 없어 흐르지 않습니다. */
    if (timeline[turn + 1]) list.push("lapse");
    if (item.sub.event) list.push("event");
    list.push("phase");
    if (item.subIndex === item.round.subrounds.length - 1) {
      if (item.round.no >= 2) list.push("map");   // 해외 거점은 ERA 2부터
      list.push("actual", "standings");
    }
    return list;
  }

  /* 표지 → 진행 방법 → 6개 국면의 챕터들 → 시상 */
  function book() {
    var out = [{ turn: 0, stage: "intro" }, { turn: 0, stage: "howto" }];
    timeline.forEach(function (item, turn) {
      chaptersFor(turn).forEach(function (stage) { out.push({ turn: turn, stage: stage }); });
    });
    out.push({ turn: timeline.length - 1, stage: "award" });
    out.push({ turn: timeline.length - 1, stage: "reflect" });
    /* 사진이 없으면 이 챕터는 아예 만들지 않습니다 — 검은 화면을 넘기게 하지 않습니다 */
    if (endingPhotos().length) out.push({ turn: timeline.length - 1, stage: "finale" });
    out.push({ turn: timeline.length - 1, stage: "closing" });
    return out;
  }

  function bookIndex(list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].turn === selectedTurn && list[i].stage === currentStage) return i;
    }
    /* 도구에서 직접 뛰어든 화면 — 같은 이름의 첫 챕터로 봅니다 */
    for (var j = 0; j < list.length; j++) if (list[j].stage === currentStage) return j;
    return 0;
  }

  /* [다음] 이 잠기는 곳은 한 군데뿐입니다 — 모든 조가 결정을 확정할 때까지 */
  function nextLocked(teams) {
    if (!teams.length) return false;              // 리허설 중에는 잠그지 않습니다
    if (currentStage !== "decisions") return false;
    if (forcedTurn >= selectedTurn) return false; // 진행자가 직접 열었습니다
    return !allDecided(teams, selectedTurn);
  }

  /* ============================================================
     한 곳만 딸 수 있는 기회 — 판정은 여기서 합니다

     ★ 조별 노트북은 자기 조밖에 모릅니다. 모든 조의 결정을 한자리에서
       보는 화면은 여기뿐이라, 낙찰은 여기서 정해 각 조에 내려보냅니다.
       계산은 engine.awardLimited() — 노트북과 같은 코드입니다.
     ============================================================ */
  var awardsSent = {};

  function awardsFor(teams, turn) {
    var offers = window.DRBEngine.limitedOffers(timeline[turn].sub);
    if (!offers.length) return null;

    var bidders = [];
    for (var i = 0; i < teams.length; i++) {
      var h = historyAt(teams[i], turn);
      if (!h || !h.before) return null;          // 아직 다 확정하지 않았습니다
      bidders.push({
        team: teams[i].name, state: h.before,
        allocation: h.allocation, policyId: h.policyId
      });
    }
    if (bidders.length < 2) return null;         // 혼자면 경쟁이 아닙니다

    var out = { verdict: {}, detail: [] };
    offers.forEach(function (entry) {
      var result = window.DRBEngine.awardLimited(entry, bidders);
      out.verdict[result.id] = result.winners;
      out.detail.push(result);
    });
    return out;
  }

  /* 판정이 나면 그 자리에서 각 조에 알려줍니다.
     같은 국면에 두 번 보내지 않습니다 — 받은 조가 계산을 다시 하게 됩니다. */
  function publishAwards(teams) {
    var live = window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession();
    if (!live) return;
    var got = awardsFor(teams, selectedTurn);
    if (!got) return;
    var key = selectedTurn + ":" + JSON.stringify(got.verdict);
    if (awardsSent[key]) return;
    awardsSent[key] = true;
    var patch = {};
    patch[String(selectedTurn)] = got.verdict;
    var merged = Object.assign({}, (liveControlState() || {}).awards || {}, patch);
    window.DRBLive.control({ awards: merged }).catch(function () {});
  }

  function liveControlState() {
    return (liveSnapshot && liveSnapshot.control) || null;
  }

  function goStep(delta) {
    var list = book();
    var at = bookIndex(list);
    var target = list[at + delta];
    if (!target) return;
    if (delta > 0 && nextLocked(collectTeams())) return;
    selectedTurn = target.turn;
    currentStage = target.stage;
    if (selectedTurn !== clock.turn) resetClock();
    render();
    showStage(currentStage, true);
  }


  /* ============================================================
     토론 시계 — 눌러서 재고, 국면이 바뀌면 되돌아갑니다
     ============================================================ */
  function resetClock() {
    var era = window.DRB_ERAS[timeline[selectedTurn].round.era];
    clock.left = (era.pace && era.pace.discussSeconds) || CFG.timer.discussSeconds;
    clock.running = false;
    clock.turn = selectedTurn;
    clearInterval(clock.tick);
    clock.tick = null;
  }
  function toggleClock() {
    if (!clock.left) { resetClock(); }
    clock.running = !clock.running;
    clearInterval(clock.tick);
    clock.tick = null;
    if (clock.running) {
      clock.tick = setInterval(function () {
        clock.left = Math.max(0, clock.left - 1);
        if (!clock.left) { clock.running = false; clearInterval(clock.tick); clock.tick = null; }
        markClock(clock.left);
        paintClock();
      }, 1000);
    }
    paintClock();
  }

  /* 남은 시간을 소리로 알립니다 — 1분 · 30초 · 10초 · 끝.
     진행자가 "1분 남았습니다" 를 매번 외치지 않아도 방 전체가 같이 압니다.
     어느 초에 울릴지는 config 의 timer.beepAt 에서 바꿉니다. */
  function markClock(left) {
    var marks = (CFG.timer && CFG.timer.beepAt) || [];
    if (marks.indexOf(left) < 0) return;
    if (!window.DRBAudio) return;
    window.DRBAudio.play(
      left === 0 ? "timeUp" : left <= 10 ? "markLast" : left <= 30 ? "markNear" : "markFar"
    );
  }
  function paintClock() {
    var box = el("bTimer");
    var m = Math.floor(clock.left / 60);
    var s = clock.left % 60;
    el("bTimerText").textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    el("bTimerLabel").textContent = clock.running ? "토론 중" : (clock.left ? "누르면 시작" : "시간 끝");
    box.classList.toggle("is-running", clock.running);
    box.classList.toggle("is-urgent", clock.running && clock.left <= 30);
    box.classList.toggle("hidden", currentStage !== "decisions");
  }


  /* ============================================================
     머리띠 · 챕터 띠 · 조작 띠
     ============================================================ */
  function updateProgress(teams) {
    /* 등록된 모든 조를 포함해야 한 조만 먼저 달려도 미래 국면이 빔에 노출되지 않습니다. */
    if (teams.length) minTurns = teams.reduce(function (min, team) { return Math.min(min, team.turns); }, teams[0].turns);
    else minTurns = 0;

    openTurn = teams.length
      ? Math.min(timeline.length - 1, Math.max(minTurns, forcedTurn + 1))
      : timeline.length - 1;
    selectedTurn = Math.min(Math.max(0, selectedTurn), openTurn);

    var item = timeline[selectedTurn];
    var era = window.DRB_ERAS[item.round.era];
    el("bEraChip").textContent = "ERA " + item.round.no + " · " + item.sub.year;
    el("bEra").textContent = era.name;
    el("bProgress").textContent = "국면 " + (selectedTurn + 1) + " / " + timeline.length;
    renderDots();

    el("btnPrev").disabled = selectedTurn === 0;
    el("btnNext").disabled = selectedTurn >= openTurn;
    el("bPace").textContent = teams.length
      ? "가장 느린 조의 완료 수 " + minTurns + "회를 공개 기준으로 씁니다. 앞서간 조의 미래 배경은 빔에서 숨깁니다."
      : "조가 시작하면 가장 느린 조를 기준으로 미래 배경을 잠급니다.";
  }

  function renderDots() {
    el("bDots").innerHTML = timeline.map(function (item, i) {
      var cls = i < selectedTurn ? " is-done" : i === selectedTurn ? " is-active" : "";
      return (i ? "<span class='dots__link'></span>" : "") +
             "<span class='dots__dot" + cls + "' title='" + item.sub.year + "'></span>";
    }).join("");
  }

  /* 지금 어느 챕터인지 · 이 국면에 몇 챕터가 남았는지 */
  function renderChapterBar() {
    var list = chaptersFor(selectedTurn);
    var at = list.indexOf(currentStage);
    var item = timeline[selectedTurn];

    el("bChapTitle").textContent = (CHAPTER[currentStage] || {}).title || "";
    if (currentStage === "intro" || currentStage === "howto") {
      el("bChapWhere").textContent = "시작하기 전";
      el("bChapNo").textContent = "준비";
    } else if (currentStage === "award" || currentStage === "reflect" || currentStage === "closing") {
      el("bChapWhere").textContent = firstYear() + " → " + lastYear();
      el("bChapNo").textContent = "끝";
    } else {
      el("bChapWhere").textContent = (selectedTurn + 1) + "국면 · " + item.sub.year + " · " +
        window.DRB_ERAS[item.round.era].name;
      /* 도구에서 이 국면에 없는 화면으로 뛰어든 경우 — 순서를 매기지 않습니다 */
      el("bChapNo").textContent = at < 0 ? "참고" : (at + 1) + " / " + list.length;
    }

    el("bSteps").innerHTML = (at < 0 ? [] : list).map(function (stage, i) {
      var cls = stage === currentStage ? " is-now" : (i < at ? " is-done" : "");
      return "<button class='fac-steps__item" + cls + "' data-chapter='" + stage + "' type='button'>" +
        esc(CHAPTER[stage].tab) + "</button>";
    }).join("");
  }

  /* 아래 조작 띠 — 뒤로 / 지금 할 일 / 다음 */
  function renderDrive(teams) {
    var list = book();
    var at = bookIndex(list);
    var next = list[at + 1];
    var locked = nextLocked(teams);

    el("btnBack").disabled = at <= 0;
    el("btnNextStep").disabled = !next || locked;
    el("bNextHint").textContent = !next ? "마지막 화면입니다"
      : next.turn > selectedTurn ? "다음 국면 · " + timeline[next.turn].sub.year
      : CHAPTER[next.stage].title;

    el("bLock").classList.toggle("hidden", !locked);
    if (locked) {
      el("bLockCount").textContent = decidedCount(teams, selectedTurn) + " / " + teams.length +
        "조 확정 — 아직 결정 중인 조가 있습니다";
    }
    el("bCue").innerHTML = cuesFor(teams).map(function (cue, i) {
      return "<span class='fac-drive__cueitem" + (i === 0 ? " is-key" : "") + "'>" + esc(cue) + "</span>";
    }).join("");
  }

  function cuesFor(teams) {
    var item = timeline[selectedTurn];
    if (currentStage === "intro") return ["조가 다 들어왔는지 확인하고 시작하세요.", "이 화면은 진행자만 봅니다."];
    if (currentStage === "howto") return ["여섯 번의 결정을 한다는 것만 말하고 넘어가세요."];
    if (currentStage === "briefing") return ["이 배경을 소리 내어 읽어주세요.", "이번 국면에 새로 늘어난 판단만 짚어주세요."];
    if (currentStage === "decisions") return allDecided(teams, selectedTurn)
      ? ["모두 확정했습니다. 넘어가세요.", "확정한 이유를 한 조씩 짧게 받아도 좋습니다."]
      : ["조들이 이야기하는 동안 기다립니다.", "시계를 눌러 남은 시간을 띄워주세요."];
    if (currentStage === "event") return ["헤드라인을 크게 한 번 읽어주세요.", "같은 사건인데 왜 결과가 달랐는지 물어보세요."];
    if (currentStage === "phase") return ["1위 조에게 무엇을 걸었는지 먼저 물어보세요.", "순위는 국면마다 바뀝니다. 끝까지 가봐야 압니다."];
    if (currentStage === "map") return ["거점 수보다 어디에·어떻게 들어갔는지를 비교하세요."];
    if (currentStage === "actual") return ["조별 판단을 먼저 발표시킨 뒤 공개 버튼을 누르세요.",
      allCompletedRound(teams, item.round) || !teams.length
        ? "DRB를 정답으로 말하지 마세요."
        : "아직 진행 중인 조가 있습니다 — 그래도 열립니다."];
    if (currentStage === "standings") return ["이 화면은 진행자만 봅니다. 참가자에게는 순위가 없습니다."];
    if (currentStage === "award") return ["1등이 정답은 아니라는 말로 닫아주세요."];
    if (currentStage === "reflect") return ["조 노트북이 회고 화면으로 바뀌었습니다. 적을 시간을 주세요.",
      "다 들어오면 한두 조만 골라 읽게 하세요. 이 내용이 간담회 자료가 됩니다."];
    return ["글자가 다 찍힐 때까지 아무 말도 하지 마세요.", "다 나오면 마지막 두 줄만 소리 내어 읽어주세요."];
  }

  /* 조 현황 한 줄 — 왼쪽 레일을 대신합니다 */
  function renderTeamStrip(teams, live) {
    var box = el("bTeamStrip");
    /* 세션이 없으면 아래 빨간 띠가 이미 같은 말을 합니다. 두 번 말하지 않습니다. */
    box.classList.toggle("hidden", !teams.length && !live);
    if (!teams.length) {
      box.innerHTML = "<span class='fac-strip__empty'>조가 들어오기를 기다립니다 — " +
        "<b>도구 ⋯</b> 에서 참가 주소와 조별 코드를 다시 볼 수 있습니다</span>";
      return;
    }
    box.innerHTML = teams.map(function (team, idx) {
      var decided = !!historyAt(team, selectedTurn);
      var cls = team.placeholder ? " is-off" : decided ? " is-done" : " is-busy";
      var label = team.placeholder ? "미접속" : decided ? "확정" : "결정 중";
      return "<button class='tchip" + cls + "' type='button' data-team='" + esc(team.name) + "'>" +
        "<span class='tchip__no num' style='background:" + teamColor(team.name) + "'>" + (idx + 1) + "</span>" +
        "<span class='tchip__name'>" + esc(team.name) + "</span>" +
        "<span class='tchip__state'>" + label + "</span>" +
      "</button>";
    }).join("");
  }

  /* 조의 경영 성향을 한 단어로 (엔진이 이미 판단합니다) */
  function styleOf(team) {
    try { return window.DRBEngine.judgeStyle(team.state).name; }
    catch (err) { return ""; }
  }
  function adaptiveOf(team) {
    try { return window.DRBEngine.adaptiveCapacity(team.state).score; }
    catch (err) { return 0; }
  }
  /* 현재 경쟁력 — 참가자 최종 화면과 같은 식으로 계산합니다 */
  function powerOf(team) {
    var s = team.state || {};
    return Math.round(
      (s.capacity || 0) * 0.3 + (s.tech || 0) * 0.25 + (s.quality || 0) * 0.2 +
      /* 500 은 ui.js 의 참가자 최종 화면과 같은 값이어야 합니다 */
      (s.trust || 0) * 0.15 + Math.max(0, Math.min(1, (s.cash || 0) / 500)) * 100 * 0.1
    );
  }
  /* 종합 = 현재 경쟁력 + 변화 대응력.
     "지금 잘 되는 회사"와 "다시 움직일 수 있는 회사"를 같은 무게로 봅니다. */
  function totalScore(team) { return powerOf(team) + adaptiveOf(team); }


  /* ============================================================
     몰림 경고 — 같은 분야에 조가 몰리면 경쟁강도가 실제로 올라갑니다
     ============================================================ */
  function renderCrowd(teams) {
    var box = el("bCrowd");
    var decided = teams.filter(function (team) { return !!historyAt(team, selectedTurn); });
    if (decided.length < 2) { box.classList.add("hidden"); return; }

    var byTop = {};
    decided.forEach(function (team) {
      var top = topIds(historyAt(team, selectedTurn).allocation, 1)[0];
      if (!top) return;
      if (!byTop[top.id]) byTop[top.id] = [];
      byTop[top.id].push(team.name);
    });

    var crowded = Object.keys(byTop)
      .filter(function (id) { return byTop[id].length >= 2; })
      .sort(function (a, b) { return byTop[b].length - byTop[a].length; });

    box.classList.remove("hidden");
    if (!crowded.length) {
      box.classList.add("is-clear");
      box.innerHTML = "<span class='fac-crowd__label'>몰림 없음</span>" +
        "<span>이번 국면은 조마다 다른 곳에 걸었습니다. 경쟁강도가 오르지 않습니다.</span>";
      return;
    }
    box.classList.remove("is-clear");
    box.innerHTML = "<span class='fac-crowd__label'>몰림 주의</span>" +
      crowded.map(function (id) {
        return "<span><b>" + esc(byTop[id].join(" · ")) + "</b> 가 <b>" + esc(investName(id)) +
               "</b> 에 몰렸습니다 (" + byTop[id].length + "조)</span>";
      }).join("") +
      "<span class='hint'>같은 분야에 몰리면 고객 확보가 어려워집니다. 결과에 실제로 반영됩니다.</span>";
  }


  /* ============================================================
     ★ 여기에 '지금 순위' 띠(renderRank)가 있었습니다. 없앴습니다.

       국면이 끝날 때마다 조별 점수와 순위 변동(▲▼)을 띄웠고, 옆에
       "진행자 화면 전용 · 참가자에게 보이지 않습니다" 라고 적어뒀습니다.
       그런데 이 화면은 빔프로젝터로 나갑니다 — 그 문구를 포함해서
       방 전체가 보고 있었습니다.

       매 국면 순위를 보여주면 남은 국면이 순위 따라잡기가 됩니다.
       이 게임은 등수를 매기지 않는 것이 원칙입니다. 순위는 마지막
       시상(renderAward)에서 한 번만 공개합니다.
     ============================================================ */


  /* ============================================================
     시상 — 종합 순위 + 부문상
     ============================================================ */
  function renderAward(teams) {
    var body = el("bAwardBody");
    var state = el("bAwardState");
    el("bAwardWhen").textContent = timeline[0].sub.year + " → " +
      timeline[timeline.length - 1].sub.year + " · " + timeline.length + "번의 결정이 끝났습니다";
    var done = teams.filter(function (team) { return team.finished || team.turns >= timeline.length; });

    if (!teams.length || done.length < teams.length) {
      state.textContent = done.length + " / " + teams.length + "조 완주";
      body.innerHTML = "<p class='fac-award__wait'>모든 조가 2026년까지 마치면 결과가 열립니다.<br>" +
        "그 전에 열면 아직 결정을 남긴 조가 불리해집니다.</p>";
      return;
    }
    state.textContent = "전 조 완주 · 공개 가능";

    var rows = teams.map(function (team) {
      return {
        name: team.name,
        style: styleOf(team),
        power: powerOf(team),
        adapt: adaptiveOf(team),
        total: totalScore(team),
        team: team
      };
    }).sort(function (a, b) { return b.total - a.total; });

    var podium = "<div class='podium'>" + rows.slice(0, 3).map(function (r, i) {
      return "<div class='podium__row" + (i === 0 ? " is-winner" : "") + "'>" +
        "<div class='podium__label'>" + (i === 0 ? "최우수 경영" : (i + 1) + "위") + "</div>" +
        "<div class='podium__team'>" +
          "<span class='podium__no num'>" + (CFG.teamNames.indexOf(r.name) + 1) + "</span>" +
          "<span class='podium__name'>" + esc(r.name) + "</span>" +
        "</div>" +
        "<div class='podium__style'>" + esc(r.style) + "</div>" +
        /* 변화 대응력은 숫자로 내놓지 않습니다 — 순서만 아래 시상 카드에서 말합니다 */
        "<div class='podium__scores'>" +
          "<span><i>현재 경쟁력</i><b class='num'>" + r.power + "</b></span>" +
        "</div>" +
      "</div>";
    }).join("") + "</div>";

    body.innerHTML =
      podium +
      buildAwards(teams, rows) +
      "<p class='fac-award__message'>1등이 정답은 아닙니다.<br>" +
      "잘 맞히는 것이 아니라, 다시 선택할 수 있는 힘입니다.</p>";
  }

  /* ============================================================
     회고 — 시상이 끝난 뒤 조가 노트북에서 올린 것

     조가 보내는 것은 결정 id 목록과 코멘트 한 줄뿐입니다.
     화면에 뜨는 이름·연도는 전부 여기서 우리 데이터로 붙입니다.
     ============================================================ */
  function reflectLabel(team, pickId) {
    var parts = String(pickId).split(":");
    var spot = timeline.filter(function (item) { return item.sub.id === parts[1]; })[0];
    var where = spot ? (spot.turn + 1) + "국면 · " + spot.sub.year : parts[1];
    if (parts[0] === "event") {
      var title = "";
      (team.history || []).forEach(function (h) {
        ((h.report && h.report.events) || []).forEach(function (event) {
          if (event && event.id === parts[2] && event.title) title = event.title;
        });
      });
      return { kind: "event", where: where, title: title || "돌발상황" };
    }
    /* 제목이 "첫 번째 국면 · 고무신인가" 라 왼쪽 위치표시와 겹칩니다 */
    return {
      kind: "decision",
      where: where,
      title: spot ? spot.sub.title.replace(/^[^·]*번째 국면\s*·\s*/, "") : ""
    };
  }

  /* 간담회는 대개 교육이 끝나고 며칠 뒤입니다. 세션은 24시간 뒤 서버에서
     지워지므로, 회고 챕터를 열 때 이 PC 에 자료를 복사해 둡니다.
     /review 는 서버를 부르지 않고 이것만 읽습니다. */
  function saveReviewCopy(teams) {
    var creds = window.DRBLive && window.DRBLive.facilitatorCredentials
      ? window.DRBLive.facilitatorCredentials() : null;
    var written = teams.filter(function (team) { return team.reflection; });
    if (!written.length) return;
    writeJson(CFG.storage.key + "_review", {
      savedAt: new Date().toISOString(),
      sessionId: creds ? creds.sessionId : "",
      teams: teams.map(function (team) {
        return { name: team.name, history: team.history || [], reflection: team.reflection || null };
      })
    });
  }

  function renderReflection(teams) {
    var grid = el("bReflectGrid");
    var arrived = teams.filter(function (team) { return team.reflection; });
    el("bReflectCount").textContent = arrived.length + " / " + teams.length + "조 제출";
    saveReviewCopy(teams);
    grid.setAttribute("style", cardColumns(Math.max(teams.length, 1)));

    grid.innerHTML = teams.map(function (team) {
      var reflection = team.reflection;
      var head =
        "<div class='rfcard__head'>" +
          "<span class='rfcard__dot' style='background:" + teamColor(team.name) + "'></span>" +
          "<span class='rfcard__name'>" + esc(team.name) + "</span>" +
          "<span class='spacer'></span>" +
          "<span class='rfcard__state" + (reflection ? " is-in" : "") + "'>" +
            (reflection ? "제출" : "작성 중") +
          "</span>" +
        "</div>";

      if (!reflection) {
        return "<article class='rfcard rfcard--wait'>" + head +
          "<p class='rfcard__empty'>노트북에서 적고 있습니다</p></article>";
      }

      /* 조가 보낸 것은 국면 id 하나뿐입니다. 그때 무슨 상황이었고 이 조가
         무엇을 골랐는지는 여기서 우리 데이터로 붙입니다. */
      var card = window.DRBReflect ? window.DRBReflect.card(team, reflection.pick) : null;
      var body = "";

      if (card) {
        var choice = card.choice.top.length
          ? card.choice.top.map(function (t) { return t.name + " " + t.amount; }).join(" · ")
          : "투자 없음";
        body =
          "<div class='rfpick rfpick--" + card.kind + "'>" +
            "<span class='rfpick__where'>" + esc(card.where) + "</span>" +
            "<span class='rfpick__title'>" + esc(card.title) + "</span>" +
          "</div>" +
          (card.situation ? "<p class='rfcard__situation'>" + esc(card.situation) + "</p>" : "") +
          "<div class='rfcard__choice'>" +
            "<span class='rfcard__choice-label'>이 조의 선택</span>" +
            "<span class='rfcard__choice-value'>" + esc(choice) +
            (card.choice.policy ? " · " + esc(card.choice.policy) : "") + "</span>" +
          "</div>";
      }

      return "<article class='rfcard'>" + head + body +
        (reflection.comment
          ? "<p class='rfcard__comment'>" + esc(reflection.comment) + "</p>"
          : "<p class='rfcard__empty'>앞으로의 판단은 적지 않았습니다</p>") +
      "</article>";
    }).join("");
  }

  /* ============================================================
     시상 — 상은 하나뿐입니다

     ★ 이 자리는 상을 나눠주는 자리가 아니라, 60분 내내 숨겨두었던 것을
       처음 말하는 자리입니다 — "우리가 본 것은 매출이 아니라 대응력이었다".

       예전에는 부문상이 다섯 개였습니다 (가장 일관된 조 · 가장 과감한 조 ·
       가장 넓게 나간 조 · DRB와 가장 닮은 조 …). 상이 많으면 다 같이 하나씩
       받고 끝나고, 정작 하려던 말이 그 사이에 묻힙니다.
       그중 '위기에 가장 강한 조' 는 재는 것이 일관성(정책 변경 횟수)인데
       이름은 위기 대응이라, 진행자가 근거 없는 말을 하게 되어 있었습니다.

       하나만 남깁니다. 그리고 왜 그 조인지를 그 자리에서 펼쳐 보입니다.
     ============================================================ */
  function buildAwards(teams, rows) {
    var order = rows.slice().sort(function (a, b) { return b.adapt - a.adapt; });
    var best = order[0];
    if (!best) return "";

    /* ★ 점수를 숫자로 내놓지 않습니다.
         정상적으로 플레이해도 30 언저리라, 숫자를 보면 "우리가 못했나" 로 읽힙니다.
         이 지표는 잘하고 못하고를 재는 것이 아니라 '어느 회사가 다시 움직일 수
         있는가' 를 보는 것이라, 필요한 것은 절대값이 아니라 서로의 자리입니다. */
    var standing = order.map(function (r, i) {
      return "<span class='farrank" + (i === 0 ? " is-first" : "") + "'>" +
        "<b class='num'>" + (i + 1) + "</b>" + esc(r.name) + "</span>";
    }).join("");

    /* 무엇이 그 자리를 만들었는지 — 큰 것부터 이름만 늘어놓습니다.
       이 줄이 곧 '오늘 하려던 말' 입니다. */
    var parts = window.DRBEngine.adaptiveCapacity(best.team.state).parts
      .sort(function (a, b) { return b.value - a.value; });
    var kept = parts.filter(function (p) { return p.value >= 0.5; }).slice(0, 5);
    var lost = parts.filter(function (p) { return p.value <= -0.5; });

    return "<div class='faraward'>" +
      "<div class='faraward__head'>" +
        "<span class='faraward__label'>오늘 우리가 보고 있던 것</span>" +
        "<b class='faraward__title'>가장 멀리 본 조</b>" +
        "<span class='spacer'></span>" +
        "<span class='faraward__team'>" + esc(best.name) + "</span>" +
      "</div>" +
      "<p class='faraward__why'>매출이 아니라 <b>다시 선택할 수 있는 여력</b>을 가장 많이 남긴 조입니다. " +
        "무엇이 오든 여기서 다시 시작할 수 있습니다.</p>" +
      "<div class='faraward__parts'>" +
        kept.map(function (p) { return "<span class='farpart'>" + esc(p.name) + "</span>"; }).join("") +
        lost.map(function (p) { return "<span class='farpart is-down'>" + esc(p.name) + "</span>"; }).join("") +
      "</div>" +
      "<div class='faraward__rank'><span class='faraward__ranklabel'>여력이 남은 순서</span>" + standing + "</div>" +
      "<p class='faraward__foot'>점수로 줄 세우지 않습니다. 매출이 가장 큰 조와 여력이 가장 많은 조는 다를 수 있습니다.</p>" +
    "</div>";
  }

  /* 부문상을 하나로 줄이면서 mostLikeDrb() 와 awardCard() 는 쓰이지 않게 되었습니다.
     'DRB와 가장 닮은 조' 는 DRB 실제 챕터에서 이미 조별로 비교해 보여주고 있습니다. */

  /* ============================================================
     각 챕터의 본문
     ============================================================ */

  function renderCover(teams) {
    el("bCoverTeams").textContent = (teams.length || CFG.teamCountDefault) + "조";
  }

  /* 한 국면을 어떻게 굴리는지. 시간은 config.js 의 phasePlan 을 씁니다. */
  function renderHowto() {
    var plan = CFG.phasePlan || [];
    var per = plan.reduce(function (sum, x) { return sum + x.minutes; }, 0);

    el("bHowtoPace").textContent = "한 국면 " + per + "분 · " + timeline.length + "번 반복";
    el("bHowtoTotal").textContent = "전체 " + (CFG.totalMinutes || per * timeline.length) + "분";

    var nowIndex = { briefing: 0, decisions: 1, event: 2, phase: 3, actual: 4, map: 3 }[currentStage];

    /* 카드 다섯 장이 아니라 화살표로 이어진 순서도입니다.
       빔에서는 "다섯 개가 있다" 보다 "이 순서로 흐른다" 가 먼저 읽혀야 합니다.
       분 표시는 뺐습니다 — 진행자가 시계를 보지, 참가자가 볼 것이 아닙니다. */
    el("bHowtoCards").innerHTML = plan.map(function (step, i) {
      var cls = "flowstep" + (step.fact ? " flowstep--fact" : (i === nowIndex ? " flowstep--now" : ""));
      return (i > 0 ? "<span class='flowarrow' aria-hidden='true'>→</span>" : "") +
        "<div class='" + cls + "'>" +
          "<span class='flowstep__no num'>" + (i + 1) + "</span>" +
          "<div class='flowstep__name'>" + esc(step.name).split("|").join("<br>") + "</div>" +
        "</div>";
    }).join("");
  }

  /* 시대 설명 — 질문 하나, 배경 한 문단, 조건 네 개. 그 이상은 빔에서 안 읽힙니다. */
  function renderBrief() {
    var item = timeline[selectedTurn];
    var era = window.DRB_ERAS[item.round.era];

    var node = el("bBrief");
    node.dataset.roundId = item.round.id;
    node.dataset.subroundId = item.sub.id;
    el("bBriefYear").textContent = spanOf(selectedTurn);
    el("bBriefTitle").textContent = item.sub.title.replace(/^.*?·\s*/, "");
    el("bBriefQ").textContent = "“" + era.question + "”";
    el("bBriefBody").textContent = item.sub.situation.body;
    el("bComplexity").textContent = "복잡도 " + (selectedTurn + 1) + " / " + timeline.length;

    /* 그 시점에 알 수 있었던 신호. 참가자 노트북에서 이 화면을 뺐으므로
       국내·세계는 이제 여기서만 나옵니다 — 진행자가 그대로 읽어줍니다. */
    signalList(el("bBriefDomestic"), era.briefing.domestic);
    signalList(el("bBriefGlobal"), era.briefing.global);

    el("bBriefSource").textContent = "이 배경은 당시 산업환경을 재구성한 교육용 시뮬레이션입니다. DRB의 실제 기록은 시대가 끝난 뒤 따로 공개합니다.";
  }

  /* 한 국면은 한 해가 아니라 몇 년을 통째로 지나갑니다.
     "1945" 만 띄우면 그 해 이야기로 읽혀서, 다음 국면까지의 구간을 보여줍니다. */
  function spanOf(turn) {
    var here = timeline[turn];
    var next = timeline[turn + 1];
    if (!next) return here.sub.year + " 이후";
    return here.sub.year + " ~ " + (next.sub.year - 1);
  }

  /* 전체 여정의 처음과 끝 — 창업연도(1945)와 마지막 국면(2026).
     rounds.js 만 고치면 화면이 따라오도록 여기서 뽑아 씁니다. */
  function firstYear() { return timeline.length ? timeline[0].sub.year : ""; }
  function lastYear()  { return timeline.length ? timeline[timeline.length - 1].sub.year : ""; }

  /* 신호 한 줄씩. 부호(▲▼?)는 붙이지 않습니다 — 진행자가 소리 내어 읽는
     문장이라 기호가 앞에 있으면 읽는 리듬이 끊깁니다. */
  function signalList(node, rows) {
    node.innerHTML = (rows || []).map(function (row) {
      return "<span class='fac-signal__item'>" + esc(row && row.text ? row.text : row) + "</span>";
    }).join("");
  }

  function complexityCue(item) {
    var cues = [
      "시장 자체가 없는 분야에도 자원을 걸지 판단",
      "같은 투자라도 원료 충격을 버틸 준비까지 판단",
      "투자에 더해 해외 지역과 진입 방식을 함께 선택",
      "확장한 자산을 지킬지, 현금을 남길지 선택",
      "서로 충돌하는 16개 신호 속 포트폴리오 구성",
      "10개 투자칸·정책·지역·방식·유연성을 제한시간 안에 통합 판단"
    ];
    return cues[item.turn];
  }

  /* 조별 결정 — 표가 아니라 카드입니다. 빔에서 표는 읽히지 않습니다.

     ★ 이 화면은 모든 조가 함께 보는 빔입니다. 먼저 낸 조의 선택이 보이면
       뒤에 내는 조가 그대로 따라 합니다. 그래서 전 조가 확정하기 전까지는
       "누가 냈는가" 만 보이고 "무엇을 냈는가" 는 가려둡니다.
       다 내면 그 순간 한꺼번에 열립니다. */
  function renderDecisions(teams) {
    var box = el("bDecisionRows");
    var subId = timeline[selectedTurn].sub.id;
    var budget = timeline[selectedTurn].sub.budget || 0;
    var resultOpen = ["event", "phase", "actual", "map", "standings"].indexOf(currentStage) >= 0;
    var open = allDecided(teams, selectedTurn) || forcedTurn >= selectedTurn;

    if (!teams.length) {
      box.style.cssText = "";
      box.innerHTML = "<p class='fac-decision-cards__empty'>참가 조가 연결되면 " +
        "같은 배경에서 나온 서로 다른 판단이 여기에 나란히 놓입니다.</p>";
      el("bDecisionCount").textContent = "0 / 0조 확정";
      el("bDecisionNote").textContent = "";
      return;
    }

    el("bDecisionNote").textContent = open
      ? "같은 배경에서 나온 서로 다른 판단입니다. 왜 그렇게 걸었는지 한 조씩 물어보세요."
      : "모든 조가 확정하면 선택이 한꺼번에 열립니다. 먼저 낸 조를 보고 따라 하지 못하게 가려둡니다.";

    box.style.cssText = cardColumns(teams.length);
    box.innerHTML = teams.map(function (team, idx) {
      var h = historyAt(team, selectedTurn);
      var head =
        "<div class='dcard__head'>" +
          "<span class='dcard__no num' style='background:" + teamColor(team.name) + "'>" + (idx + 1) + "</span>" +
          "<span class='dcard__name'>" + esc(team.name) + "</span>" +
          "<span class='dcard__state'>" + (h ? "확정" : team.placeholder ? "미접속" : "결정 중") + "</span>" +
        "</div>";

      if (!h) {
        return "<div class='dcard is-waiting' data-testid='fac-team-decision' data-team='" + esc(team.name) +
          "' data-subround-id='" + esc(subId) + "'>" + head +
          "<div class='dcard__wait'><span class='dcard__dots'><i></i><i></i><i></i></span>" +
          "<span>" + (team.placeholder ? "아직 들어오지 않았습니다" : "아직 확정하지 않았습니다") + "</span></div>" +
        "</div>";
      }

      /* 냈지만 아직 다 안 낸 상태 — 냈다는 것만 보여줍니다 */
      if (!open) {
        return "<div class='dcard is-sealed' data-testid='fac-team-decision' data-team='" + esc(team.name) +
          "' data-subround-id='" + esc(h.subroundId) + "'>" + head +
          "<div class='dcard__wait'><span class='dcard__seal' aria-hidden='true'>✓</span>" +
          "<span>냈습니다 · 다 모이면 열립니다</span></div>" +
        "</div>";
      }

      var allocRows = topIds(h.allocation, 4).map(function (a) {
        return "<div class='dcard__row'><span>" + esc(investName(a.id)) +
               "</span><b class='num'>" + a.amount + "</b></div>";
      }).join("") || "<div class='dcard__row is-none'><span>투자 없음 · 전액 보유</span></div>";

      var extra = [];
      Object.keys(h.choices || {}).forEach(function (id) {
        var choice = h.choices[id] || {};
        extra.push("진출 " + countryName(choice.where) + " / " + modeName(choice.how));
      });
      var kept = Math.max(0, budget - allocationSum(h.allocation));
      if (kept > 0) extra.push("남긴 현금 " + kept);

      var result = "";
      if (resultOpen && h.report && h.report.kpi) {
        var down = Number(h.report.kpi.profit) < 0;
        result = "<div class='dcard__result" + (down ? " is-down" : "") + "'>" +
          "<span>매출 <b class='num'>" + fmt(h.report.kpi.revenue) + "</b></span>" +
          "<span>손익 <b class='num'>" + signed(h.report.kpi.profit) + "</b></span>" +
        "</div>";
      }

      return "<div class='dcard' data-testid='fac-team-decision' data-team='" + esc(team.name) +
        "' data-subround-id='" + esc(h.subroundId) + "'>" + head +
        "<div class='dcard__alloc'>" + allocRows + "</div>" +
        "<div class='dcard__policy'>" + esc(policyName(h.policyId, h.policyName)) + "</div>" +
        (extra.length ? "<div class='dcard__extra'>" + esc(extra.join(" · ")) + "</div>" : "") +
        result +
      "</div>";
    }).join("");

    el("bDecisionCount").textContent = decidedCount(teams, selectedTurn) + " / " + teams.length + "조 확정";
  }

  function eventReactionText(history, eventId) {
    if (!history || !history.report) return [];
    var event = (history.report.events || []).filter(function (ev) { return ev.id === eventId; })[0];
    return event ? (event.reactions || []).map(function (reaction) { return reaction.text || reaction; }) : [];
  }

  function renderEvent(teams) {
    var item = timeline[selectedTurn];
    var event = item.sub.event ? window.DRB_EVENTS[item.sub.event] : null;
    var box = el("bEvent");

    if (!event) {
      box.dataset.eventId = "none";
      el("bEventYear").textContent = item.sub.year;
      el("bEventHeadline").textContent = "이 국면은 사전 돌발상황이 없습니다";
      el("bEventBody").textContent = "시장 자체와 첫 선택의 불확실성에 집중합니다.";
      el("bEventSource").textContent = "";
    } else {
      box.dataset.eventId = event.id;
      el("bEventYear").textContent = item.sub.year;
      el("bEventHeadline").textContent = event.headline;
      el("bEventBody").textContent = event.body;
      /* ★ 돌발상황은 전부 만들어낸 상황입니다. 바로 다음 화면이 ACTUAL DRB 라서
           여기서 밝히지 않으면 방금 본 사건이 회사 연표로 기억됩니다.
           실제 연표와 헷갈릴 만한 사건에는 events.js 의 factNote 가 붙습니다. */
      el("bEventSource").textContent =
        "이 상황은 당시 업계 환경을 재구성한 교육용 가정입니다. DRB의 실제 기록은 ACTUAL DRB 화면에서 봅니다." +
        (event.factNote ? "  " + event.factNote : "");
    }

    el("bEventTeams").innerHTML = teams.map(function (team) {
      var delivered = !!historyAt(team, selectedTurn);
      return "<span class='fac-event__team" + (delivered ? " is-delivered" : "") + "'>" +
        esc(team.name) + " · " + (delivered ? "적용 확인" : "결정 대기") + "</span>";
    }).join("") || "<span class='hint'>연결된 조 없음</span>";

    /* 한 곳만 딸 수 있는 기회 — 누가 가져갔는지 이 자리에서 선언합니다.
       진행자가 소리 내어 읽는 줄입니다. */
    var award = awardsFor(teams, selectedTurn);
    var awardBox = el("bEventAward");
    if (!award) {
      awardBox.classList.add("hidden");
      awardBox.innerHTML = "";
    } else {
      awardBox.classList.remove("hidden");
      awardBox.innerHTML = award.detail.map(function (result) {
        var rows = result.ranking.map(function (r) {
          var won = result.winners.indexOf(r.team) >= 0;
          return "<div class='fac-award-row" + (won ? " is-won" : r.qualified ? " is-lost" : "") + "'>" +
            "<b style='color:" + teamColor(r.team) + "'>" + esc(r.team) + "</b>" +
            "<span class='fac-award-row__state'>" +
            (won ? "계약" : r.qualified ? "탈락" : "응찰 안 함") + "</span>" +
            "<span class='fac-award-row__score num'>" + (r.qualified ? r.score.toFixed(2) : "—") + "</span>" +
            "</div>";
        }).join("");
        return "<div class='fac-award'>" +
          "<div class='fac-award__head'>" +
          "<span class='fac-award__label'>한 곳만 가져갑니다</span>" +
          "<b class='fac-award__title'>" + esc(result.title) + "</b>" +
          "<span class='spacer'></span>" +
          "<span class='fac-award__winner'>" +
          (result.winners.length ? esc(result.winners.join(" · ")) : "가져간 조 없음") + "</span>" +
          "</div><div class='fac-award__rows'>" + rows + "</div>" +
          "<p class='fac-award__note'>투자액만 보지 않습니다. 기술력 · 고객신뢰 · 인력을 함께 봅니다.</p>" +
          "</div>";
      }).join("");
    }

    el("bEventImpact").innerHTML = teams.map(function (team) {
      var history = historyAt(team, selectedTurn);
      var reactions = event ? eventReactionText(history, event.id) : [];
      var conditionals = history && history.report ? (history.report.events || []).filter(function (ev) {
        return ev.id !== (event && event.id);
      }) : [];
      var text = !history ? "아직 결정하지 않음" : (reactions.join(" · ") || (event ? "추가 완화 조건 없음 · 공통 기본 충격 적용" : "사건 없음"));
      if (conditionals.length) text += " · 팀별 추가 사건: " + conditionals.map(function (ev) { return ev.title || ev.id; }).join(", ");
      return "<div class='fac-event__reaction' data-testid='fac-event-reaction' data-event-id='" +
        esc(event ? event.id : "none") + "' data-team='" + esc(team.name) + "'>" +
        "<b style='color:" + teamColor(team.name) + "'>" + esc(team.name) + "</b> · " + esc(text) + "</div>";
    }).join("") || "<p class='hint'>결정이 들어오면 조별 적용 이유가 표시됩니다.</p>";
  }

  /* ============================================================
     연도가 흐릅니다 — 결정을 잠근 뒤, 빔에서 한 번만 도는 연출

     ★ 조별 노트북에서 각자 돌리지 않습니다. 여기가 유일한 자리입니다.
       한 줄씩 올라오는 동안 진행자는 아무 말도 하지 않습니다.
     ============================================================ */
  var lapseTimer = null;
  var lapseShownFor = -1;

  /* 이 국면에서 흐를 것들 — 조가 한 일, 경쟁사가 한 일, 시장에서 벌어진 일 */
  function lapseLines(teams, turn) {
    var lines = [];

    teams.forEach(function (team, i) {
      var history = historyAt(team, turn);
      if (!history) return;
      var top = Object.keys(history.allocation || {})
        .filter(function (k) { return history.allocation[k] > 0; })
        .sort(function (a, b) { return history.allocation[b] - history.allocation[a]; })[0];
      if (!top) return;
      var era = window.DRB_ERAS[timeline[turn].round.era];
      var item = (window.DRB_INVESTMENTS[era.investSet] || []).filter(function (x) { return x.id === top; })[0];
      if (!item) return;
      lines.push({
        kind: "team", order: i,
        who: team.name, color: teamColor(team.name),
        text: item.name + "에 " + history.allocation[top]
      });
    });

    /* 시장에서 벌어진 일 — 모든 조에게 온 사건만 (조건부 사건은 그 조 것이라 뺍니다) */
    var sub = timeline[turn].sub;
    if (sub.event && window.DRB_EVENTS[sub.event]) {
      var ev = window.DRB_EVENTS[sub.event];
      lines.push({ kind: "market", order: 20, who: "시장", text: ev.headline || ev.title });
    }

    lines.sort(function (a, b) { return a.order - b.order; });
    return lines;
  }

  function stopLapse() {
    if (lapseTimer) { clearInterval(lapseTimer); lapseTimer = null; }
  }

  function renderLapse(teams) {
    var here = timeline[selectedTurn];
    var next = timeline[selectedTurn + 1];
    if (!next) return null;

    var from = here.sub.year;
    var to = next.sub.year;
    var years = Math.max(1, to - from);
    var lines = lapseLines(teams, selectedTurn);

    /* 줄마다 '몇 년쯤에 벌어진 일인지' 를 붙입니다. 기간에 고르게 뿌립니다.
       숫자가 그 해를 지날 때 그 줄이 올라옵니다. */
    lines.forEach(function (line, i) {
      line.year = from + Math.max(1, Math.round((i + 1) * years / (lines.length + 1)));
    });

    el("bLapseSpan").textContent = years + "년이 흐릅니다";
    el("bLapseYear").textContent = from;
    el("bLapseFrom").textContent = from;
    el("bLapseTo").textContent = to;
    el("bLapseFill").style.width = "0%";
    el("bLapseFeed").innerHTML = "";
    el("bLapseNote").textContent = lines.length
      ? "결정의 결과가 흐르고 있습니다"
      : "아직 들어온 결정이 없습니다";

    return { from: from, to: to, years: years, lines: lines };
  }

  /* 챕터에 들어온 순간 한 번 돕니다. 되돌아왔다 다시 오면 다시 돕니다. */
  function startLapse() {
    stopLapse();
    var plan = renderLapse(collectTeams());
    if (!plan) return;

    var box = el("bLapseYear");
    var feed = el("bLapseFeed");
    var year = plan.from;

    /* ★ 한 해에 한 칸입니다. 기간이 길수록 그만큼 오래 걸립니다 —
         20년과 11년이 같은 시간에 지나가면 '뒤로 갈수록 빨라진다' 가 사라집니다.
         다만 20년 × 340ms = 7초 라 진행자가 기다릴 만한 길이입니다. */
    var TICK = 340;

    function put(line) {
      var row = document.createElement("div");
      row.className = "fac-lapse__line fac-lapse__line--" + line.kind;
      row.innerHTML =
        "<span class='fac-lapse__year'>" + line.year + "</span>" +
        "<span class='fac-lapse__who'" + (line.color ? " style='color:" + line.color + "'" : "") + ">" +
        esc(line.who) + "</span>" +
        "<span class='fac-lapse__what'>" + esc(line.text) + "</span>";
      feed.appendChild(row);
    }

    lapseTimer = setInterval(function () {
      year += 1;
      box.textContent = year;
      /* 애니메이션을 다시 태우려면 한 번 껐다 켜야 합니다 */
      box.classList.remove("is-tick");
      void box.offsetWidth;
      box.classList.add("is-tick");

      el("bLapseFill").style.width =
        Math.round((year - plan.from) / plan.years * 100) + "%";

      plan.lines.forEach(function (line) {
        if (line.year === year) put(line);
      });

      if (year >= plan.to) {
        stopLapse();
        /* 아직 못 올라간 줄이 있으면 마지막에 다 붙입니다 */
        plan.lines.forEach(function (line) {
          if (line.year > plan.to) put(line);
        });
        el("bLapseNote").textContent = plan.to + "년입니다";
      }
    }, TICK);
  }

  /* 국면 결과 — 이 국면의 매출로 줄을 세웁니다. */
  function renderPhaseResult(teams) {
    var item = timeline[selectedTurn];
    var next = timeline[selectedTurn + 1];

    el("bPhaseEra").textContent = "ERA " + item.round.no;
    el("bPhaseYears").textContent = next ? item.sub.year + " → " + next.sub.year : String(item.sub.year);

    var played = teams.map(function (team) {
      var h = historyAt(team, selectedTurn);
      return h ? { name: team.name, revenue: (h.report.kpi.revenue || 0), h: h } : null;
    }).filter(Boolean).sort(function (a, b) { return b.revenue - a.revenue; });

    el("bPhaseState").textContent = played.length + " / " + teams.length + "조 완료";

    if (!played.length) {
      el("bPhaseCards").style.cssText = "";
      el("bPhaseCards").innerHTML = "<p class='fac-decision-cards__empty'>이 국면을 마친 조가 아직 없습니다.</p>";
      return;
    }

    /* 한 장에 : 어디에 얼마를 걸었나(자원 배분) · 얼마를 벌었나(매출) · 어떤 전략이었나 */
    el("bPhaseCards").style.cssText = cardColumns(played.length);
    el("bPhaseCards").innerHTML = played.map(function (r, i) {
      var alloc = topIds(r.h.allocation, 3).map(function (a) {
        return "<div class='phasecard__row'><span>" + esc(investName(a.id)) +
               "</span><b class='num'>" + a.amount + "</b></div>";
      }).join("") || "<div class='phasecard__row is-none'><span>투자 없음 · 전액 보유</span></div>";

      return "<div class='phasecard" + (i === 0 ? " phasecard--first" : "") + "'>" +
        "<div class='phasecard__head'>" +
          "<span class='phasecard__no num'>" + (CFG.teamNames.indexOf(r.name) + 1) + "</span>" +
          "<span class='phasecard__name'>" + esc(r.name) + "</span>" +
          "<span class='phasecard__rank'>" + (i + 1) + "위</span>" +
        "</div>" +
        "<div class='phasecard__alloc'>" + alloc + "</div>" +
        "<div class='phasecard__value num'>" + fmt(r.revenue) + "</div>" +
        "<div class='phasecard__unit'>매출 · 억</div>" +
        "<div class='phasecard__tags'><span class='phasetag'>" +
          esc(policyName(r.h.policyId, r.h.policyName)) + "</span>" +
          "<span class='phasetag phasetag--style'>" + esc(styleOf(
            teams.filter(function (t) { return t.name === r.name; })[0] || { state: {} }
          )) + "</span></div>" +
      "</div>";
    }).join("");
  }

  /* 경쟁 현황 — 국면마다 순위가 어떻게 바뀌었는가 */
  function renderStandings(teams) {
    var upto = Math.min(selectedTurn + 1, timeline.length);
    el("bStandProgress").textContent = upto + "국면까지 진행";

    var cols = [];
    for (var t = 0; t < upto; t++) {
      cols.push(teams.map(function (team) {
        var h = historyAt(team, t);
        return h ? { name: team.name, v: h.report.kpi.revenue || 0 } : null;
      }).filter(Boolean).sort(function (a, b) { return b.v - a.v; }));
    }

    var grid = el("bRankGrid");
    if (!cols.length || !cols[0].length) {
      grid.innerHTML = "<p class='hint'>아직 완료된 국면이 없습니다.</p>";
    } else {
      var cssCols = "grid-template-columns:64px repeat(" + cols.length + ",minmax(0,1fr))";
      var html = "<div class='rankgrid__row rankgrid__head' style='" + cssCols + "'><span>순위</span>" +
        cols.map(function (_, i) { return "<span>" + (i + 1) + "국면</span>"; }).join("") + "</div>";

      for (var pos = 0; pos < teams.length; pos++) {
        html += "<div class='rankgrid__row' style='" + cssCols + "'>" +
          "<span class='rankgrid__pos'>" + (pos + 1) + "위</span>" +
          cols.map(function (col) {
            var cell = col[pos];
            if (!cell) return "<span class='rankgrid__cell is-empty'></span>";
            return "<span class='rankgrid__cell num" + (pos === 0 ? " is-lead" : "") + "'>" +
                   (CFG.teamNames.indexOf(cell.name) + 1) + "</span>";
          }).join("") +
        "</div>";
      }
      grid.innerHTML = html;
    }

    /* 지금 앞선 조 — 누적 매출 */
    var cumulative = teams.map(function (team) {
      var sum = (team.history || []).reduce(function (a, h) { return a + (h.report.kpi.revenue || 0); }, 0);
      return { name: team.name, sum: sum };
    }).sort(function (a, b) { return b.sum - a.sum; });

    var lead = cumulative[0];
    el("bLeadCard").innerHTML = (!lead || !lead.sum)
      ? "<p class='hint'>아직 기록이 없습니다.</p>"
      : "<span class='leadcard__no num'>" + (CFG.teamNames.indexOf(lead.name) + 1) + "</span>" +
        "<div><div class='leadcard__name'>" + esc(lead.name) + "</div>" +
        "<div class='leadcard__sub'>누적 매출 " + fmt(lead.sum) + "억</div></div>";

    el("bTitleList").innerHTML = buildTitles(teams).map(function (row) {
      return "<div class='titlerow" + (row.fact ? " titlerow--fact" : "") + "'>" +
        "<span class='titlerow__name'>" + esc(row.name) + "</span>" +
        "<span class='titlerow__team'>" + esc(row.team || "—") + "</span>" +
      "</div>";
    }).join("");
  }

  /* 국면 타이틀 — 순위와 다른 축입니다. 한 조가 다 가져가지 않습니다. */
  function buildTitles(teams) {
    function best(fn) {
      var rows = teams.map(function (team) { return { name: team.name, v: fn(team) }; })
                      .filter(function (r) { return r.v > 0; })
                      .sort(function (a, b) { return b.v - a.v; });
      return rows.length ? rows[0].name : "";
    }
    return [
      { name: "가장 크게 성장", team: best(function (t) {
          var h = t.history || [];
          if (h.length < 2) return 0;
          return (h[h.length - 1].report.kpi.revenue || 0) - (h[0].report.kpi.revenue || 0);
        }) },
      { name: "가장 단단한 재무", team: best(function (t) { return t.state.cash || 0; }) },
      { name: "돌발에 가장 강했다", team: best(function (t) { return adaptiveOf(t); }) },
      { name: "DRB와 같은 선택", team: sameAsDrb(teams), fact: true }
    ];
  }

  /* DRB 기록이 실제로 고른 분야에 가장 크게 건 조 */
  function sameAsDrb(teams) {
    var item = timeline[selectedTurn];
    var actual = window.DRB_ACTUAL[item.round.actualId];
    if (!actual || !actual.filled || !actual.matchInvest) return "";
    var hit = teams.map(function (team) {
      var h = historyAt(team, selectedTurn);
      if (!h) return null;
      var top = topIds(h.allocation, 1)[0];
      return top && top.id === actual.matchInvest ? team.name : null;
    }).filter(Boolean);
    return hit.length ? hit.join(" · ") : "";
  }

  function renderActual(teams) {
    var item = timeline[selectedTurn];
    var actual = window.DRB_ACTUAL[item.round.actualId];
    var complete = allCompletedRound(teams, item.round);
    var revealed = isRevealed(item.round.id);

    /* ★ 공개 시점은 진행자가 정합니다. 버튼을 잠그지 않습니다.
         아직 진행 중인 조가 있으면 알려만 주고, 누르면 열립니다. */
    el("bActualLock").classList.toggle("is-unlocked", revealed);
    el("btnRevealActual").disabled = false;
    el("bLockTitle").textContent = "조별 판단을 먼저 들어보세요";
    el("bLockText").textContent = complete
      ? "모든 조가 이 시대를 마쳤습니다. 조별 판단을 말하게 한 뒤 누르세요. 유사도나 정답으로 평가하지 않습니다."
      : (teams.length
          ? "아직 이 시대를 진행 중인 조가 있습니다. 그래도 지금 열 수 있습니다."
          : "준비되면 누르세요.");
    el("bActual").dataset.roundId = item.round.id;
    el("bActualWhen").textContent = item.sub.year + " · 검증된 기록";

    if (!revealed) {
      /* 잠긴 기록은 DOM 에도 넣지 않아 개발자도구·스크린리더 누출을 막습니다 */
      el("bActualTitle").textContent = "참가자 판단과 DRB 기록 비교";
      el("bDrbCards").innerHTML = "";
      el("bDrbTimeline").innerHTML = "";
      el("bDrbChips").innerHTML = "";
      return;
    }

    el("bActualTitle").innerHTML = actual.headline
      ? esc(actual.headline).split("|").join("<br>")
      : "그때 DRB는<br>이렇게 했습니다";

    el("bDrbCards").innerHTML = [
      ["당시 상황", actual.situation],
      ["실제 선택", actual.choice],
      ["그 결과", actual.result]
    ].filter(function (pair) { return pair[1]; }).map(function (pair) {
      return "<div class='drbcard'>" +
        "<div class='drbcard__label'>" + esc(pair[0]) + "</div>" +
        "<div class='drbcard__body'>" + esc(pair[1]) + "</div>" +
      "</div>";
    }).join("");

    /* 연표는 분기점(key)만. 빔에 12줄을 띄우면 아무도 읽지 않습니다. */
    el("bDrbTimeline").innerHTML = (actual.timeline || [])
      .filter(function (m) { return m.key; }).slice(0, 4).map(function (m) {
        return "<div class='fac-drb__milestone'><div class='fac-drb__year num'>" +
               esc(m.year) + "</div>" + esc(m.text) + "</div>";
      }).join("");

    /* 어느 조가 같은 선택을 했는가 */
    var same = [], diff = [];
    teams.forEach(function (team) {
      if (!completedRound(team, item.round)) return;
      var h = historyAt(team, selectedTurn);
      var top = h ? topIds(h.allocation, 1)[0] : null;
      if (actual.matchInvest && top && top.id === actual.matchInvest) same.push(team.name);
      else diff.push(team.name);
    });
    var chips = "";
    if (same.length) chips += "<span class='drbchip drbchip--same'>" + esc(same.join("·")) + "와 같은 선택</span>";
    if (diff.length) chips += "<span class='drbchip'>" + esc(diff.join("·")) + "는 달랐다</span>";
    el("bDrbChips").innerHTML = chips;
  }

  function renderMap(teams) {
    /* 지도는 이미지 한 장입니다 (assets/img/worldmap.webp).
       핀 위치는 data/global.js 의 map.x / map.y 백분율이고, 그 값은 이 이미지
       기준으로 맞춰져 있습니다. 지도를 바꾸면 좌표도 같이 맞춰야 합니다. */
    var box = el("bMap");
    box.innerHTML = "<div class='bigmap__frame'></div>";
    var frame = box.firstChild;
    var regions = {};
    function add(region, team, stage) { if (!regions[region]) regions[region] = []; regions[region].push({ name: team.name, color: teamColor(team.name), stage: stage }); }
    teams.forEach(function (team) {
      add(G.home.id, team, "running");
      (team.state.sites || []).forEach(function (site) { add(site.country, team, site.stage); });
    });
    [{ id: G.home.id, name: G.home.name, map: G.home.map }].concat((G.countries || []).map(function (c) { return { id: c.id, name: c.name, map: c.map }; })).forEach(function (place) {
      var node = document.createElement("div");
      node.className = "region" + (place.id === G.home.id ? " region--home" : "");
      node.style.left = place.map.x + "%";
      node.style.top = place.map.y + "%";
      /* 지도 그림에 이미 대륙 이름이 박혀 있습니다. 아무도 없는 지역까지
         이름을 얹으면 "유럽" 이 두 번 나옵니다 — 조가 있는 곳만 이름을 답니다. */
      var pins = regions[place.id] || [];
      node.innerHTML = (pins.length ? "<div class='region__name'>" + esc(place.name) + "</div>" : "") +
        "<div class='region__pins'>" + pins.map(function (pin) {
        return "<span class='pin" + (pin.stage === "build" ? " pin--build" : "") + "'><span class='pin__dot' style='background:" + pin.color + "'></span>" + esc(pin.name) + "</span>";
      }).join("") + "</div>";
      frame.appendChild(node);
    });
    var sites = teams.reduce(function (sum, team) { return sum + (team.state.sites || []).length; }, 0);
    el("bBar").innerHTML = "<span class='boardbar__item'><span class='boardbar__k'>참가 조</span><span class='boardbar__v'>" + teams.length + "</span></span>" +
      "<span class='boardbar__item'><span class='boardbar__k'>해외 거점</span><span class='boardbar__v'>" + sites + "</span></span><span class='spacer'></span><span class='hint'>점선은 건설 중 · 실선은 가동 중</span>";
    el("bNewsCount").textContent = teams.reduce(function (sum, team) { return sum + team.turns; }, 0) + "개 결정";
  }

  /* ============================================================
     맺음말 — 한 글자씩

     빔 앞에서 읽어주는 마지막 말입니다. 문구는 config 의 closing 에 있습니다.
     5초마다 도는 폴링이 render() 를 다시 부르므로, 한 번 시작하면
     다시 시작하지 않게 잠가둡니다. 처음부터 다시 보려면 버튼을 누릅니다.
     ============================================================ */
  var closing = { timer: null, running: false, done: false };

  function closingLines() { return (CFG.closing && CFG.closing.lines) || []; }

  /* ============================================================
     회사 사진 — 맺음말 바로 앞, 한 장씩 흐릅니다

     ★ 영상 파일이 아니라 사진입니다. 인코딩이 필요 없고, People팀이
       사진만 갈아 끼울 수 있습니다 (tools/endingphotos.js).
       한 장이 머무는 시간은 config 의 closing.photoMs.
     ============================================================ */
  var film = { timer: null, at: -1 };

  function endingPhotos() {
    return (window.DRB_ENDING_PHOTOS || []).filter(function (p) { return p && p.src; });
  }

  function stopFilm() {
    if (film.timer) { clearTimeout(film.timer); film.timer = null; }
  }

  function startFilm() {
    stopFilm();
    var photos = endingPhotos();
    var stage = el("bFilmStage");
    if (!stage || !photos.length) return;

    stage.innerHTML = "";
    film.at = -1;

    /* 두 장을 겹쳐 두고 번갈아 띄웁니다 — 갈아끼우면 화면이 한 번 깜빡입니다 */
    var layers = [document.createElement("div"), document.createElement("div")];
    layers.forEach(function (n) { n.className = "fac-film__shot"; stage.appendChild(n); });

    var hold = (CFG.closing && CFG.closing.photoMs) || 2000;
    /* ★ 겹쳐 넘어가는 시간과 확대 시간을 머무는 시간에서 뽑습니다.
         CSS 에 고정해두면 photoMs 를 줄였을 때 앞 장이 다 사라지기도 전에
         다음 장이 오고, 확대는 시작만 하다 끝납니다.
         확대는 한 장의 수명보다 조금 길게 둡니다 — 멈춘 채 떠나면 사진처럼 보입니다. */
    var fade = Math.max(220, Math.min(600, Math.round(hold * 0.3)));
    var zoom = hold + fade;

    function show() {
      film.at += 1;
      if (film.at >= photos.length) return;   /* 마지막 장은 그대로 둡니다 */

      var photo = photos[film.at];
      var next = layers[film.at % 2];
      var prev = layers[(film.at + 1) % 2];

      next.style.backgroundImage = "url('" + photo.src + "')";
      /* ★ 사진마다 어디를 보여줄지 — 사람이 위쪽에 서 있는 사진은 가운데를 맞추면
           얼굴이 잘려나갑니다. data/endingphotos.js 의 focus 로 정합니다. */
      next.style.backgroundPosition =
        photo.focus === "top" ? "center top" :
        photo.focus === "bottom" ? "center bottom" : "center";
      next.style.transitionDuration = fade + "ms";
      prev.style.transitionDuration = fade + "ms";
      next.style.animationDuration = zoom + "ms";
      /* 확대 방향을 번갈아 — 같은 방향으로만 밀면 슬라이드쇼처럼 보입니다 */
      next.classList.remove("is-on", "is-zoom-a", "is-zoom-b");
      void next.offsetWidth;
      next.classList.add("is-on", film.at % 2 ? "is-zoom-b" : "is-zoom-a");
      prev.classList.remove("is-on");

      el("bFilmCaption").textContent = photo.caption || "";

      film.timer = setTimeout(show, hold);
    }
    show();
  }

  /* ★ 스무 줄을 한 화면에 다 쌓으면 글자가 34px 을 넘을 수 없습니다.
       마지막 화면인데 본문보다 조금 큰 정도로는 아무 일도 일어나지 않습니다.

       그래서 쌓지 않고 '연(聯)' 단위로 한 덩어리씩 크게 띄웁니다.
       config 의 closing.lines 에서 빈 줄("")이 연을 나누는 자리입니다 —
       이미 그렇게 적혀 있던 것을 그대로 씁니다.
       마지막 연은 화면에 단둘이 남습니다. 그게 이 교육의 마지막 문장입니다. */
  function closingStanzas() {
    var out = [], cur = [];
    closingLines().forEach(function (line) {
      if (line) { cur.push(line); return; }
      if (cur.length) { out.push(cur); cur = []; }
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function startClosing() {
    if (closing.running || closing.done) return;
    var stanzas = closingStanzas();
    var box = el("bClosing");
    if (!box || !stanzas.length) return;

    closing.running = true;
    box.innerHTML = "";
    box.classList.remove("is-all");
    el("bClosingHint").textContent = "화면을 누르면 한 번에 다 보입니다";

    var charMs = (CFG.closing && CFG.closing.charMs) || 55;
    var lineMs = (CFG.closing && CFG.closing.lineMs) || 700;
    /* 연과 연 사이는 한 줄 사이보다 깁니다 — 읽고 나서 숨 쉴 자리입니다 */
    var stanzaMs = lineMs * 2.4;

    var si = 0, li = 0, ci = 0, node = null;

    function step() {
      if (si >= stanzas.length) { finishClosing(true); return; }
      var lines = stanzas[si];

      if (li >= lines.length) {
        /* 이 연을 다 읽었습니다. 마지막 연이면 그대로 두고 끝냅니다. */
        si++; li = 0; node = null;
        if (si >= stanzas.length) { closing.timer = setTimeout(step, stanzaMs); return; }
        closing.timer = setTimeout(function () {
          box.classList.add("is-out");
          closing.timer = setTimeout(function () {
            box.innerHTML = "";
            box.classList.remove("is-out");
            step();
          }, 320);
        }, stanzaMs);
        return;
      }

      var text = lines[li];
      if (!node) {
        node = document.createElement("p");
        node.className = "closing__line";
        box.appendChild(node);
      }
      if (ci < text.length) {
        node.textContent = text.slice(0, ++ci);
        closing.timer = setTimeout(step, charMs);
      } else {
        li++; ci = 0; node = null;
        closing.timer = setTimeout(step, lineMs);
      }
    }
    step();
  }

  /* 클릭하면 남은 것을 한 번에 — 시간이 없을 때 씁니다.
     이때는 스무 줄이 다 나오므로 글자를 작게 돌립니다 (is-all). */
  function finishClosing(natural) {
    clearTimeout(closing.timer);
    closing.timer = null;
    closing.running = false;
    closing.done = true;
    var box = el("bClosing");
    if (!natural) {
      box.classList.add("is-all");
      box.classList.remove("is-out");
      box.innerHTML = closingLines().map(function (line) {
        return "<p class='closing__line" + (line ? "" : " is-gap") + "'>" + esc(line) + "</p>";
      }).join("");
    }
    el("bClosingHint").textContent = "여러분의 80년은 오늘부터 시작합니다";
  }

  function replayClosing() {
    clearTimeout(closing.timer);
    closing = { timer: null, running: false, done: false };
    startClosing();
  }

  /* 연결 상태 — 세션이 없으면 조용히 비어 있지 않고 크게 알립니다 */
  function renderStatus(teams) {
    var connected = teams.filter(function (team) { return team.source === "live"; }).length;
    var live = window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession();

    /* 빔에 긴 경고문을 띄우지 않습니다. 작은 칩만 두고 자세한 내용은 도구 안에. */
    var warn = el("bNoSession");
    warn.classList.toggle("hidden", !!live);
    warn.textContent = live ? "" : "⚠ 세션 없음";
    el("bSessionDetail").innerHTML = live ? "" :
      "<div class='fac-nosession-detail'><b>교육 세션이 없습니다.</b> 지금은 이 브라우저에 저장된 기록만 보입니다. " +
      "다른 PC·태블릿의 조를 보려면 <b>[교육 세션 만들기]</b> 를 누르고 참가 주소와 조별 코드를 나눠주세요.</div>";

    el("bSessionStatus").textContent = connected ? "실시간 연결" : (live ? "연결 대기" : "세션 없음");
    el("bSessionStatus").classList.toggle("fac-session__status--paused", !connected);
    el("bSync").textContent = connected ? "LIVE " + connected + "조" : (live ? "연결 대기" : "로컬 모드");
    el("bSync").classList.toggle("chip--accent", connected > 0);
    el("bSessionMeta").innerHTML = "<span class='fac-session__meta'>참가 " + teams.length +
      "조 · 라이브 " + connected + "조 · 5초마다 자동 갱신</span>";
    el("bTeamStatus").innerHTML = teams.map(function (team) {
      var pos = team.finished ? "전체 완료" : (team.turns + " / " + timeline.length + "회 완료 · " + phaseLabel(team.phase));
      return "<div class='fac-session__team'><div class='fac-session__team-name' style='color:" +
        teamColor(team.name) + "'>" + esc(team.name) + "</div><div class='fac-session__team-state'>" +
        esc(pos) + "</div></div>";
    }).join("") || "<p class='hint'>참가 조가 아직 없습니다.</p>";
    el("bCompletion").innerHTML = teams.map(function (team) {
      return "<div class='breakdown__row'><span class='breakdown__label'>" + esc(team.name) +
        "</span><span class='breakdown__value'>" + team.turns + " / " + timeline.length + "</span></div>";
    }).join("") || "<p class='hint'>진행 데이터 없음</p>";
  }

  function phaseLabel(phase) {
    return { roundOpen: "시대 브리핑", situation: "상황 확인", invest: "자원 배분", policy: "정책 선택", timelapse: "결과 계산", result: "결과 확인", actual: "DRB 비교", ending: "마무리", final: "완료" }[phase] || phase || "대기";
  }

  function teamDetail(name) {
    var team = collectTeams().filter(function (t) { return t.name === name; })[0];
    if (!team) return;
    var h = historyAt(team, selectedTurn);
    var bars = (CFG.metrics || []).map(function (m) {
      var value = team.state[m.key] || 0;
      var pct = Math.max(0, Math.min(100, (value / m.max) * 100));
      return "<div class='breakdown__row'><span class='breakdown__label'>" + esc(m.name) +
        "</span><span class='breakdown__value num'>" + fmt(value) + "</span></div>" +
        "<div class='fac-team__bar'><span style='width:" + pct + "%'></span></div>";
    }).join("");
    openModal(name + " · " + styleOf(team),
      "<p class='hint'>" + (h
        ? esc(topAlloc(h.allocation, 4).join(" · ")) + " · 정책 " + esc(policyName(h.policyId, h.policyName))
        : "이번 국면은 아직 확정하지 않았습니다") + "</p>" +
      "<div class='breakdown'>" + bars +
      "<div class='breakdown__row'><span class='breakdown__label'><b>변화 대응력</b> · 참가자에게는 마지막에만 보입니다</span>" +
      "<span class='breakdown__value num'>" + adaptiveOf(team) + "</span></div>" +
      "<div class='breakdown__row'><span class='breakdown__label'><b>종합</b> · 경쟁력 + 변화 대응력</span>" +
      "<span class='breakdown__value num'>" + totalScore(team) + "</span></div></div>");
  }


  /* ============================================================
     그리기 · 넘기기
     ============================================================ */
  function render() {
    var teams = collectTeams();
    var live = !!(window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession());
    updateProgress(teams);
    renderTeamStrip(teams, live);
    renderChapterBar();
    renderBrief();
    renderDecisions(teams);
    renderEvent(teams);
    renderActual(teams);
    renderStatus(teams);
    renderMap(teams);
    renderCover(teams);
    renderHowto();
    renderPhaseResult(teams);
    renderStandings(teams);
    renderCrowd(teams);
    renderAward(teams);
    renderReflection(teams);
    renderDrive(teams);
    publishAwards(teams);
    if (clock.turn !== selectedTurn) resetClock();
    paintClock();
    showStage(currentStage, false);
  }

  function showStage(stage, publish) {
    if (STAGES.indexOf(stage) < 0) return;
    currentStage = stage;
    document.querySelectorAll("[data-stage-panel]").forEach(function (panel) {
      panel.classList.toggle("hidden", panel.dataset.stagePanel !== stage);
    });
    document.querySelectorAll("[data-stage]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.stage === stage);
    });
    /* ★ 순위·시상 화면은 참가자에게 내보내지 않습니다.
       참가자 화면은 마지막까지 "순위를 매기지 않습니다" 를 유지해야 합니다. */
    if (publish && LOCAL_STAGES.indexOf(stage) < 0 &&
        window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession()) {
      window.DRBLive.control({ currentTurn: selectedTurn, stage: stage }).catch(function () {});
    }
    /* ★ 배경음악은 이 화면에서만 납니다 (교육장에 스피커는 하나여야 합니다).
         곡은 챕터를 따라갑니다 — 어느 챕터가 어느 곡인지는 config 의 musicByScreen. */
    if (window.DRBAudio) {
      window.DRBAudio.scene(stage);
      window.DRBAudio.duck(stage === "event");
    }

    /* ★ 돌발상황은 경고를 한 박자 띄우고 내용을 엽니다.
         내용부터 띄우면 진행자가 읽기 시작할 때 조들은 아직 화면을 찾고 있습니다.
         알람도 이때 한 번 울립니다 — 고개를 드는 순간을 만드는 것이 목적입니다. */
    if (stage === "event" && lastAlarmStage !== stage + selectedTurn) {
      lastAlarmStage = stage + selectedTurn;
      flashShock();
    }

    /* 맺음말 화면에 들어온 순간 글자가 찍히기 시작합니다 */
    if (stage === "closing") startClosing();

    /* 연도 연출은 이 챕터에 '들어오는 순간' 한 번 돕니다.
       render() 가 같은 챕터로 여러 번 불려도 다시 시작하지 않아야 하고,
       다른 챕터에 갔다 돌아오면 다시 돌아야 합니다 (진행자가 되돌릴 수 있어야 하므로). */
    if (stage === "lapse") {
      if (lastStageShown !== "lapse" || lapseShownFor !== selectedTurn) {
        lapseShownFor = selectedTurn;
        startLapse();
      }
    } else {
      stopLapse();
    }

    /* 사진도 들어오는 순간 한 번 돕니다. 되돌아오면 처음부터 다시 흐릅니다. */
    if (stage === "finale") {
      if (lastStageShown !== "finale") startFilm();
    } else {
      stopFilm();
    }

    lastStageShown = stage;
  }

  var lastStageShown = "";

  /* 돌발상황 알람은 한 국면에 한 번만 — 챕터를 되돌아왔다고 다시 울리지 않습니다 */
  var lastAlarmStage = "";
  var shockTimer = null;

  /* 경고를 띄우고 나서 내용을 엽니다. 그동안 알람이 울립니다.
     몇 초 머무는지는 config 의 event.alertMs 에서 바꿉니다 — 짧으면 못 보고,
     길면 진행자가 할 말 없이 서 있게 됩니다. */
  function flashShock() {
    var alert = el("bEventAlert");
    var card = el("bEvent");
    if (!alert || !card) return;
    clearTimeout(shockTimer);

    alert.classList.add("is-on");
    card.classList.add("is-hushed");
    if (window.DRBAudio) window.DRBAudio.alarm();

    shockTimer = setTimeout(function () {
      alert.classList.remove("is-on");
      card.classList.remove("is-hushed");
    }, (CFG.event && CFG.event.alertMs) || 3000);
  }

  function jumpTo(stage) {
    currentStage = stage;
    render();
    showStage(stage, true);
  }


  /* ============================================================
     세션 · 결과 코드
     ============================================================ */
  function parseCode(code) {
    try { return JSON.parse(decodeURIComponent(escape(atob(code.trim())))); }
    catch (err) { return null; }
  }
  function openPaste() {
    openModal("다른 PC 조의 결과 코드 받기", "<p class='hint'>완료 화면에서 복사한 결과 코드를 붙여넣으세요. 지역·진입 방식과 돌발상황 반응까지 복원됩니다.</p><textarea class='textarea' id='pasteInput' style='min-height:150px'></textarea><div class='row' style='margin-top:var(--sp-4)'><button class='btn btn--primary' id='pasteOk'>결과 추가</button></div>");
    el("pasteOk").onclick = function () {
      var payload = parseCode(el("pasteInput").value);
      if (!payload || !payload.t || !payload.s || !Array.isArray(payload.p)) { toast("올바른 결과 코드가 아닙니다."); return; }
      var list = readJson(PASTED_KEY, []).filter(function (item) { return item.t !== payload.t; });
      list.push(payload);
      writeJson(PASTED_KEY, list);
      closeModal();
      toast(payload.t + " 결과를 추가했습니다.");
      render();
    };
    setTimeout(function () { el("pasteInput").focus(); }, 0);
  }

  function openSession() {
    var creds = window.DRBLive && window.DRBLive.facilitatorCredentials ? window.DRBLive.facilitatorCredentials() : null;
    if (creds) { showSessionDetails(creds); return; }
    openModal("실시간 교육 세션 만들기",
      "<p class='hint'>조별 노트북이 서로 다른 PC여도 5초 이내에 결정과 돌발상황 반응을 모읍니다.</p>" +
      "<label class='field-label' for='sessionTeamCount'>참가 조 수</label>" +
      "<select class='select' id='sessionTeamCount'>" +
      "<option>2</option><option selected>3</option><option>4</option><option>5</option><option>6</option></select>" +
      "<div class='sessionfail hidden' id='sessionFail'></div>" +
      "<div class='row' style='margin-top:var(--sp-4)'>" +
      "<button class='btn btn--primary btn--lg' id='sessionCreate'>세션 코드 만들기</button></div>");

    el("sessionCreate").onclick = function () {
      var fail = el("sessionFail");
      fail.classList.add("hidden");
      if (!window.DRBLive) { fail.classList.remove("hidden"); fail.textContent = "라이브 모듈을 불러오지 못했습니다."; return; }
      el("sessionCreate").disabled = true;
      el("sessionCreate").textContent = "만드는 중…";
      window.DRBLive.create({
        teamCount: Number(el("sessionTeamCount").value)
      }).then(function (created) {
        showSessionDetails(created);
        startLivePolling();
      }).catch(function (err) {
        /* ★ 토스트로만 알리면 2초 뒤에 사라져 "그냥 안 되네" 로 보입니다.
             실패는 눌렀던 자리에 그대로 남겨둡니다. */
        el("sessionCreate").disabled = false;
        el("sessionCreate").textContent = "다시 시도";
        fail.classList.remove("hidden");
        fail.innerHTML = "<b>세션을 만들지 못했습니다.</b><br>" + esc(err.message || "알 수 없는 오류") +
          "<br><span class='hint'>계속 실패하면 새로고침 후 다시 눌러보세요.</span>";
      });
    };
  }

  function showSessionDetails(creds) {
    /* 링크는 하나입니다. 조는 각자 자기 코드를 칩니다. */
    var base = location.origin + location.pathname.replace(/(?:facilitator(?:\.html)?|index\.html)?$/, "");
    var joinUrl = base + "play?s=" + encodeURIComponent(creds.sessionId);

    var codes = (CFG.teamNames || []).slice(0, creds.teamCount || 6).map(function (name) {
      var code = creds.teamClaims && creds.teamClaims[name];
      if (!code) {
        return "<div class='joincode joincode--missing'><b>" + esc(name) + "</b>" +
               "<span class='hint'>참가 코드 없음 · 새 세션을 만들어주세요</span></div>";
      }
      return "<div class='joincode'>" +
        "<span class='joincode__team'>" + esc(name) + "</span>" +
        "<span class='joincode__value num'>" + esc(code) + "</span>" +
        "<button class='btn btn--sm btn--ghost fac-team-reset' type='button' data-team='" + esc(name) + "'>자리 비우기</button>" +
      "</div>";
    }).join("");

    openModal("교육 세션 " + creds.sessionId,
      "<p class='hint'>아래 <b>주소 하나</b>를 모든 조에 알려주고, <b>조별 코드</b>는 빔 화면에 띄우세요.<br>" +
      "각 조가 자기 코드를 넣으면 그 조로 들어갑니다. 다른 조 코드로는 들어갈 수 없습니다.</p>" +

      "<div class='joinurl'><span class='joinurl__label'>참가 주소</span>" +
      "<span class='joinurl__value'>" + esc(joinUrl) + "</span>" +
      "<button class='btn btn--sm btn--primary' id='sessionCopy'>주소 복사</button></div>" +

      "<div class='fac-award__section-label' style='margin-top:var(--sp-5)'>조별 참가 코드</div>" +
      "<div class='joincodes'>" + codes + "</div>" +

      "<p class='hint' style='margin-top:var(--sp-4)'>자동 종료 : 만든 뒤 24시간 · 진행자 비밀키는 이 탭에만 저장됩니다. " +
      "탭을 닫으면 복구 링크가 필요합니다.</p>" +

      "<div class='row' style='margin-top:var(--sp-4)'>" +
      "<button class='btn btn--ghost' id='sessionCodesCopy'>코드표 복사</button>" +
      "<button class='btn btn--ghost' id='sessionRecovery'>진행자 복구 링크 복사</button>" +
      "<button class='btn btn--ghost' id='sessionEnd'>세션 종료·데이터 삭제</button></div>");

    el("sessionCodesCopy").onclick = function () {
      var text = "참가 주소  " + joinUrl + "\n\n" +
        (CFG.teamNames || []).slice(0, creds.teamCount || 6).map(function (name) {
          return name + "  " + ((creds.teamClaims && creds.teamClaims[name]) || "-");
        }).join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("주소와 코드표를 복사했습니다."); });
    };

    el("modalBody").querySelectorAll(".fac-team-reset").forEach(function (button) {
      button.onclick = function () {
        var teamName = button.dataset.team;
        openModal(teamName + " 재연결을 초기화할까요?", "<div class='card card--flat' style='border-color:var(--warn);box-shadow:inset 4px 0 var(--warn)'><b>" + esc(teamName) + "의 현재 연결과 실시간 진행 사본만 삭제됩니다.</b><br>기존 참가 화면은 더 이상 전송할 수 없고, 새 기기에서 같은 조 코드로 다시 들어와야 합니다.</div><p class='hint'>참가 기기 고장·브라우저 저장소 삭제 때만 사용하세요. 다른 조와 전체 세션에는 영향이 없습니다.</p><div class='row' style='margin-top:var(--sp-4)'><button class='btn btn--ghost' id='teamResetCancel'>취소하고 돌아가기</button><button class='btn btn--primary' id='teamResetConfirm'>" + esc(teamName) + " 재연결 초기화</button></div>");
        el("teamResetCancel").onclick = function () { showSessionDetails(creds); };
        el("teamResetConfirm").onclick = function () {
          el("teamResetConfirm").disabled = true;
          el("teamResetConfirm").textContent = "초기화 중…";
          window.DRBLive.resetTeam(teamName).then(function () {
            toast(teamName + " 자리를 비웠습니다. 그 조가 코드로 다시 들어올 수 있습니다.");
            showSessionDetails(creds);
          }).catch(function (error) {
            el("teamResetConfirm").disabled = false;
            el("teamResetConfirm").textContent = teamName + " 재연결 초기화";
            toast(error.message || "조 재연결 초기화에 실패했습니다.");
          });
        };
      };
    });
    el("sessionCopy").onclick = function () {
      if (navigator.clipboard) navigator.clipboard.writeText(joinUrl).then(function () { toast("참가 주소를 복사했습니다."); });
    };
    el("sessionRecovery").onclick = function () {
      var recoveryUrl;
      try { recoveryUrl = window.DRBLive.facilitatorRecoveryLink(); }
      catch (error) { toast(error.message || "복구 링크를 만들지 못했습니다."); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(recoveryUrl).then(function () {
        toast("진행자 복구 링크를 복사했습니다. 비밀번호처럼 안전하게 보관하세요.");
      });
    };
    el("sessionEnd").onclick = function () {
      openModal("세션을 영구 종료할까요?", "<div class='card card--flat' style='border-color:var(--bad);box-shadow:inset 4px 0 var(--bad)'><b>" + esc(creds.sessionId) + " 세션의 실시간 데이터가 즉시 삭제됩니다.</b><br>연결된 모든 조가 끊기며 이 작업은 되돌릴 수 없습니다.</div><p class='hint'>교육을 마쳤거나 잘못 만든 세션일 때만 삭제하세요.</p><div class='row' style='margin-top:var(--sp-4)'><button class='btn btn--ghost' id='sessionEndCancel'>취소하고 돌아가기</button><button class='btn btn--primary' id='sessionEndConfirm'>세션 영구 삭제</button></div>");
      el("sessionEndCancel").onclick = function () { showSessionDetails(creds); };
      el("sessionEndConfirm").onclick = function () {
        el("sessionEndConfirm").disabled = true;
        el("sessionEndConfirm").textContent = "삭제 중…";
        window.DRBLive.leave({ destroy: true }).then(function () {
          clearInterval(liveTimer);
          liveTimer = null;
          liveSnapshot = null;
          closeModal();
          render();
          toast("세션과 실시간 진행 데이터를 삭제했습니다.");
        }).catch(function (error) {
          el("sessionEndConfirm").disabled = false;
          el("sessionEndConfirm").textContent = "세션 영구 삭제";
          toast(error.message || "세션 종료에 실패했습니다.");
        });
      };
    };
  }

  function startLivePolling() {
    clearInterval(liveTimer);
    if (!window.DRBLive || !window.DRBLive.hasFacilitatorSession || !window.DRBLive.hasFacilitatorSession()) return;
    function poll() {
      window.DRBLive.snapshot().then(function (snapshot) { liveSnapshot = snapshot; render(); })
        .catch(function () { el("bSync").textContent = "연결 재시도"; });
    }
    poll();
    liveTimer = setInterval(poll, 5000);
  }


  /* ============================================================
     묶기
     ============================================================ */
  function bind() {
    /* 손은 여기 둘에만 둡니다 */
    el("btnNextStep").onclick = function () { goStep(1); };
    el("btnBack").onclick = function () { goStep(-1); };
    el("btnForce").onclick = function () {
      forcedTurn = selectedTurn;
      toast("모든 조가 끝나지 않았지만 넘어갑니다.");
      render();
      goStep(1);
    };

    /* 이 국면의 챕터 띠 */
    el("bSteps").onclick = function (event) {
      var button = event.target.closest("[data-chapter]");
      if (button) jumpTo(button.dataset.chapter);
    };
    /* 조 한 줄 → 조별 상세 */
    el("bTeamStrip").onclick = function (event) {
      var button = event.target.closest("[data-team]");
      if (button) teamDetail(button.dataset.team);
    };

    /* 도구 안의 화면 바로가기 */
    document.querySelectorAll("[data-stage]").forEach(function (button) {
      button.onclick = function () { closeTools(); jumpTo(button.dataset.stage); };
    });

    el("btnPrev").onclick = function () {
      selectedTurn = Math.max(0, selectedTurn - 1);
      currentStage = "briefing";
      render();
      showStage("briefing", true);
    };
    el("btnNext").onclick = function () {
      selectedTurn = Math.min(openTurn, selectedTurn + 1);
      currentStage = "briefing";
      render();
      showStage("briefing", true);
    };

    el("btnRevealActual").onclick = function () {
      var round = timeline[selectedTurn].round;
      sessionStorage.setItem(revealKey(round.id), "1");
      if (window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession()) {
        window.DRBLive.control({ currentTurn: selectedTurn, stage: "actual", revealedActual: round.id }).catch(function () {});
      }
      render();
    };

    el("bTimer").onclick = toggleClock;

    /* 맺음말 — 화면을 누르면 남은 줄을 한 번에 */
    el("stageClosing").onclick = function (event) {
      if (event.target.id === "btnClosingReplay") return;
      if (closing.running) finishClosing(false);
    };
    el("btnClosingReplay").onclick = replayClosing;

    /* 배경음악 끄기·켜기. 스피커가 이 화면 하나뿐이라 여기 둡니다. */
    el("btnSound").onclick = function () {
      if (!window.DRBAudio) return;
      var off = window.DRBAudio.toggle();
      el("btnSound").textContent = off ? "🔇" : "🔊";
      el("btnSound").setAttribute("aria-pressed", off ? "true" : "false");
      if (!off) window.DRBAudio.scene(currentStage);
    };

    el("btnTools").onclick = openTools;
    /* ⚠ 칩을 누르면 도구가 열리면서 세션 만드는 자리까지 데려갑니다 */
    el("bNoSession").onclick = function () {
      openTools();
      setTimeout(function () {
        try { el("btnSession").scrollIntoView({ block: "center" }); } catch (e) {}
      }, 0);
    };
    el("btnToolsClose").onclick = closeTools;
    el("bToolsPanel").onclick = function (event) { if (event.target === el("bToolsPanel")) closeTools(); };

    el("btnTeamDetail").onclick = function () {
      var teams = collectTeams();
      closeTools();
      openModal("조별 상세 · 결정 카드", teams.map(function (team) {
        var h = historyAt(team, selectedTurn);
        return "<div class='breakdown__row'><span class='breakdown__label'><b>" + esc(team.name) + "</b> · " +
          esc(styleOf(team)) + "<br><span class='hint'>" +
          (h ? esc(topAlloc(h.allocation, 3).join(" · ")) + " · 정책 " + esc(policyName(h.policyId, h.policyName))
             : "이번 국면 미확정") +
          "</span></span><span class='breakdown__value num'>" + totalScore(team) + "</span></div>";
      }).join("") || "<p class='hint'>참가 조가 없습니다.</p>");
    };

    el("btnAddTeam").onclick = function () { closeTools(); openPaste(); };

    el("btnEraCompare").onclick = function () {
      var teams = collectTeams();
      closeTools();
      openModal("시대 비교", "<div class='breakdown'>" + timeline.map(function (item) {
        var line = teams.map(function (team) {
          var h = (team.history || []).filter(function (x) { return x.subroundId === item.sub.id; })[0];
          if (!h) return null;
          var top = topIds(h.allocation, 1)[0];
          return esc(team.name) + " " + (top ? esc(investName(top.id)) : "투자 없음");
        }).filter(Boolean).join(" / ");
        return "<div class='breakdown__row'><span class='breakdown__label'><b class='num'>" + item.sub.year +
               "</b> " + (line || "기록 없음") + "</span></div>";
      }).join("") + "</div>");
    };

    el("btnSession").onclick = function () { closeTools(); openSession(); };
    el("btnPaste").onclick = function () { closeTools(); openPaste(); };
    el("btnPrint").onclick = function () { closeTools(); window.print(); };
    el("btnRefresh").onclick = function () { render(); startLivePolling(); };
    el("modalClose").onclick = closeModal;
    el("modal").onclick = function (event) { if (event.target === el("modal")) closeModal(); };
    window.addEventListener("storage", function (event) {
      if (event.key === CFG.storage.key || event.key === PASTED_KEY) render();
    });

    /* 프레젠터 리모컨은 대개 ←/→ 나 PageUp/PageDown 을 보냅니다 */
    document.addEventListener("keydown", function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (el("modal").classList.contains("is-open")) {
        if (event.key === "Escape") closeModal();
        return;
      }
      if (el("bToolsPanel").classList.contains("is-open")) {
        if (event.key === "Escape") closeTools();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault(); goStep(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault(); goStep(-1);
      }
    });
  }

  function boot() {
    if (window.DRBLive && window.DRBLive.restoreFacilitatorFromUrl) {
      try {
        var recovered = window.DRBLive.restoreFacilitatorFromUrl();
        if (recovered) setTimeout(function () { toast("진행자 세션 " + recovered.sessionId + "을 복원했습니다."); }, 0);
      } catch (error) {
        setTimeout(function () { toast(error.message || "진행자 복구 링크를 읽지 못했습니다."); }, 0);
      }
    }
    bind();
    resetClock();
    render();
    startLivePolling();
    setInterval(function () { if (!liveTimer) render(); }, 5000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
