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
      /* 노트북은 배분 화면 하나로 돕니다 — 설명과 결과는 진행자 빔에서 봅니다 */
      phase: "invest"
    };
  }

  /* 경쟁사 수는 진행자가 세션을 만들 때 1~3 중에서 고릅니다.
     ★ 모든 조가 같은 수를 써야 합니다 — 경쟁사는 수요를 나눠 갖기 때문에
       조마다 수가 다르면 같은 결정에도 매출이 갈립니다. */
  function newGame(teamCount, rivalCount) {
    var names = CFG.teamNames.slice(0, teamCount);
    var teams = {};
    names.forEach(function (n) { teams[n] = createTeam(n); });

    var howManyRivals = Math.max(1, Math.min(3, Number(rivalCount) || 3));

    /* AI 경쟁사도 같은 조건에서 출발합니다 */
    var rivals = {};
    activeRivalDefs(howManyRivals).forEach(function (r) {
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
      rivalCount: howManyRivals,
      teamNames: names,
      activeTeam: names[0],
      adminMode: false,
      rivals: rivals,
      rivalTurn: 0,        // 경쟁사가 어디까지 진행했는가
      turnRoles: {},       // { turnIndex: [role, ...] } — 어느 분야에 몰렸는지
      awards: {}           // { turnIndex: { 기회id: [딴 조 이름] } } — 한 곳만 딸 수 있는 기회
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
  /* 지금 판에 들어와 있는 경쟁사만. 목록 앞에서부터 잘라 씁니다. */
  function activeRivalDefs(count) {
    var many = Math.max(1, Math.min(3, Number(count != null ? count : (data && data.rivalCount)) || 3));
    return (window.DRB_RIVALS || []).slice(0, many);
  }

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
      activeRivalDefs().forEach(function (r) {
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

  /* 국면 하나가 담당하는 기간 — '이 국면 연도 ~ 다음 국면 연도'.
     결정은 그 해에 내리고, 결과는 다음 국면 직전까지 흐릅니다.
     기간을 따로 적어두지 않고 여기서 뺍니다. 두 군데 적으면 반드시 어긋납니다.
     (마지막 국면 2026은 뒤가 없습니다 — to 가 null 입니다) */
  function subroundSpan(subroundId) {
    var flat = [];
    window.DRB_ROUNDS.forEach(function (r) {
      r.subrounds.forEach(function (s) { flat.push(s); });
    });
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].id !== subroundId) continue;
      var to = flat[i + 1] ? flat[i + 1].year : null;
      return { from: flat[i].year, to: to, years: to === null ? 0 : to - flat[i].year };
    }
    return null;
  }

  function isLastSubround() {
    return team().subIndex >= round().subrounds.length - 1;
  }

  function isLastRound() {
    return team().roundIndex >= window.DRB_ROUNDS.length - 1;
  }

  /* 이번 국면에 배정되는 예산 — 고정 예산 + 지난 국면 성과.
     회사를 잘 굴려 이익을 냈으면 다음 국면에 더 쓸 수 있어야 합니다.
     계수는 config.js 의 budget 에 있습니다. 첫 국면은 지난 실적이 없어 고정 그대로입니다. */
  function plannedBudget() {
    var fixed = subround().budget;
    var st = team().state;
    var revenue = st.lastRevenue || 0;
    if (revenue <= 0) return fixed;

    var B = CFG.budget || {};
    var perPoint = B.perPoint === undefined ? 1.5 : B.perPoint;
    var maxUp    = B.maxUp    === undefined ? 0.40 : B.maxUp;
    var maxDown  = B.maxDown  === undefined ? 0.10 : B.maxDown;
    var base     = B.baseMargin === undefined ? 0.10 : B.baseMargin;

    var adjust = ((st.lastProfit || 0) / revenue - base) * perPoint;
    if (adjust >  maxUp)   adjust =  maxUp;
    if (adjust < -maxDown) adjust = -maxDown;

    var unit = CFG.tokenUnit;
    return Math.max(unit, Math.round(fixed * (1 + adjust) / unit) * unit);
  }

  /* 이번 턴에 실제로 쓸 수 있는 예산
     현금이 모자라면 예산도 줄어듭니다. 다만 아무것도 못 하는 상황은
     교육상 의미가 없으므로 최소 1토큰(비상 운영자금)은 남겨 둡니다. */
  function budget() {
    var b = plannedBudget();
    var cash = team().state.cash;
    if (cash >= b) return b;
    var unit = CFG.tokenUnit;
    return Math.max(unit, Math.floor(Math.max(0, cash) / unit) * unit);
  }

  /* 예산이 현금 부족으로 깎였는지 (화면 안내용) */
  function budgetIsTight() {
    return budget() < plannedBudget();
  }

  /* 예산이 어떻게 나온 숫자인지 — 화면에서 그대로 보여줍니다.
     "왜 이번엔 80이지?" 에 답할 수 있어야 합니다. */
  function budgetBreakdown() {
    var st = team().state;
    var revenue = st.lastRevenue || 0;
    var planned = plannedBudget();
    var fixed = subround().budget;
    return {
      fixed:   fixed,
      planned: planned,
      final:   budget(),
      bonus:   planned - fixed,
      margin:  revenue > 0 ? (st.lastProfit || 0) / revenue : null,
      tight:   budgetIsTight()
    };
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
      crowding:     crowding,
      /* 한 곳만 딸 수 있는 기회 — 판정이 났으면 그대로 쓰고,
         아직이면 아무 효과도 주지 않은 채 넘어갑니다 (뒤에서 다시 계산합니다) */
      teamName:     data.activeTeam,
      awards:       (data.awards || {})[turn] || null
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
      year:       subround().year,
      crowding:   crowding
    });

    /* 한 대로 여러 조를 돌리는 연습 모드에서는 여기서 판정합니다 —
       모든 조가 이 국면을 확정한 그 순간입니다. 라이브 세션에서는 이 브라우저가
       우리 조밖에 모르므로, 진행자 화면이 판정해서 applyAwards() 로 알려줍니다. */
    awardLocally(turn);

    save();
    return result;
  }

  /* ============================================================
     한 곳만 딸 수 있는 기회 — 판정과 재계산

     확정하는 순간에는 아직 다른 조가 결정 중입니다. 그래서 이 기회는
     효과 없이 넘어가 두었다가, 모든 조가 잠긴 뒤에 판정하고
     그 국면을 통째로 다시 계산합니다. 먼저 낸 조가 유리하면 안 됩니다.
     ============================================================ */

  /* 이 국면에 한정 기회가 걸려 있는데 아직 판정이 안 났는가 */
  function awaitingAward(turn) {
    var t = typeof turn === "number" ? turn : turnIndex();
    var subs = allSubroundList();
    if (!subs[t]) return false;
    if (!window.DRBEngine.limitedOffers(subs[t]).length) return false;
    return !((data.awards || {})[t]);
  }

  function allSubroundList() {
    var out = [];
    window.DRB_ROUNDS.forEach(function (r) { r.subrounds.forEach(function (s) { out.push(s); }); });
    return out;
  }

  /* 이 브라우저가 아는 모든 조로 판정합니다 (연습 모드) */
  function awardLocally(turn) {
    var subs = allSubroundList();
    var offers = window.DRBEngine.limitedOffers(subs[turn]);
    if (!offers.length || (data.awards || {})[turn]) return;

    var names = Object.keys(data.teams);
    var bidders = [];
    for (var i = 0; i < names.length; i++) {
      var h = data.teams[names[i]].history[turn];
      if (!h) return;                     // 아직 다 확정하지 않았습니다
      bidders.push({ team: names[i], state: h.before, allocation: h.allocation, policyId: h.policyId });
    }
    if (bidders.length < 2) return;       // 혼자면 경쟁이 아닙니다

    var verdict = {};
    offers.forEach(function (entry) {
      verdict[entry.offer.id] = window.DRBEngine.awardLimited(entry, bidders).winners;
    });
    applyAwards(turn, verdict, true);
  }

  /* 판정 결과를 받아 그 국면을 다시 계산합니다.
     allTeams=true 면 이 브라우저가 아는 모든 조를, 아니면 지금 조만 다시 셉니다. */
  function applyAwards(turn, verdict, allTeams) {
    if (!verdict) return false;
    data.awards = data.awards || {};
    if (data.awards[turn] && JSON.stringify(data.awards[turn]) === JSON.stringify(verdict)) return false;
    data.awards[turn] = verdict;

    var names = allTeams ? Object.keys(data.teams) : [data.activeTeam];
    var changed = false;
    names.forEach(function (name) {
      if (recomputeTurn(name, turn, verdict)) changed = true;
    });
    save();
    return changed;
  }

  /* 저장해둔 '결정 직전 상태 + 그때 넣은 배분' 으로 그 국면을 다시 계산합니다.
     ⚠ 이미 다음 국면으로 넘어간 뒤에는 다시 세지 않습니다 — 그 뒤 기록까지
       전부 어긋나기 때문입니다. 판정은 그 국면 안에서 끝나야 합니다. */
  function recomputeTurn(name, turn, verdict) {
    var t = data.teams[name];
    if (!t || t.history.length !== turn + 1) return false;
    var h = t.history[turn];
    if (!h) return false;

    var subs = allSubroundList();
    var sub = subs[turn];
    var roundOf = null, eraOf = null;
    var n = 0;
    window.DRB_ROUNDS.forEach(function (r) {
      r.subrounds.forEach(function (s) {
        if (n === turn) { roundOf = r; eraOf = window.DRB_ERAS[r.era]; }
        n++;
      });
    });
    if (!eraOf) return false;

    var invSet = window.DRB_INVESTMENTS[eraOf.investSet] || [];
    var polSet = window.DRB_POLICIES[eraOf.policySet] || [];
    var result = window.DRBEngine.runSubround({
      state:        h.before,
      era:          eraOf,
      investments:  invSet,
      policy:       polSet.filter(function (p) { return p.id === h.policyId; })[0],
      policyId:     h.policyId,
      prevPolicyId: turn > 0 ? t.history[turn - 1].policyId : null,
      allocation:   h.allocation,
      choices:      h.choices || {},
      subround:     sub,
      turnIndex:    turn,
      crowding:     h.crowding || 0,
      teamName:     name,
      awards:       verdict
    });

    t.state       = result.state;
    h.report      = result.report;
    h.after       = JSON.parse(JSON.stringify(result.state));
    h.policyName  = result.report.policyName;
    return true;
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
      t.phase = "invest";
    } else if (!isLastRound()) {
      t.roundIndex++;
      t.subIndex = 0;
      t.phase = "invest";
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
    turnIndex: turnIndex, totalTurns: totalTurns, subroundSpan: subroundSpan,
    activeRivalDefs: activeRivalDefs,
    isLastSubround: isLastSubround, isLastRound: isLastRound,
    budget: budget, budgetIsTight: budgetIsTight,
    plannedBudget: plannedBudget, budgetBreakdown: budgetBreakdown,
    applyAwards: applyAwards, awaitingAward: awaitingAward,
    setPhase: setPhase, switchTeam: switchTeam,
    commitSubround: commitSubround, advance: advance, lastHistory: lastHistory,
    rivals: rivals, relativeStanding: relativeStanding, advanceRivals: advanceRivals,
    turnToPosition: turnToPosition,
    exportTeamCode: exportTeamCode, decodeTeamCode: decodeTeamCode,
    toggleAdmin: toggleAdmin
  };
})();
