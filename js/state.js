/* ============================================================
   state.js — 게임 진행 상태 관리 + 저장

   저장 위치 : 브라우저 localStorage
   ⚠ PC나 브라우저가 다르면 데이터가 공유되지 않습니다.
     조별 결과를 한곳에 모으려면 진행자 화면(facilitator.html)에
     각 조의 '결과 코드'를 붙여넣으세요.
   ============================================================ */

window.DRBState = (function () {
  "use strict";

  var CFG = window.DRB_CONFIG;
  var KEY = CFG.storage.key;

  var data = null;   // 전체 저장 데이터

  /* ============================================================
     저장 / 불러오기
     ============================================================ */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.error("저장 실패:", e);
      alert("게임 저장에 실패했습니다. 브라우저의 저장 공간을 확인해주세요.\n" + e.message);
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      data = JSON.parse(raw);
      return data;
    } catch (e) {
      console.error("저장 데이터를 읽지 못했습니다:", e);
      return null;
    }
  }

  function hasSave() {
    return !!localStorage.getItem(KEY);
  }

  function clearAll() {
    localStorage.removeItem(KEY);
    data = null;
  }

  /* ============================================================
     새 게임
     ============================================================ */
  function createTeam(name) {
    return {
      name: name,
      state: window.DRBEngine.createState(),
      policyId: null,
      prevPolicyId: null,
      history: [],        // 소라운드별 기록
      reason: "",         // 그렇게 결정한 이유 (결정 카드용)
      gapPick: null,      // 가장 고민했던 결정 (라운드 id)
      finished: false,

      /* 진행 위치는 조마다 따로 갖습니다.
         (한 대의 PC에서 여러 조를 번갈아 플레이해도 섞이지 않게) */
      roundIndex: 0,
      subIndex: 0,
      phase: "roundOpen"
    };
  }

  function newGame(teamCount) {
    var names = CFG.teamNames.slice(0, teamCount);
    var teams = {};
    names.forEach(function (n) { teams[n] = createTeam(n); });

    /* AI 경쟁사도 같은 조건에서 출발합니다 */
    var rivals = {};
    (window.DRB_RIVALS || []).forEach(function (r) {
      var st = window.DRBEngine.createState();
      Object.keys(r.start || {}).forEach(function (k) { st[k] = r.start[k]; });
      rivals[r.id] = {
        id: r.id, name: r.name, state: st,
        prevPolicyId: null, history: [], moves: []
      };
    });

    data = {
      version: 2,
      startedAt: new Date().toISOString(),
      teamCount: teamCount,
      teamNames: names,
      activeTeam: names[0],
      adminMode: false,
      rivals: rivals,
      rivalTurn: 0,        // 경쟁사가 어디까지 진행했는가
      turnRoles: {}        // { turnIndex: [role, ...] } — 어느 분야에 몰렸는지
    };
    data.teams = teams;
    save();
    return data;
  }

  /* ============================================================
     통산 턴 번호 ↔ 라운드/소라운드 위치
     ============================================================ */
  function turnToPosition(turn) {
    var n = 0;
    for (var i = 0; i < window.DRB_ROUNDS.length; i++) {
      var subs = window.DRB_ROUNDS[i].subrounds.length;
      if (turn < n + subs) return { roundIndex: i, subIndex: turn - n };
      n += subs;
    }
    var last = window.DRB_ROUNDS.length - 1;
    return { roundIndex: last, subIndex: window.DRB_ROUNDS[last].subrounds.length - 1 };
  }

  /* ============================================================
     AI 경쟁사를 해당 턴까지 진행시킨다

     ★ 경쟁사는 미래를 모릅니다. 그 턴 시점의 시대 정보와
       그때까지 공개된 참여 조들의 움직임만 보고 판단합니다.
     ============================================================ */
  function advanceRivals(uptoTurn) {
    if (!data.rivals) return;
    var Engine = window.DRBEngine;

    while (data.rivalTurn <= uptoTurn) {
      var turn = data.rivalTurn;
      var pos = turnToPosition(turn);
      var round = window.DRB_ROUNDS[pos.roundIndex];
      var sub = round.subrounds[pos.subIndex];
      var era = window.DRB_ERAS[round.era];
      var investments = window.DRB_INVESTMENTS[era.investSet];

      /* 이 턴에 이미 공개된 참여 조들의 선택 (아직 안 한 조는 보이지 않는다) */
      var known = (data.turnRoles[turn] || []).slice();

      var picked = [];
      (window.DRB_RIVALS || []).forEach(function (r) {
        var rv = data.rivals[r.id];
        if (!rv) return;

        var unit = CFG.tokenUnit;
        var budget = rv.state.cash >= sub.budget
          ? sub.budget
          : Math.max(unit, Math.floor(Math.max(0, rv.state.cash) / unit) * unit);

        var crowdByRole = Engine.computeCrowding(known.concat(picked));
        var decision = Engine.decideRival(r, rv.state, era, investments, {
          budget: budget, crowdByRole: crowdByRole, turnIndex: turn
        });
        picked.push(decision.topRole);

        var out = Engine.runSubround({
          state: rv.state, era: era, investments: investments,
          policy: decision.policy, policyId: decision.policyId,
          prevPolicyId: rv.prevPolicyId,
          allocation: decision.allocation, choices: decision.choices,
          subround: sub, turnIndex: turn,
          crowding: (crowdByRole[decision.topRole] || 0)
        });

        rv.state = out.state;
        rv.prevPolicyId = decision.policyId;
        rv.history.push({
          turn: turn, year: sub.year,
          role: decision.topRole,
          move: decision.moveText,
          revenue: out.report.kpi.revenue,
          profit: out.report.kpi.profit,
          tech: out.state.tech,
          capacity: out.state.capacity
        });
        rv.moves.push({ turn: turn, year: sub.year, text: decision.moveText });
      });

      /* 경쟁사가 고른 분야도 '공개된 움직임'에 합류 */
      data.turnRoles[turn] = known.concat(picked);
      data.rivalTurn++;
    }
    save();
  }

  /* 우리 조가 이번 턴에 가장 많이 넣은 분야 */
  function topRoleOf(allocation, investments) {
    var best = null, v = 0;
    Object.keys(allocation || {}).forEach(function (k) {
      if (allocation[k] > v) { v = allocation[k]; best = k; }
    });
    var item = investments.filter(function (i) { return i.id === best; })[0];
    return item ? (item.role || "capacity") : "cash";
  }

  /* ============================================================
     현재 위치
     ============================================================ */
  function g()             { return data; }
  function team()          { return data.teams[data.activeTeam]; }
  function teamNames()     { return data.teamNames; }
  function round()         { return window.DRB_ROUNDS[team().roundIndex]; }
  function subround()      { return round().subrounds[team().subIndex]; }
  function era()           { return window.DRB_ERAS[round().era]; }
  function investments()   { return window.DRB_INVESTMENTS[era().investSet]; }
  function availableInvestments() {
    var step = team().subIndex;
    return investments().filter(function (item) {
      return (Number(item.unlockSubround) || 0) <= step;
    });
  }

  /* 참가자 화면용 의사결정 범위. 엔진은 investments()의 전체 목록을 계속 사용합니다. */
  function investmentDecisionContext() {
    var visible = availableInvestments();
    var groupDefs = window.DRB_INVESTMENT_GROUPS || {};
    var seen = {};
    var groups = [];

    visible.forEach(function (item) {
      var id = item.strategyGroup || "resilience";
      if (seen[id]) return;
      seen[id] = true;
      var def = groupDefs[id] || {};
      groups.push({
        id: id,
        order: def.order || 99,
        name: def.name || id,
        cue: def.cue || ""
      });
    });
    groups.sort(function (a, b) { return a.order - b.order; });

    var meta = (window.DRB_DECISION_COMPLEXITY || {})[subround().id] || {};
    return {
      visibleCount: visible.length,
      totalCount: investments().length,
      level: meta.level || (turnIndex() + 1),
      totalLevels: totalTurns(),
      label: meta.label || "의사결정",
      newDimensions: (meta.newDimensions || []).slice(),
      newlyUnlocked: visible.filter(function (item) {
        return (Number(item.unlockSubround) || 0) === team().subIndex;
      }).map(function (item) { return item.id; }),
      groups: groups,
      grouped: era().id === "era3"
    };
  }
  function policies()      { return window.DRB_POLICIES[era().policySet]; }
  function actual()        { return window.DRB_ACTUAL[round().actualId]; }
  function phase()         { return team().phase; }

  /* 통산 턴 번호 — 지연효과(다음 턴/두 턴 뒤)를 세는 기준 */
  function turnIndex() {
    var t = team();
    var n = 0;
    for (var i = 0; i < t.roundIndex; i++) {
      n += window.DRB_ROUNDS[i].subrounds.length;
    }
    return n + t.subIndex;
  }

  function totalTurns() {
    return window.DRB_ROUNDS.reduce(function (a, r) { return a + r.subrounds.length; }, 0);
  }

  function isLastSubround() {
    return team().subIndex >= round().subrounds.length - 1;
  }

  function isLastRound() {
    return team().roundIndex >= window.DRB_ROUNDS.length - 1;
  }

  /* 이번 턴에 실제로 쓸 수 있는 예산
     현금이 모자라면 예산도 줄어듭니다. 다만 아무것도 못 하는 상황은
     교육상 의미가 없으므로 최소 1토큰(비상 운영자금)은 남겨 둡니다. */
  function budget() {
    var b = subround().budget;
    var cash = team().state.cash;
    if (cash >= b) return b;
    var unit = CFG.tokenUnit;
    return Math.max(unit, Math.floor(Math.max(0, cash) / unit) * unit);
  }

  /* 예산이 현금 부족으로 깎였는지 (화면 안내용) */
  function budgetIsTight() {
    return budget() < subround().budget;
  }

  /* ============================================================
     진행
     ============================================================ */
  function setPhase(p) {
    team().phase = p;
    save();
  }

  function switchTeam(name) {
    if (!data.teams[name]) return;
    data.activeTeam = name;
    save();
  }

  function commitSubround(allocation, policyId, choices) {
    var t = team();
    var turn = turnIndex();
    var Engine = window.DRBEngine;

    /* 1) 경쟁사를 이 턴까지 움직인다 (우리보다 먼저 판단하고 먼저 움직입니다) */
    advanceRivals(turn);

    /* 2) 같은 분야에 몇 곳이 몰렸는가 — 경쟁강도로 반영된다 */
    var myRole = topRoleOf(allocation, investments());
    var known = (data.turnRoles[turn] || []).slice();
    var crowdMap = Engine.computeCrowding(known.concat([myRole]));
    var crowding = crowdMap[myRole] || 0;

    var result = Engine.runSubround({
      state:        t.state,
      era:          era(),
      investments:  investments(),
      policy:       policies().filter(function (p) { return p.id === policyId; })[0],
      policyId:     policyId,
      prevPolicyId: t.prevPolicyId,
      allocation:   allocation,
      choices:      choices || {},
      subround:     subround(),
      turnIndex:    turn,
      crowding:     crowding
    });

    /* 우리 선택도 이제 '공개된 움직임'이 된다 */
    data.turnRoles[turn] = known.concat([myRole]);

    var before = JSON.parse(JSON.stringify(t.state));
    t.state        = result.state;
    t.prevPolicyId = policyId;
    t.policyId     = policyId;
    t.history.push({
      roundId:    round().id,
      roundNo:    round().no,
      subroundId: subround().id,
      subTitle:   subround().title,
      eraLabel:   era().yearLabel,
      allocation: allocation,
      choices:    choices || {},
      policyId:   policyId,
      policyName: result.report.policyName,
      report:     result.report,
      before:     before,
      after:      JSON.parse(JSON.stringify(result.state)),
      rivalMoves: rivalMovesAt(turn),
      year:       subround().year
    });

    save();
    return result;
  }

  /* 그 턴에 경쟁사들이 무엇을 했는지 (타임랩스·진행자 화면용) */
  function rivalMovesAt(turn) {
    var out = [];
    Object.keys(data.rivals || {}).forEach(function (id) {
      var mv = (data.rivals[id].moves || []).filter(function (m) { return m.turn === turn; })[0];
      if (mv) out.push({ id: id, name: data.rivals[id].name, text: mv.text, year: mv.year });
    });
    return out;
  }

  function rivals() {
    return Object.keys(data.rivals || {}).map(function (id) { return data.rivals[id]; });
  }

  /* 우리 회사가 경쟁사들과 견줘 어디쯤 있는가 (상대적 경쟁력) */
  function relativeStanding() {
    var mine = team().state;
    var rs = rivals();
    if (!rs.length) return null;

    function avg(key) {
      var sum = 0;
      rs.forEach(function (r) { sum += (r.state[key] || 0); });
      return sum / rs.length;
    }

    return ["tech", "capacity", "quality", "trust", "cash"].map(function (k) {
      var a = avg(k);
      var diff = mine[k] - a;
      return {
        key: k,
        mine: Math.round(mine[k]),
        rivalAvg: Math.round(a),
        diff: Math.round(diff),
        ahead: diff >= 0
      };
    });
  }

  function advance() {
    var t = team();
    if (!isLastSubround()) {
      t.subIndex++;
      t.phase = "situation";
    } else if (!isLastRound()) {
      t.roundIndex++;
      t.subIndex = 0;
      t.phase = "roundOpen";
    } else {
      t.phase = "final";
      t.finished = true;
    }
    save();
    return t.phase;
  }

  function lastHistory() {
    var h = team().history;
    return h.length ? h[h.length - 1] : null;
  }

  /* ============================================================
     결과 코드 (진행자 화면으로 옮길 때 사용)
     ============================================================ */
  function exportTeamCode(teamName) {
    var t = data.teams[teamName || data.activeTeam];
    var payload = {
      v: 3,
      exportedAt: new Date().toISOString(),
      t: t.name,
      s: t.state,
      w: t.reason,
      g: t.gapPick,
      p: t.history.map(function (h) {
        return {
          r: h.roundNo,
          sr: h.subroundId,
          a: h.allocation,
          pol: h.policyName,
          rev: h.report.kpi.revenue,
          pro: h.report.kpi.profit,
          y: h.year,
          title: h.subTitle,
          pid: h.policyId,
          ch: h.choices || {},
          ev: (h.report.events || []).map(function (event) {
            return {
              id: event.id,
              title: event.title,
              reactions: (event.reactions || []).map(function (reaction) {
                return { text: reaction.text, positive: !!reaction.positive };
              })
            };
          }),
          kpi: {
            revenue: h.report.kpi.revenue,
            profit: h.report.kpi.profit
          },
          before: { cash: h.before && h.before.cash },
          after: { cash: h.after && h.after.cash }
        };
      })
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }

  function decodeTeamCode(code) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    } catch (e) {
      return null;
    }
  }

  /* ============================================================
     관리자 모드 (계산 근거 보기)
     ============================================================ */
  function toggleAdmin() {
    data.adminMode = !data.adminMode;
    save();
    return data.adminMode;
  }

  return {
    save: save, load: load, hasSave: hasSave, clearAll: clearAll,
    newGame: newGame,
    g: g, team: team, teamNames: teamNames,
    round: round, subround: subround, era: era, phase: phase,
    investments: investments, availableInvestments: availableInvestments,
    investmentDecisionContext: investmentDecisionContext,
    policies: policies, actual: actual,
    turnIndex: turnIndex, totalTurns: totalTurns,
    isLastSubround: isLastSubround, isLastRound: isLastRound,
    budget: budget, budgetIsTight: budgetIsTight,
    setPhase: setPhase, switchTeam: switchTeam,
    commitSubround: commitSubround, advance: advance, lastHistory: lastHistory,
    rivals: rivals, relativeStanding: relativeStanding, advanceRivals: advanceRivals,
    turnToPosition: turnToPosition,
    exportTeamCode: exportTeamCode, decodeTeamCode: decodeTeamCode,
    toggleAdmin: toggleAdmin
  };
})();
