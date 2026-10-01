/* ============================================================
   reflectcard.js — 조가 고른 국면 하나를 카드 한 장으로 풀어줍니다

   조가 보내는 것은 국면 id 하나(pick)와 코멘트뿐입니다.
   그때 무슨 상황이었고 그 조가 무엇을 골랐는지는 여기서 붙입니다.

   진행자 화면(회고 챕터)과 간담회 자료(/review)가 같은 함수를 씁니다.
   한쪽만 고치면 두 화면이 서로 다른 말을 하게 됩니다.
   ============================================================ */

window.DRBReflect = (function () {
  "use strict";

  /* 국면 순서를 한 줄로 편 것 — 1국면 … 6국면 */
  function timeline() {
    var out = [];
    (window.DRB_ROUNDS || []).forEach(function (round) {
      round.subrounds.forEach(function (sub) {
        out.push({ round: round, sub: sub, turn: out.length });
      });
    });
    return out;
  }

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

  /* ★ 그 시대의 정책 목록에서만 찾습니다.
       정책 id 는 시대끼리 겹칩니다 — "growth" 가 era1 에서는 '공격적 성장',
       era2 에서는 '공격적 확장' 입니다. 예전에는 전 시대를 순서대로 뒤져
       먼저 걸리는 것을 썼기 때문에, 1997년에 '공격적 확장' 을 고른 조의
       회고 카드에 '공격적 성장' 이라고 적혔습니다 — 고르지도 않은 이름입니다. */
  function policyName(id, fallback, setKey) {
    var name = fallback || "";
    var all = window.DRB_POLICIES || {};
    var sets = setKey && all[setKey] ? [setKey] : Object.keys(all);
    sets.some(function (set) {
      return all[set].some(function (policy) {
        if (policy.id !== id) return false;
        name = policy.name;
        return true;
      });
    });
    return name;
  }

  /* 빔에서 읽을 만큼만. 문단을 통째로 띄우면 아무도 안 읽습니다. */
  function firstSentences(text, howMany) {
    var parts = String(text || "").split(/(?<=다\.)\s*/).filter(Boolean);
    return parts.slice(0, howMany || 2).join(" ").trim();
  }

  /* ★ DRB_EVENTS 는 { e1_material: {...}, c_claim: {...} } 꼴입니다.
       예전에는 시대별 배열인 줄 알고 Array.isArray 로 걸렀는데, 그게 늘 거짓이라
       사건 설명을 한 번도 못 찾았습니다. 회고 카드에 그때 무슨 일이었는지가
       안 나오고 "이 사건을 겪고 …" 라는 기본 문장만 떴습니다. */
  function eventBody(eventId) {
    var events = window.DRB_EVENTS;
    if (!events || !eventId) return "";
    var ev = events[eventId];
    if (!ev) {
      Object.keys(events).forEach(function (key) {
        if (!ev && events[key] && events[key].id === eventId) ev = events[key];
      });
    }
    return ev ? (ev.body || ev.description || "") : "";
  }

  /* 그 국면에 이 조가 실제로 무엇을 했는가 */
  function choiceOf(team, subroundId, policySet) {
    var entry = (team.history || []).filter(function (h) {
      return h.subroundId === subroundId;
    })[0];
    if (!entry) return { top: [], policy: "", found: false };

    var alloc = entry.allocation || {};
    var top = Object.keys(alloc)
      .filter(function (id) { return Number(alloc[id]) > 0; })
      .sort(function (a, b) { return Number(alloc[b]) - Number(alloc[a]); })
      .slice(0, 3)
      .map(function (id) { return { name: investName(id), amount: Number(alloc[id]) }; });

    return {
      top: top,
      policy: policyName(entry.policyId, entry.policyName, policySet),
      found: true,
    };
  }

  /* pick = "decision:r1s1" 또는 "event:r1s1:ev_id" */
  function card(team, pickId) {
    var parts = String(pickId || "").split(":");
    var spot = timeline().filter(function (item) { return item.sub.id === parts[1]; })[0];
    if (!spot) return null;

    var kind = parts[0] === "event" ? "event" : "decision";
    var out = {
      kind: kind,
      turn: spot.turn,
      where: (spot.turn + 1) + "국면 · " + spot.sub.year,
      year: spot.sub.year,
      /* 제목이 "첫 번째 국면 · 고무신인가" 라 앞머리가 위치표시와 겹칩니다 */
      title: String(spot.sub.title || "").replace(/^[^·]*번째 국면\s*·\s*/, ""),
      situation: firstSentences(spot.sub.situation && spot.sub.situation.body, 2),
      choice: choiceOf(team, spot.sub.id, (window.DRB_ERAS[spot.round.era] || {}).policySet),
    };

    if (kind === "event") {
      var title = "";
      /* 밖에서 온 돌발인지, 우리 회사 상태가 불러온 일인지 —
         기록에 남겨둔 conditional 로 갈립니다 (engine.js 참고) */
      var inner = false;
      (team.history || []).forEach(function (h) {
        (((h.report && h.report.events) || [])).forEach(function (event) {
          if (event && event.id === parts[2]) {
            if (event.title) title = event.title;
            inner = !!event.conditional;
          }
        });
      });
      out.kind = inner ? "inner" : "event";
      out.title = title || "돌발상황";
      out.where += inner ? " · 우리 상태" : " · 돌발";
      out.situation = firstSentences(eventBody(parts[2]), 2) ||
        "이 사건을 겪고 이 조가 내린 판단입니다.";
    }

    return out;
  }

  /* ============================================================
     세션별 회고 저장 — 이 PC 의 localStorage 에만 둡니다

     진행자 화면이 [회고] 챕터에서 저장하고, 간담회 자료와 만남 화면이 읽습니다.
     세 화면이 이 함수들만 씁니다 — 각자 저장 자리를 따로 다루면 반드시 어긋납니다.

     ★ 예전에는 자리가 하나(_review)뿐이었습니다. 다음 교육의 첫 회고가 들어오는
       순간 지난 교육의 회고가 통째로 덮였습니다 — 오전 교육 뒤 오후 교육을 하면
       오전 조의 만남에 띄울 것이 사라졌습니다. 이제 세션마다 한 묶음입니다.

     ★ KEEP 개까지만 남깁니다. 조가 직접 쓴 문장이 이 PC 에 끝없이 쌓이지 않게,
       더 들어오면 가장 먼저 한 교육부터 지웁니다.

     ★ savedAt 은 그 세션이 '처음' 저장된 시각입니다. 다시 저장해도 바꾸지 않습니다.
       진행자 화면은 그릴 때마다 저장하므로, 그때마다 시각을 새로 찍으면 지난 교육의
       진행자 화면을 다시 열기만 해도 그 세션이 오늘 교육으로 둔갑합니다.
     ============================================================ */
  var KEEP = 3;

  function storeKey(suffix) {
    var base = (window.DRB_CONFIG && window.DRB_CONFIG.storage && window.DRB_CONFIG.storage.key) || "drb_sim_v1";
    return base + suffix;
  }

  function readStored(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (err) { return null; }
  }

  /* 가장 최근에 한 교육이 앞. 예전 방식으로 남아 있는 한 묶음도 한 세션으로 칩니다. */
  function sessions() {
    var list = readStored(storeKey("_reviews"));
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (s) { return s && s.id && Array.isArray(s.teams); });

    var old = readStored(storeKey("_review"));
    if (old && Array.isArray(old.teams)) {
      var oldId = old.sessionId || ("legacy-" + (old.savedAt || ""));
      if (!list.some(function (s) { return s.id === oldId; })) {
        list.push({ id: oldId, savedAt: old.savedAt || "", sessionId: old.sessionId || "", teams: old.teams });
      }
    }

    list.sort(function (a, b) { return String(b.savedAt || "").localeCompare(String(a.savedAt || "")); });
    return list.slice(0, KEEP);
  }

  /* 저장에 실패하면 조용히 넘기지 않고 false 를 돌려줍니다 — 부른 쪽이 화면에 알립니다. */
  function writeSessions(list) {
    try {
      localStorage.setItem(storeKey("_reviews"), JSON.stringify(list.slice(0, KEEP)));
      localStorage.removeItem(storeKey("_review"));      // 예전 자리는 새 자리로 옮겨졌습니다
      return true;
    } catch (err) {
      console.error("회고를 이 PC 에 저장하지 못했습니다:", err);
      return false;
    }
  }

  /* record = { id, sessionId, teams }
     같은 id 는 그 자리의 내용만 갱신하고, 새 id 는 새 묶음이 됩니다. */
  function saveSession(record) {
    if (!record || !record.id) return false;
    var list = sessions();
    var teams = record.teams || [];
    var mine = list.filter(function (s) { return s.id === record.id; })[0];
    if (mine) {
      if (JSON.stringify(mine.teams) === JSON.stringify(teams)) return true;   // 바뀐 것이 없습니다
      mine.teams = teams;
    } else {
      list.unshift({ id: record.id, savedAt: new Date().toISOString(), sessionId: record.sessionId || "", teams: teams });
    }
    return writeSessions(list);
  }

  function removeSession(id) {
    return writeSessions(sessions().filter(function (s) { return s.id !== id; }));
  }

  return {
    card: card, timeline: timeline,
    sessions: sessions, saveSession: saveSession, removeSession: removeSession, KEEP: KEEP
  };
})();
