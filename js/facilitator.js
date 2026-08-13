(function () {
  "use strict";

  var CFG = window.DRB_CONFIG;
  var G = window.DRB_GLOBAL;
  var PASTED_KEY = CFG.storage.key + "_pasted";
  var FAC_KEY = CFG.storage.key + "_facilitator";
  var TEAM_COLORS = ["#e31d38", "#f2c14e", "#4dd4c0", "#7aa2f7", "#f78fb3", "#7fd18a"];
  /* 참가자에게 공개되는 6단계 — Worker 가 검증하는 목록과 같아야 합니다 */
  var CONTROL_STAGES = ["briefing", "decisions", "event", "actual", "debrief", "map"];
  /* 진행자 화면에만 있는 화면. 순위·시상이 들어 있어 절대 공개하지 않습니다. */
  var LOCAL_STAGES = ["intro", "howto", "phase", "standings", "award"];
  var STAGES = ["intro", "howto", "briefing", "decisions", "event", "phase",
                "actual", "debrief", "map", "standings", "award"];
  var timeline = [];
  var selectedTurn = 0;
  var currentStage = "briefing";
  var liveTimer = null;
  var liveSnapshot = null;
  var minTurns = 0; // 공개 화면은 가장 느린 조 기준. 미래 국면 스포일러 방지 계약.
  var manualTurn = false;

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
  function topAlloc(allocation, limit) {
    return Object.keys(allocation || {}).filter(function (id) { return Number(allocation[id]) > 0; })
      .sort(function (a, b) { return Number(allocation[b]) - Number(allocation[a]); })
      .slice(0, limit || 4).map(function (id) { return investName(id) + " " + allocation[id]; });
  }
  function allocationSum(allocation) {
    return Object.keys(allocation || {}).reduce(function (sum, id) { return sum + (Number(allocation[id]) || 0); }, 0);
  }
  function turnForState(team) {
    if (Array.isArray(team.history)) return team.history.length;
    return Number(team.turns) || 0;
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

  function updateProgress(teams) {
    /* 등록된 모든 조를 포함해야 한 조만 먼저 달려도 미래 국면이 빔에 노출되지 않습니다. */
    var active = teams.slice();
    if (active.length) minTurns = active.reduce(function (min, team) { return Math.min(min, team.turns); }, active[0].turns);
    else minTurns = 0;
    var safeTurn = Math.min(Math.max(0, minTurns), timeline.length - 1);
    selectedTurn = Math.min(Math.max(0, selectedTurn), safeTurn);

    var item = timeline[selectedTurn];
    var era = window.DRB_ERAS[item.round.era];
    el("bEraChip").textContent = "ERA " + item.round.no + " · " + item.sub.year;
    el("bEra").textContent = era.name;
    el("bProgress").textContent = "국면 " + (selectedTurn + 1) + " / " + timeline.length;
    renderDots();
    renderTimer(era);
    el("btnPrev").disabled = selectedTurn === 0;
    el("btnNext").disabled = selectedTurn >= Math.min(safeTurn, timeline.length - 1);
    el("bPace").textContent = active.length
      ? "가장 느린 조의 완료 수 " + minTurns + "회를 공개 기준으로 사용합니다. 진행이 빠른 조의 미래 배경은 빔에서 숨깁니다."
      : "조가 시작하면 가장 느린 조를 기준으로 미래 배경을 잠급니다.";
  }

  /* ============================================================
     상단 — 진행 점과 토론 타이머
     ============================================================ */
  function renderDots() {
    var box = el("bDots");
    box.innerHTML = timeline.map(function (item, i) {
      var cls = i < selectedTurn ? " is-done" : i === selectedTurn ? " is-active" : "";
      return (i ? "<span class='dots__link'></span>" : "") +
             "<span class='dots__dot" + cls + "' title='" + item.sub.year + "'></span>";
    }).join("");
  }

  /* 토론 시간은 진행자가 직접 누르는 것이 아니라 시대 설정을 그대로 보여줍니다.
     실제로 재는 것은 참가자 화면의 타이머입니다. 여기서는 기준 시간만 표시합니다. */
  function renderTimer(era) {
    var seconds = (era.pace && era.pace.discussSeconds) || CFG.timer.discussSeconds;
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    el("bTimerText").textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ============================================================
     왼쪽 — 참가 조 카드

     여섯 지표를 작은 막대로, 그리고 참가자에게는 마지막까지 숨겨져 있는
     변화 대응력을 진행자에게만 보여줍니다.
     ============================================================ */
  function renderTeamCards(teams) {
    var box = el("bTeamCards");
    if (!teams.length) {
      box.innerHTML = "<p class='hint'>참가 조가 아직 없습니다.</p>";
      return;
    }

    var leadScore = Math.max.apply(null, teams.map(totalScore).concat([0]));

    box.innerHTML = teams.map(function (team, idx) {
      var decided = !!historyAt(team, selectedTurn);
      var adapt = adaptiveOf(team);
      var style = styleOf(team);

      var bars = (CFG.metrics || []).map(function (m) {
        var pct = Math.max(0, Math.min(100, ((team.state[m.key] || 0) / m.max) * 100));
        return "<span class='fac-team__bar' title='" + esc(m.name) + " " + fmt(team.state[m.key] || 0) +
               "'><span style='width:" + pct + "%'></span></span>";
      }).join("");

      return "<div class='fac-team" + (totalScore(team) >= leadScore && leadScore > 0 ? " is-lead" : "") + "'>" +
        "<div class='fac-team__head'>" +
          "<span class='fac-team__no num'>" + (idx + 1) + "</span>" +
          "<span class='fac-team__name'>" + esc(team.name) + "</span>" +
          "<span class='fac-team__style'>" + esc(style) + "</span>" +
          "<span class='fac-team__state" + (decided ? "" : " is-waiting") + "'>" +
            (team.placeholder ? "미접속" : decided ? "입력 완료" : "배분 중") +
          "</span>" +
        "</div>" +
        "<div class='fac-team__bars'>" + bars + "</div>" +
        "<div class='fac-team__adapt'>" +
          "<span class='fac-team__adapt-label'>변화 대응력</span>" +
          "<span class='fac-team__adapt-track'><span class='fac-team__adapt-fill' style='width:" +
            Math.max(0, Math.min(100, adapt)) + "%'></span></span>" +
          "<span class='fac-team__adapt-value num'>" + adapt + "</span>" +
        "</div>" +
      "</div>";
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
      (s.trust || 0) * 0.15 + Math.max(0, Math.min(1, (s.cash || 0) / 200)) * 100 * 0.1
    );
  }

  /* 종합 = 현재 경쟁력 + 변화 대응력.
     "지금 잘 되는 회사"와 "다시 움직일 수 있는 회사"를 같은 무게로 봅니다. */
  function totalScore(team) { return powerOf(team) + adaptiveOf(team); }

  /* ============================================================
     오른쪽 — 산업 뉴스

     조가 무엇에 얼마를 넣었는지, 그리고 그 국면에 산업 전체에
     무슨 일이 있었는지를 기사처럼 보여줍니다.
     ============================================================ */
  function renderNews(teams) {
    var box = el("bNewsFeed");
    var news = [];
    var item = timeline[selectedTurn];

    /* 이번 국면에 각 조가 가장 크게 건 곳 */
    teams.forEach(function (team) {
      var h = historyAt(team, selectedTurn);
      if (!h) return;
      var top = topAlloc(h.allocation, 1)[0];
      if (!top) return;
      news.push({
        when: h.year || item.sub.year,
        text: team.name + " — " + investName(top.id) + "에 " + top.amount + " 투입"
      });
    });

    /* 이정표 — 기술 도약 · 생산능력 확대 · 해외 진출 */
    teams.forEach(function (team) {
      var h = historyAt(team, selectedTurn);
      if (!h) return;
      var before = h.before || {};
      var after = h.after || {};
      if (after.tech !== undefined && before.tech !== undefined && after.tech - before.tech >= 5) {
        news.push({ kind: "milestone", when: h.year, text: team.name + " — 기술이 한 단계 도약했습니다" });
      }
      if (after.capacity !== undefined && before.capacity !== undefined && after.capacity - before.capacity >= 8) {
        news.push({ kind: "milestone", when: h.year, text: team.name + " — 생산능력을 크게 늘렸습니다" });
      }
      Object.keys(h.choices || {}).forEach(function (key) {
        var where = h.choices[key] && h.choices[key].where;
        if (where) news.push({ kind: "milestone", when: h.year, text: team.name + " — " + countryName(where) + " 진출을 결정했습니다" });
      });
    });

    /* 산업 전체에 벌어진 일 */
    var event = item.sub.event && window.DRB_EVENTS[item.sub.event];
    if (event) news.push({ kind: "market", when: "산업 전체", text: event.title });

    box.innerHTML = news.slice(0, 14).map(function (n) {
      return "<div class='news" + (n.kind ? " news--" + n.kind : "") + "'>" +
        "<span class='news__when num'>" + esc(String(n.when)) + "</span>" +
        "<span class='news__text'>" + esc(n.text) + "</span>" +
      "</div>";
    }).join("");
  }

  /* ============================================================
     몰림 경고 — 같은 분야에 조가 몰리면 경쟁강도가 실제로 올라갑니다
     ============================================================ */
  function renderCrowd(teams) {
    var box = el("bCrowd");
    var decided = teams.filter(function (team) { return !!historyAt(team, selectedTurn); });
    if (decided.length < 2) { box.classList.add("hidden"); return; }

    var byTop = {};
    decided.forEach(function (team) {
      var top = topAlloc(historyAt(team, selectedTurn).allocation, 1)[0];
      if (!top) return;
      if (!byTop[top.id]) byTop[top.id] = [];
      byTop[top.id].push(team.name);
    });

    var crowded = Object.keys(byTop)
      .filter(function (id) { return byTop[id].length >= 2; })
      .sort(function (a, b) { return byTop[b].length - byTop[a].length; });

    if (!crowded.length) {
      box.classList.remove("hidden");
      box.innerHTML = "<span class='fac-crowd__label'>몰림 없음</span>" +
        "<span>이번 국면은 조마다 다른 곳에 걸었습니다. 경쟁강도가 오르지 않습니다.</span>";
      box.style.background = "var(--bg-1)";
      return;
    }

    box.style.background = "";
    box.classList.remove("hidden");
    box.innerHTML = "<span class='fac-crowd__label'>몰림 주의</span>" +
      crowded.map(function (id) {
        return "<span><b>" + esc(byTop[id].join(" · ")) + "</b> 가 <b>" + esc(investName(id)) +
               "</b> 에 몰렸습니다 (" + byTop[id].length + "조)</span>";
      }).join("") +
      "<span class='hint'>같은 분야에 몰리면 고객 확보가 어려워집니다. 결과에 실제로 반영됩니다.</span>";
  }

  /* ============================================================
     순위 — 이 화면에만 나옵니다

     ★ 참가자 화면에는 순위를 절대 보내지 않습니다.
       참가자는 마지막까지 "순위를 매기지 않습니다" 를 봅니다.
     ============================================================ */
  function renderRank(teams) {
    var box = el("bRank");
    var played = teams.filter(function (team) { return team.turns > 0; });
    if (played.length < 2) { box.innerHTML = ""; return; }

    var rows = played.map(function (team) {
      return { name: team.name, total: totalScore(team), power: powerOf(team), adapt: adaptiveOf(team), turns: team.turns };
    }).sort(function (a, b) { return b.total - a.total; });

    var max = rows[0].total || 1;
    var prevOrder = readJson(FAC_KEY + "_rankorder", []);

    box.innerHTML =
      "<div class='fac-rank__head'>" +
        "<span class='fac-rank__title'>지금 순위</span>" +
        "<span class='fac-rank__note'>진행자 화면 전용 · 참가자에게 보이지 않습니다</span>" +
      "</div>" +
      "<div class='fac-rank__list'>" +
      rows.map(function (r, i) {
        var was = prevOrder.indexOf(r.name);
        var move = was < 0 ? 0 : was - i;
        var moveCls = move > 0 ? "is-up" : move < 0 ? "is-down" : "is-flat";
        var moveText = move > 0 ? "▲" + move : move < 0 ? "▼" + Math.abs(move) : "—";
        return "<div class='fac-rank__row" + (i === 0 ? " is-first" : "") + "'>" +
          "<span class='fac-rank__pos num'>" + (i + 1) + "위</span>" +
          "<span class='fac-rank__name'>" + esc(r.name) + "</span>" +
          "<span class='fac-rank__track'><span class='fac-rank__fill' style='width:" +
            Math.round(r.total / max * 100) + "%'></span></span>" +
          "<span class='fac-rank__value num'>" + r.total + "</span>" +
          "<span class='fac-rank__move " + moveCls + "'>" + moveText + "</span>" +
        "</div>";
      }).join("") +
      "</div>";

    writeJson(FAC_KEY + "_rankorder", rows.map(function (r) { return r.name; }));
  }

  /* ============================================================
     시상 — 종합 순위 + 부문상

     종합은 '현재 경쟁력 + 변화 대응력' 입니다. 부문상은 순위와 다른 축이라
     한 조가 다 가져가지 않습니다.
     ============================================================ */
  function renderAward(teams) {
    var body = el("bAwardBody");
    var state = el("bAwardState");
    el("bAwardWhen").textContent = timeline[0].sub.year + " → " +
      timeline[timeline.length - 1].sub.year + " · " + timeline.length + "번의 결정이 끝났습니다";
    var done = teams.filter(function (team) { return team.finished || team.turns >= timeline.length; });

    if (!teams.length || done.length < teams.length) {
      state.textContent = done.length + " / " + teams.length + "조 완주";
      body.innerHTML = "<p class='hint'>모든 조가 2026년까지 마치면 종합 순위와 부문상이 열립니다.<br>" +
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
        "<div class='podium__scores'>" +
          "<span><i>변화 대응력</i><b class='num'>" + r.adapt + "</b></span>" +
          "<span><i>경쟁력</i><b class='num'>" + r.power + "</b></span>" +
        "</div>" +
      "</div>";
    }).join("") + "</div>";

    body.innerHTML =
      podium +
      "<div class='awards'>" + buildAwards(teams, rows) + "</div>" +
      "<p class='fac-award__message'>1등이 정답은 아닙니다.<br>" +
      timeline.length + "번의 선택이 회사의 성격을 만들었습니다.</p>" +
      "<div class='fac-award__foot'>" +
        "<span class='fac-award__note'>각 조 노트북에는 What If 화면이 열려 있습니다</span>" +
        "<span class='spacer'></span>" +
      "</div>";
  }

  function buildAwards(teams, rows) {
    var out = [];

    /* 가장 멀리 볼 수 있는 회사 */
    var adaptBest = rows.slice().sort(function (a, b) { return b.adapt - a.adapt; })[0];
    if (adaptBest) out.push(awardCard("가장 멀리 본 조", adaptBest.name,
      "무엇이 오든 다시 시작할 수 있는 여력을 가장 많이 남겼습니다 (" + adaptBest.adapt + "점)"));

    /* 가장 일관된 조 — 정책을 가장 적게 바꾼 조 */
    var steady = teams.map(function (team) {
      var changes = 0, prev = null;
      (team.history || []).forEach(function (h) {
        if (prev && h.policyId && h.policyId !== prev) changes++;
        if (h.policyId) prev = h.policyId;
      });
      return { name: team.name, changes: changes };
    }).sort(function (a, b) { return a.changes - b.changes; })[0];
    if (steady) out.push(awardCard("위기에 가장 강한 조", steady.name,
      "여섯 번의 결정 내내 방향을 " + steady.changes + "번만 바꿨습니다"));

    /* 가장 크게 방향을 바꾼 조 */
    var boldest = teams.map(function (team) {
      var changes = 0, prev = null;
      (team.history || []).forEach(function (h) {
        if (prev && h.policyId && h.policyId !== prev) changes++;
        if (h.policyId) prev = h.policyId;
      });
      return { name: team.name, changes: changes };
    }).sort(function (a, b) { return b.changes - a.changes; })[0];
    if (boldest && boldest.changes > 0 && boldest.name !== steady.name) {
      out.push(awardCard("가장 과감한 조", boldest.name,
        "필요할 때 방향을 " + boldest.changes + "번 바꿨습니다. 바꾸는 데에도 대가를 치렀습니다"));
    }

    /* 가장 넓게 나간 조 */
    var widest = teams.map(function (team) {
      return { name: team.name, sites: (team.state.sites || []).length };
    }).sort(function (a, b) { return b.sites - a.sites; })[0];
    if (widest && widest.sites > 0) out.push(awardCard("가장 넓게 나간 조", widest.name,
      "해외 거점을 " + widest.sites + "곳 만들었습니다"));

    /* DRB와 가장 닮은 조 — 확인된 기록과 비교합니다 */
    var drbLike = mostLikeDrb(teams);
    if (drbLike) out.push(awardCard("DRB와 가장 닮은 조", drbLike,
      "확인된 DRB 기록과 같은 분야를 가장 자주 골랐습니다", true));

    return out.slice(0, 4).join("");
  }

  /* 시대마다 DRB 기록이 고른 분야와 같은 선택을 몇 번 했는가 */
  function mostLikeDrb(teams) {
    var scored = teams.map(function (team) {
      var hits = 0;
      timeline.forEach(function (item, turn) {
        var actual = window.DRB_ACTUAL[item.round.actualId];
        if (!actual || !actual.matchInvest) return;
        var h = historyAt(team, turn);
        var top = h ? topAlloc(h.allocation, 1)[0] : null;
        if (top && top.id === actual.matchInvest) hits++;
      });
      return { name: team.name, hits: hits };
    }).filter(function (r) { return r.hits > 0; })
      .sort(function (a, b) { return b.hits - a.hits; });
    return scored.length ? scored[0].name : "";
  }

  function awardCard(label, name, why, fact) {
    return "<div class='award" + (fact ? " award--fact" : "") + "' title='" + esc(why) + "'>" +
      "<div class='award__label'>" + esc(label) + "</div>" +
      "<div class='award__team'>" + esc(name) + "</div>" +
    "</div>";
  }

  /* ============================================================
     진행자 전용 화면 — 표지 · 진행 방법 · 국면 결과 · 경쟁 현황

     ★ 이 네 화면은 참가자에게 전송되지 않습니다.
       순위와 시상이 들어 있습니다.
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

    /* 지금 어느 단계에 있는지 표시합니다 */
    var nowIndex = { briefing: 0, decisions: 1, event: 2, phase: 3, actual: 4, debrief: 4, map: 3 }[currentStage];

    el("bHowtoCards").innerHTML = plan.map(function (step, i) {
      var cls = "howtocard" + (step.fact ? " howtocard--fact" : (i === nowIndex ? " howtocard--now" : ""));
      return "<div class='" + cls + "'>" +
        "<span class='howtocard__no num'>" + (i + 1) + "</span>" +
        "<div class='howtocard__name'>" + esc(step.name).split("|").join("<br>") + "</div>" +
        "<div class='howtocard__min num'>" + step.minutes + "분</div>" +
      "</div>";
    }).join("");
  }

  /* 국면 결과 — 이 국면의 매출로 줄을 세웁니다. */
  function renderPhaseResult(teams) {
    var item = timeline[selectedTurn];
    var next = timeline[selectedTurn + 1];

    el("bPhaseEra").textContent = "ERA " + item.round.no;
    el("bPhaseYears").textContent = next ? item.sub.year + " → " + next.sub.year : String(item.sub.year);
    el("bPhaseTitle").textContent = (selectedTurn + 1) + "국면 결과";

    var played = teams.map(function (team) {
      var h = historyAt(team, selectedTurn);
      return h ? { name: team.name, revenue: (h.report.kpi.revenue || 0), h: h } : null;
    }).filter(Boolean).sort(function (a, b) { return b.revenue - a.revenue; });

    el("bPhaseState").textContent = played.length + " / " + teams.length + "조 완료";

    if (!played.length) {
      el("bPhaseCards").innerHTML = "<p class='hint'>이 국면을 마친 조가 아직 없습니다.</p>";
      return;
    }

    el("bPhaseCards").innerHTML = played.map(function (r, i) {
      var tags = topAlloc(r.h.allocation, 1).map(function (a) {
        return "<span class='phasetag'>" + esc(investName(a.id)) + "</span>";
      }).join("") +
      "<span class='phasetag'>" + esc(policyName(r.h.policyId, r.h.policyName)) + "</span>";

      return "<div class='phasecard" + (i === 0 ? " phasecard--first" : "") + "'>" +
        "<div class='phasecard__head'>" +
          "<span class='phasecard__no num'>" + (CFG.teamNames.indexOf(r.name) + 1) + "</span>" +
          "<span class='phasecard__name'>" + esc(r.name) + "</span>" +
          "<span class='phasecard__rank'>" + (i + 1) + "위</span>" +
        "</div>" +
        "<div class='phasecard__value num'>" + fmt(r.revenue) + "</div>" +
        "<div class='phasecard__unit'>매출 · 억</div>" +
        "<div class='phasecard__tags'>" + tags + "</div>" +
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
      var top = topAlloc(h.allocation, 1)[0];
      return top && top.id === actual.matchInvest ? team.name : null;
    }).filter(Boolean);
    return hit.length ? hit.join(" · ") : "";
  }

  function renderBrief() {
    var item = timeline[selectedTurn];
    var era = window.DRB_ERAS[item.round.era];
    var totalInfo = era.briefing.domestic.length + era.briefing.global.length + era.briefing.risk.length;
    var visibleInvest = (window.DRB_INVESTMENTS[era.investSet] || []).filter(function (invest) {
      return invest.unlockSubround === undefined || item.subIndex >= invest.unlockSubround;
    }).length;
    var axes = ["투자 대상", "배분 규모", "경영 정책"];
    if (era.globalEnabled) axes.push("진출 지역", "진입 방식");
    if (item.round.no === 3) axes.push("포트폴리오", "회복력");

    var node = el("bBrief");
    node.dataset.roundId = item.round.id;
    node.dataset.subroundId = item.sub.id;
    el("bBriefTitle").textContent = item.sub.year + " · " + item.sub.title.replace(/^.*?·\s*/, "");
    el("bBriefBody").textContent = item.sub.situation.body;
    el("bComplexity").textContent = "복잡도 " + (selectedTurn + 1) + " / 6 · " + visibleInvest + "개 투자칸";
    el("bBriefFacts").innerHTML = [
      ["이 시대의 질문", era.question, ""],
      ["의사결정 차원", axes.join(" · "), ""],
      ["정보량 / 전망", totalInfo + "개 신호 · 선명도 " + era.visibility + "%", ""],
      ["가용 예산", item.sub.budget + " · 토큰 " + (item.sub.budget / CFG.tokenUnit) + "개", ""],
      ["권장 토론 시간", Math.round(era.pace.discussSeconds / 60) + "분", "fac-brief__constraint"],
      ["새로 어려워진 점", complexityCue(item), "fac-brief__constraint"]
    ].map(function (fact) {
      return "<div class='fac-brief__fact'><div class='fac-brief__fact-label'>" + esc(fact[0]) + "</div><div class='fac-brief__fact-value " + fact[2] + "'>" + esc(fact[1]) + "</div></div>";
    }).join("");
    el("bBriefSource").textContent = "이 화면의 배경은 당시 산업환경을 재구성한 교육용 시뮬레이션입니다. DRB의 실제 기록은 ‘DRB 실제 선택’ 단계에서 분리해 공개합니다.";
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

  function renderDecisions(teams) {
    var rows = el("bDecisionRows");
    var decided = 0;
    if (!teams.length) {
      rows.innerHTML = "<tr><td class='fac-decision-table__empty' colspan='6'>참가 조가 연결되면 같은 국면의 선택이 여기에 나란히 표시됩니다.</td></tr>";
      el("bDecisionCount").textContent = "0 / 0조 확정";
      return;
    }
    rows.innerHTML = teams.map(function (team) {
      var h = historyAt(team, selectedTurn);
      if (!h) {
        return "<tr data-testid='fac-team-decision' data-team='" + esc(team.name) + "' data-subround-id='" + timeline[selectedTurn].sub.id + "'>" +
          "<td class='fac-decision-table__team' style='border-left:4px solid " + teamColor(team.name) + "'>" + esc(team.name) + "<br><span class='chip'>토론·선택 중</span></td>" +
          "<td class='fac-decision-table__empty' colspan='5'>아직 이 국면의 결정을 확정하지 않았습니다.</td></tr>";
      }
      decided++;
      var choices = [];
      Object.keys(h.choices || {}).forEach(function (id) {
        var choice = h.choices[id] || {};
        choices.push(investName(id) + " · " + countryName(choice.where) + " / " + modeName(choice.how));
      });
      var resultOpen = ["event", "actual", "debrief", "map"].indexOf(currentStage) >= 0;
      var result = resultOpen && h.report && h.report.kpi ? "매출 " + fmt(h.report.kpi.revenue) + " · 손익 " + signed(h.report.kpi.profit) : "사건 공개 후 확인";
      var kept = Math.max(0, (timeline[selectedTurn].sub.budget || 0) - allocationSum(h.allocation));
      return "<tr data-testid='fac-team-decision' data-team='" + esc(team.name) + "' data-subround-id='" + esc(h.subroundId) + "'>" +
        "<td class='fac-decision-table__team' style='border-left:4px solid " + teamColor(team.name) + "'>" + esc(team.name) + "<br><span class='chip'>결정 확정</span></td>" +
        "<td class='fac-decision-table__choice'>" + esc(topAlloc(h.allocation, 5).join(" · ") || "전액 보유") + "</td>" +
        "<td>" + esc(policyName(h.policyId, h.policyName)) + "</td>" +
        "<td>" + esc(choices.join(" · ") || "추가 차원 없음") + "</td>" +
        "<td class='fac-decision-table__metric'>" + fmt(kept) + "</td>" +
        "<td class='fac-decision-table__metric " + (resultOpen && h.report && h.report.kpi ? (h.report.kpi.profit < 0 ? "fac-decision-table__metric--down" : "fac-decision-table__metric--up") : "") + "'>" + esc(result) + "</td></tr>";
    }).join("");
    el("bDecisionCount").textContent = decided + " / " + teams.length + "조 확정";
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
      el("bEventTitle").textContent = "이 국면은 사전 돌발상황이 없습니다";
      el("bEventYear").textContent = item.sub.year;
      el("bEventHeadline").textContent = "시장 자체와 첫 선택의 불확실성에 집중합니다.";
      el("bEventBody").textContent = "첫 판단을 마친 뒤, 조별로 무엇을 근거로 선택했는지 비교하세요.";
    } else {
      box.dataset.eventId = event.id;
      el("bEventTitle").textContent = event.title;
      el("bEventYear").textContent = item.sub.year;
      el("bEventHeadline").textContent = event.headline;
      el("bEventBody").textContent = event.body;
    }
    el("bEventTeams").innerHTML = teams.map(function (team) {
      var delivered = !!historyAt(team, selectedTurn);
      return "<span class='fac-event__team" + (delivered ? " is-delivered" : "") + "'>" + esc(team.name) + " · " + (delivered ? "적용 확인" : "결정 대기") + "</span>";
    }).join("") || "<span class='hint'>연결된 조 없음</span>";

    el("bEventImpact").innerHTML = teams.map(function (team) {
      var history = historyAt(team, selectedTurn);
      var reactions = event ? eventReactionText(history, event.id) : [];
      var conditionals = history && history.report ? (history.report.events || []).filter(function (ev) {
        return ev.id !== (event && event.id);
      }) : [];
      var text = !history ? "아직 결정하지 않음" : (reactions.join(" · ") || (event ? "추가 완화 조건 없음 · 공통 기본 충격 적용" : "사건 없음"));
      if (conditionals.length) text += " · 팀별 추가 사건: " + conditionals.map(function (ev) { return ev.title || ev.id; }).join(", ");
      return "<div data-testid='fac-event-reaction' data-event-id='" + esc(event ? event.id : "none") + "' data-team='" + esc(team.name) + "' style='margin-top:7px'><b style='color:" + teamColor(team.name) + "'>" + esc(team.name) + "</b> · " + esc(text) + "</div>";
    }).join("") || "<p class='hint'>결정이 들어오면 조별 적용 이유가 표시됩니다.</p>";
  }

  function teamEraSummary(team, round) {
    var allocation = {};
    var policies = [];
    var dimensions = [];
    (team.history || []).filter(function (h) { return h.roundId === round.id; }).forEach(function (h) {
      Object.keys(h.allocation || {}).forEach(function (id) { allocation[id] = (allocation[id] || 0) + h.allocation[id]; });
      if (h.policyName && policies.indexOf(h.policyName) < 0) policies.push(h.policyName);
      Object.keys(h.choices || {}).forEach(function (id) {
        var choice = h.choices[id];
        dimensions.push(countryName(choice.where) + " / " + modeName(choice.how));
      });
    });
    return topAlloc(allocation, 3).join(" · ") + (policies.length ? " · 정책 " + policies.join("→") : "") + (dimensions.length ? " · " + dimensions.join(", ") : "");
  }

  function renderActual(teams) {
    var item = timeline[selectedTurn];
    var actual = window.DRB_ACTUAL[item.round.actualId];
    var complete = allCompletedRound(teams, item.round);
    var revealed = isRevealed(item.round.id);

    el("bActualLock").classList.toggle("is-unlocked", revealed);
    el("btnRevealActual").disabled = !complete;
    el("bLockTitle").textContent = complete ? "모든 조가 이 시대를 마쳤습니다" : "아직 공개하지 마세요";
    el("bLockText").textContent = complete
      ? "조별 판단을 먼저 말하게 한 뒤 DRB의 기록을 공개하세요. 유사도나 정답으로 평가하지 않습니다."
      : "해당 시대의 두 국면을 모든 조가 마친 뒤 공개할 수 있습니다.";
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

    /* 헤드라인 — 실제로 무엇을 골랐는가 */
    el("bActualTitle").innerHTML = actual.headline
      ? esc(actual.headline).split("|").join("<br>")
      : "그때 DRB는<br>이렇게 했습니다";

    /* 세 칸 — 당시 상황 / 실제 선택 / 그 결과 */
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
      var top = h ? topAlloc(h.allocation, 1)[0] : null;
      if (actual.matchInvest && top && top.id === actual.matchInvest) same.push(team.name);
      else diff.push(team.name);
    });
    var chips = "";
    if (same.length) chips += "<span class='drbchip drbchip--same'>" + esc(same.join("·")) + "와 같은 선택</span>";
    if (diff.length) chips += "<span class='drbchip'>" + esc(diff.join("·")) + "는 달랐다</span>";
    el("bDrbChips").innerHTML = chips;
  }

  function promptsFor(item) {
    var common = [
      "모든 조가 같은 정보를 받았는데도 선택이 달라진 가장 큰 이유는 무엇입니까?",
      "결정 당시에는 합리적이었지만 결과 뒤에 다르게 보이는 판단은 무엇입니까?",
      "DRB의 선택을 정답으로 보지 말고, 당시 어떤 가정과 대가를 감수했는지 비교해 보세요."
    ];
    var turnSpecific = [
      "내일부터 팔리는 것과 아직 시장이 없는 것 사이에서 무엇을 근거로 시간을 선택했습니까?",
      "원료 충격을 맞기 전에 쌓아둔 현금·품질·신뢰 중 무엇이 실제 방어막이 됐습니까?",
      "자동차·본업·해외를 동시에 할 수 없을 때 무엇을 포기했고, 지역·방식의 대가는 무엇입니까?",
      "위기 전에 키운 규모가 자산이었습니까, 부담이었습니까? 현금은 얼마만큼이 충분했습니까?",
      "16개 신호 중 무엇을 의도적으로 보지 않았습니까? 공급망을 몇 갈래로 준비했습니까?",
      "결과를 알 수 없는 2026년 판단에서, 크게 걸 것과 되돌릴 수 있게 남길 것을 어떻게 나눴습니까?"
    ];
    return [turnSpecific[item.turn]].concat(common);
  }

  function renderPrompts() {
    var item = timeline[selectedTurn];
    var prompts = promptsFor(item);
    el("bPrompts").innerHTML = prompts.map(function (prompt, idx) {
      return "<div class='fac-prompts__item" + (idx === 0 ? " fac-prompts__item--key" : "") + "'>" + esc(prompt) + "</div>";
    }).join("");
    el("bGuide").textContent = item.sub.guide;
  }

  function renderRail(teams) {
    var connected = teams.filter(function (team) { return team.source === "live"; }).length;
    var live = window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession();

    /* 세션이 없으면 다른 PC의 조는 절대 보이지 않습니다.
       조용히 비어 있으면 고장으로 오해하므로 크게 알립니다. */
    var warn = el("bNoSession");
    if (warn) {
      warn.classList.toggle("hidden", !!live);
      warn.innerHTML = live ? "" :
        "<b>교육 세션이 없습니다.</b> 지금은 이 브라우저에 저장된 기록만 보입니다. " +
        "다른 PC·태블릿의 조를 보려면 <b>[교육 세션 만들기]</b> 를 누르고, " +
        "만들어진 <b>조별 전용 링크</b>를 각 조에 전달하세요.";
    }

    el("bSessionStatus").textContent = connected ? "실시간 연결" : (live ? "연결 대기" : "세션 없음");
    el("bSessionStatus").classList.toggle("fac-session__status--paused", !connected);
    el("bSessionMeta").innerHTML = "<span class='fac-session__meta'>참가 " + teams.length + "조 · 라이브 " + connected + "조 · 15초 이내 자동 갱신</span>";
    el("bTeamStatus").innerHTML = teams.map(function (team) {
      var pos = team.finished ? "전체 완료" : (team.turns + " / " + timeline.length + "회 완료 · " + phaseLabel(team.phase));
      return "<div class='fac-session__team'><div class='fac-session__team-name' style='color:" + teamColor(team.name) + "'>" + esc(team.name) + "</div><div class='fac-session__team-state'>" + esc(pos) + "</div></div>";
    }).join("") || "<p class='hint'>참가 조가 아직 없습니다.</p>";
    el("bCompletion").innerHTML = teams.map(function (team) {
      return "<div class='breakdown__row'><span class='breakdown__label'>" + esc(team.name) + "</span><span class='breakdown__value'>" + team.turns + " / " + timeline.length + "</span></div>";
    }).join("") || "<p class='hint'>진행 데이터 없음</p>";

    var item = timeline[selectedTurn];
    var allDecided = teams.length > 0 && teams.every(function (team) { return !!historyAt(team, selectedTurn); });
    var cues = currentStage === "briefing" ? ["공통 배경을 같은 문구로 읽어주세요.", "이번 국면에 새로 늘어난 판단 차원만 설명하세요.", "답이 아니라 판단 근거를 기록하게 하세요."]
      : currentStage === "decisions" ? ["확정한 조와 아직 토론 중인 조를 구분하세요.", "상위 투자만 보지 말고 남긴 현금·정책·지역·방식을 물으세요.", allDecided ? "모든 조가 확정했습니다. 돌발상황으로 넘어가세요." : "미확정 조를 기다리고 미래 국면은 열지 마세요."]
      : currentStage === "event" ? ["헤드라인과 본문을 모든 조에 한 번만 전달하세요.", "공통 충격과 팀별 완화·추가 사건을 분리해 읽으세요.", "왜 같은 사건의 결과가 달랐는지 한 문장씩 받으세요."]
      : currentStage === "actual" ? ["먼저 조별 판단을 발표시키세요.", allCompletedRound(teams, item.round) ? "DRB 기록 공개가 가능합니다." : "전 조가 이 ERA를 마칠 때까지 DRB 기록을 잠그세요.", "DRB를 정답이나 유사도 점수로 평가하지 마세요."]
      : currentStage === "debrief" ? ["판단 당시의 합리성과 사후 결과를 구분하세요.", "역사적 선택의 대가와 축적된 역량을 연결하세요.", "다음 국면에서 무엇이 더 복잡해지는지 예고하세요."]
      : ["지도는 해외 거점이 열린 ERA 2부터 활용하세요.", "거점 수보다 지역·방식·완성 시점을 비교하세요.", "공개 정보만 빔에 표시됩니다."];
    el("bCue").innerHTML = cues.map(function (cue, idx) { return "<div class='fac-prompts__item" + (idx === 0 ? " fac-prompts__item--key" : "") + "'>" + esc(cue) + "</div>"; }).join("");
  }

  function phaseLabel(phase) {
    return { roundOpen: "시대 브리핑", situation: "상황 확인", invest: "자원 배분", policy: "정책 선택", timelapse: "결과 계산", result: "결과 확인", actual: "DRB 비교", ending: "마무리", final: "완료" }[phase] || phase || "대기";
  }

  function renderMap(teams) {
    var box = el("bMap");
    box.innerHTML = "<svg class='bigmap__svg' viewBox='0 0 100 50' preserveAspectRatio='none' aria-hidden='true'>" +
      "<path class='bigmap__land' d='M8,14 L26,10 L32,20 L26,34 L16,40 L10,30 Z'/><path class='bigmap__land' d='M22,38 L30,36 L32,46 L26,49 L21,44 Z'/>" +
      "<path class='bigmap__land' d='M42,10 L56,8 L58,18 L50,22 L43,18 Z'/><path class='bigmap__land' d='M44,24 L58,22 L60,38 L50,44 L44,34 Z'/>" +
      "<path class='bigmap__land' d='M60,12 L86,10 L92,22 L84,32 L70,34 L62,24 Z'/><path class='bigmap__land' d='M72,44 L88,42 L90,48 L74,49 Z'/></svg>";
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
      node.innerHTML = "<div class='region__name'>" + esc(place.name) + "</div><div class='region__pins'>" + (regions[place.id] || []).map(function (pin) {
        return "<span class='pin" + (pin.stage === "build" ? " pin--build" : "") + "'><span class='pin__dot' style='background:" + pin.color + "'></span>" + esc(pin.name) + "</span>";
      }).join("") + "</div>";
      box.appendChild(node);
    });
    var sites = teams.reduce(function (sum, team) { return sum + (team.state.sites || []).length; }, 0);
    el("bBar").innerHTML = "<span class='boardbar__item'><span class='boardbar__k'>참가 조</span><span class='boardbar__v'>" + teams.length + "</span></span>" +
      "<span class='boardbar__item'><span class='boardbar__k'>해외 거점</span><span class='boardbar__v'>" + sites + "</span></span><span class='spacer'></span><span class='hint'>점선은 건설 중 · 실선은 가동 중</span>";
    el("bNewsCount").textContent = teams.reduce(function (sum, team) { return sum + team.turns; }, 0) + "개 결정";
  }

  function render() {
    var teams = collectTeams();
    updateProgress(teams);
    renderBrief();
    renderDecisions(teams);
    renderEvent(teams);
    renderActual(teams);
    renderPrompts();
    renderRail(teams);
    renderMap(teams);
    renderCover(teams);
    renderHowto();
    renderPhaseResult(teams);
    renderStandings(teams);
    renderTeamCards(teams);
    renderNews(teams);
    renderCrowd(teams);
    renderRank(teams);
    renderAward(teams);
    showStage(currentStage, false);
  }

  function showStage(stage, publish) {
    if (STAGES.indexOf(stage) < 0) return;
    currentStage = stage;
    document.querySelectorAll("[data-stage-panel]").forEach(function (panel) { panel.classList.toggle("hidden", panel.dataset.stagePanel !== stage); });
    document.querySelectorAll("[data-stage]").forEach(function (button) { button.classList.toggle("is-active", button.dataset.stage === stage); });
    /* ★ 시상 단계는 참가자에게 내보내지 않습니다. 순위가 들어 있습니다.
       참가자 화면은 마지막까지 "순위를 매기지 않습니다" 를 유지해야 합니다. */
    if (publish && LOCAL_STAGES.indexOf(stage) < 0 &&
        window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession()) {
      window.DRBLive.control({ currentTurn: selectedTurn, stage: stage }).catch(function () {});
    }
    renderRail(collectTeams());
  }

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
    openModal("실시간 교육 세션 만들기", "<p class='hint'>조별 노트북이 서로 다른 PC여도 15초 이내에 결정과 돌발상황 반응을 모읍니다.</p><label class='field-label' for='sessionTeamCount'>참가 조 수</label><select class='select' id='sessionTeamCount'><option>2</option><option>3</option><option selected>4</option><option>5</option><option>6</option></select><div class='row' style='margin-top:var(--sp-4)'><button class='btn btn--primary' id='sessionCreate'>세션 코드 만들기</button></div>");
    el("sessionCreate").onclick = function () {
      if (!window.DRBLive) { toast("라이브 모듈을 불러오지 못했습니다."); return; }
      el("sessionCreate").disabled = true;
      window.DRBLive.create({ teamCount: Number(el("sessionTeamCount").value) }).then(function (created) {
        showSessionDetails(created);
        startLivePolling();
      }).catch(function (err) { toast(err.message || "세션 생성에 실패했습니다."); el("sessionCreate").disabled = false; });
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
    el("bSync").textContent = "LIVE";
    function poll() {
      window.DRBLive.snapshot().then(function (snapshot) { liveSnapshot = snapshot; render(); }).catch(function () { el("bSync").textContent = "연결 재시도"; });
    }
    poll();
    liveTimer = setInterval(poll, 5000);
  }

  function bind() {
    document.querySelectorAll("[data-stage]").forEach(function (button) { button.onclick = function () { showStage(button.dataset.stage, true); }; });
    document.querySelectorAll("[data-goto]").forEach(function (button) { button.onclick = function () { showStage(button.dataset.goto, true); }; });
    el("btnPrev").onclick = function () { selectedTurn = Math.max(0, selectedTurn - 1); manualTurn = true; render(); };
    el("btnNext").onclick = function () {
      selectedTurn = Math.min(Math.min(minTurns, timeline.length - 1), selectedTurn + 1);
      manualTurn = true;
      currentStage = "briefing";
      render();
      showStage("briefing", true);
    };
    el("btnRevealActual").onclick = function () {
      var round = timeline[selectedTurn].round;
      if (!allCompletedRound(collectTeams(), round)) return;
      sessionStorage.setItem(revealKey(round.id), "1");
      if (window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession()) window.DRBLive.control({ currentTurn: selectedTurn, stage: "actual", revealedActual: round.id }).catch(function () {});
      render();
    };
    /* 돌발상황 공개 — 모든 조가 결정을 확정한 뒤에만 누르세요 */
    el("btnRevealEvent").onclick = function () { showStage("event", true); };

    /* 다음 단계 — 진행 단계를 하나 넘기고, 마지막 단계면 다음 국면으로 */
    el("btnNextStep").onclick = function () {
      var at = STAGES.indexOf(currentStage);
      if (at < 0 || at >= STAGES.indexOf("map")) {
        el("btnNext").click();
        return;
      }
      showStage(STAGES[at + 1], true);
    };

    el("btnTeamDetail").onclick = function () {
      var teams = collectTeams();
      openModal("조별 상세 · 결정 카드", teams.map(function (team) {
        var h = historyAt(team, selectedTurn);
        return "<div class='breakdown__row'><span class='breakdown__label'><b>" + esc(team.name) + "</b> · " +
          esc(styleOf(team)) + "<br><span class='hint'>" +
          (h ? esc(topAlloc(h.allocation, 3).map(function (a) { return investName(a.id) + " " + a.amount; }).join(" · ")) +
               " · 정책 " + esc(policyName(h.policyId, h.policyName))
             : "이번 국면 미확정") +
          "</span></span><span class='breakdown__value num'>" + totalScore(team) + "</span></div>";
      }).join("") || "<p class='hint'>참가 조가 없습니다.</p>");
    };

    el("btnAddTeam").onclick = openPaste;

    el("btnEraCompare").onclick = function () {
      var teams = collectTeams();
      openModal("시대 비교", "<div class='breakdown'>" + timeline.map(function (item, turn) {
        var line = teams.map(function (team) {
          var h = (team.history || []).filter(function (x) { return x.subroundId === item.sub.id; })[0];
          if (!h) return null;
          var top = topAlloc(h.allocation, 1)[0];
          return esc(team.name) + " " + (top ? esc(investName(top.id)) : "투자 없음");
        }).filter(Boolean).join(" / ");
        return "<div class='breakdown__row'><span class='breakdown__label'><b class='num'>" + item.sub.year +
               "</b> " + (line || "기록 없음") + "</span></div>";
      }).join("") + "</div>");
    };

    el("btnSession").onclick = openSession;
    el("btnPaste").onclick = openPaste;
    el("btnPrint").onclick = function () { window.print(); };
    el("btnRefresh").onclick = function () { render(); startLivePolling(); };
    el("modalClose").onclick = closeModal;
    el("modal").onclick = function (event) { if (event.target === el("modal")) closeModal(); };
    window.addEventListener("storage", function (event) { if (event.key === CFG.storage.key || event.key === PASTED_KEY) render(); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeModal(); });
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
    render();
    startLivePolling();
    setInterval(function () { if (!liveTimer) render(); }, 5000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
