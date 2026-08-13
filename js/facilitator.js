(function () {
  "use strict";

  var CFG = window.DRB_CONFIG;
  var G = window.DRB_GLOBAL;
  var PASTED_KEY = CFG.storage.key + "_pasted";
  var FAC_KEY = CFG.storage.key + "_facilitator";
  var TEAM_COLORS = ["#e31d38", "#f2c14e", "#4dd4c0", "#7aa2f7", "#f78fb3", "#7fd18a"];
  var STAGES = ["briefing", "decisions", "event", "actual", "debrief", "map"];
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
    el("bYear").textContent = item.sub.year;
    el("bEra").textContent = era.name;
    el("bProgress").textContent = "국면 " + (selectedTurn + 1) + " / " + timeline.length;
    el("btnPrev").disabled = selectedTurn === 0;
    el("btnNext").disabled = selectedTurn >= Math.min(safeTurn, timeline.length - 1);
    el("bPace").textContent = active.length
      ? "가장 느린 조의 완료 수 " + minTurns + "회를 공개 기준으로 사용합니다. 진행이 빠른 조의 미래 배경은 빔에서 숨깁니다."
      : "조가 시작하면 가장 느린 조를 기준으로 미래 배경을 잠급니다.";
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
    var lock = el("bActualLock");
    lock.classList.toggle("is-unlocked", revealed);
    el("btnRevealActual").disabled = !complete;
    el("bLockTitle").textContent = complete ? "모든 조가 이 시대를 마쳤습니다" : "아직 공개하지 마세요";
    el("bLockText").textContent = complete
      ? "조별 판단을 먼저 말하게 한 뒤 DRB의 기록을 공개하세요. 유사도나 정답으로 평가하지 않습니다."
      : "해당 시대의 두 국면을 모든 조가 마친 뒤 공개할 수 있습니다.";
    el("bActual").dataset.roundId = item.round.id;
    el("bActualTitle").textContent = "ERA " + item.round.no + " · 참가자 판단과 DRB 기록 비교";

    if (!revealed) {
      /* 잠긴 실제 기록은 DOM에도 넣지 않아 개발자 도구·스크린리더 누출을 막습니다. */
      el("bActualContent").innerHTML = "<p class='hint'>조별 판단을 먼저 정리한 뒤, 진행자가 공개하면 DRB 기록이 이 자리에 표시됩니다.</p>";
      return;
    }

    var summaries = teams.filter(function (team) { return completedRound(team, item.round); }).map(function (team) {
      return "<p style='margin:5px 0'><b style='color:" + teamColor(team.name) + "'>" + esc(team.name) + "</b> · " + esc(teamEraSummary(team, item.round) || "기록 없음") + "</p>";
    }).join("") || "<p class='hint'>이 시대를 완료한 조가 아직 없습니다.</p>";
    var timelineHtml = (actual.timeline || []).filter(function (milestone) { return milestone.key; }).slice(0, 5).map(function (milestone) {
      return "<div class='fac-drb__milestone'><div class='fac-drb__year'>" + esc(milestone.year) + "</div>" + esc(milestone.text) + "</div>";
    }).join("");
    el("bActualContent").innerHTML =
      "<div class='fac-drb__compare'><div class='fac-drb__side'><div class='fac-drb__label'>우리 조들의 판단</div><div class='fac-drb__why'>" + summaries + "</div></div>" +
      "<div class='fac-drb__vs'>VS</div><div class='fac-drb__side fac-drb__side--actual'><div class='fac-drb__label'>DRB 기록으로 본 실제 선택</div><div class='fac-drb__choice'>" + esc(actual.choice) + "</div></div></div>" +
      "<div class='fac-drb__result'><b>기록된 결과</b><br>" + esc(actual.result) + "</div>" +
      "<div class='fac-drb__timeline'>" + timelineHtml + "</div>" +
      "<p class='hint'>금색 텍스트와 연표는 확인된 DRB 기록입니다. 이미지는 AI 시대 연출이며 실제 DRB 사진이 아닙니다.</p>";  }

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
    el("bSessionStatus").textContent = connected ? "실시간 연결" : "로컬·코드 수집";
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
    showStage(currentStage, false);
  }

  function showStage(stage, publish) {
    if (STAGES.indexOf(stage) < 0) return;
    currentStage = stage;
    document.querySelectorAll("[data-stage-panel]").forEach(function (panel) { panel.classList.toggle("hidden", panel.dataset.stagePanel !== stage); });
    document.querySelectorAll("[data-stage]").forEach(function (button) { button.classList.toggle("is-active", button.dataset.stage === stage); });
    if (publish && window.DRBLive && window.DRBLive.hasFacilitatorSession && window.DRBLive.hasFacilitatorSession()) {
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
    var base = location.origin + location.pathname.replace(/facilitator(?:\.html)?$/, "");
    var links = (CFG.teamNames || []).slice(0, creds.teamCount || 6).map(function (name) {
      var claim = creds.teamClaims && creds.teamClaims[name];
      if (!claim) return "<div class='card card--flat' style='margin-top:8px'><b>" + esc(name) + "</b><br><span class='hint'>보안 참가키 없음 · 새 세션을 만들어주세요.</span></div>";
      var url = base + "?session=" + encodeURIComponent(creds.sessionId) + "&team=" + encodeURIComponent(name) +
        "#pin=" + encodeURIComponent(creds.pin) + "&claim=" + encodeURIComponent(claim);
      return "<div class='card card--flat' style='margin-top:8px'><b>" + esc(name) + "</b><br><button class='btn btn--ghost fac-team-link-copy' type='button' data-team='" + esc(name) + "' data-url='" + esc(url) + "'>" + esc(name) + " 전용 링크 복사</button><button class='btn btn--ghost fac-team-reset' type='button' data-team='" + esc(name) + "'>재연결 초기화</button></div>";
    }).join("");
    openModal("세션 " + creds.sessionId, "<div class='fac-brief__facts'><div class='fac-brief__fact'><div class='fac-brief__fact-label'>세션 코드</div><div class='fac-brief__fact-value num'>" + esc(creds.sessionId) + "</div></div><div class='fac-brief__fact'><div class='fac-brief__fact-label'>자동 종료</div><div class='fac-brief__fact-value'>생성 후 24시간</div></div></div><p class='hint'>각 조에는 자기 조 전용 링크만 전달하세요. 참가키와 PIN은 링크 안에 숨겨지고 첫 연결 뒤 주소창에서 제거됩니다. 진행자 비밀키는 이 탭에만 저장됩니다.</p>" + links + "<div class='row' style='margin-top:var(--sp-4)'><button class='btn btn--ghost' id='sessionCopy'>전체 링크 복사</button><button class='btn btn--ghost' id='sessionRecovery'>진행자 복구 링크 복사</button><button class='btn btn--ghost' id='sessionEnd'>세션 종료·데이터 삭제</button></div>");
    el("modalBody").querySelectorAll(".fac-team-link-copy").forEach(function (button) {
      button.onclick = function () {
        if (navigator.clipboard) navigator.clipboard.writeText(button.dataset.url).then(function () { toast(button.dataset.team + " 링크를 복사했습니다."); });
      };
    });
    el("modalBody").querySelectorAll(".fac-team-reset").forEach(function (button) {
      button.onclick = function () {
        var teamName = button.dataset.team;
        openModal(teamName + " 재연결을 초기화할까요?", "<div class='card card--flat' style='border-color:var(--warn);box-shadow:inset 4px 0 var(--warn)'><b>" + esc(teamName) + "의 현재 연결과 실시간 진행 사본만 삭제됩니다.</b><br>기존 참가 화면은 더 이상 전송할 수 없고, 새 기기에서 같은 조 전용 링크로 다시 입장해야 합니다.</div><p class='hint'>참가 기기 고장·브라우저 저장소 삭제 때만 사용하세요. 다른 조와 전체 세션에는 영향이 없습니다.</p><div class='row' style='margin-top:var(--sp-4)'><button class='btn btn--ghost' id='teamResetCancel'>취소하고 돌아가기</button><button class='btn btn--primary' id='teamResetConfirm'>" + esc(teamName) + " 재연결 초기화</button></div>");
        el("teamResetCancel").onclick = function () { showSessionDetails(creds); };
        el("teamResetConfirm").onclick = function () {
          el("teamResetConfirm").disabled = true;
          el("teamResetConfirm").textContent = "초기화 중…";
          window.DRBLive.resetTeam(teamName).then(function () {
            toast(teamName + " 연결을 초기화했습니다. 조 전용 링크를 다시 전달하세요.");
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
      var text = Array.prototype.map.call(el("modalBody").querySelectorAll(".fac-team-link-copy"), function (button) { return button.dataset.team + ": " + button.dataset.url; }).join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("조별 링크를 복사했습니다."); });
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
