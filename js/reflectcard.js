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

  function policyName(id, fallback) {
    var name = fallback || "";
    Object.keys(window.DRB_POLICIES || {}).some(function (set) {
      return window.DRB_POLICIES[set].some(function (policy) {
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
  function choiceOf(team, subroundId) {
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
      policy: policyName(entry.policyId, entry.policyName),
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
      choice: choiceOf(team, spot.sub.id),
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

  return { card: card, timeline: timeline };
})();
