/* ============================================================
   meet.js — 대표님과의 만남 화면

   조마다 카드 한 장. 덮인 채로 시작하고, 누르면 뒤집혀 그 조의 회고가 나옵니다.

   ★ 이 화면은 서버를 부르지 않습니다.
     진행자 화면이 [회고] 챕터를 열 때 이 PC 의 localStorage 에 복사해 둔 것을
     읽기만 합니다 — 간담회 자료(review.js)와 같은 저장분입니다.
     그래서 오전에 교육을 진행한 그 PC · 그 브라우저에서 열어야 합니다.

   ★ 회고 내용은 DRBReflect.card() 로 만듭니다.
     진행자 화면 · 간담회 자료와 같은 함수라, 세 화면이 서로 다른 말을 하지 않습니다.

   ★ '그때 DRB는' 은 actual_drb.js 의 확인된 기록(filled)만 보여줍니다.
     기록은 국면이 아니라 시대 단위입니다 — 국면에 맞춰 지어내지 않습니다.
   ============================================================ */

(function () {
  "use strict";

  /* 보고 있는 세션. 비어 있으면 가장 최근 세션입니다.
     회고는 세션마다 따로 저장됩니다 (reflectcard.js — 최근 3개 세션). */
  var selected = "";

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
  }

  function stamp(value) {
    var when = value ? new Date(value) : new Date();
    return when.getFullYear() + "년 " + (when.getMonth() + 1) + "월 " + when.getDate() + "일";
  }

  function sessionLabel(session) {
    return "교육일 " + stamp(session.savedAt) + " · 세션 " + (session.sessionId || "로컬") +
      " · " + session.teams.length + "개 조";
  }

  function current(list) {
    return list.filter(function (s) { return s.id === selected; })[0] || list[0] || null;
  }

  /* 세션이 둘 이상일 때만 고르는 칸을 보여줍니다 */
  function paintPicker(list, now) {
    var pick = el("mtSession");
    pick.innerHTML = list.map(function (s) {
      return "<option value='" + esc(s.id) + "'" + (now && s.id === now.id ? " selected" : "") + ">" +
        esc(sessionLabel(s)) + "</option>";
    }).join("");
    pick.classList.toggle("hidden", list.length < 2);
    el("btnMtDelete").classList.toggle("hidden", !now);
  }

  /* 빈 줄로 나뉜 문단을 그대로 살립니다 (actual_drb.js 의 글은 문단으로 적혀 있습니다) */
  function paragraphs(text) {
    return String(text || "").split(/\n\s*\n/).map(function (block) {
      return "<p>" + esc(block.trim()).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  /* 조가 고른 국면이 속한 시대의 DRB 실제 기록 */
  function actualOf(pickId) {
    var subId = String(pickId || "").split(":")[1];
    var spot = window.DRBReflect.timeline().filter(function (item) { return item.sub.id === subId; })[0];
    if (!spot) return null;
    var actual = (window.DRB_ACTUAL || {})[spot.round.actualId];
    return actual && actual.filled ? actual : null;
  }

  /* 조가 몇이든 한 화면에 들어오게 — 4개 조는 2 × 2, 5~6개 조는 3 × 2 */
  function columnsFor(count) {
    if (count <= 3) return Math.max(count, 1);
    if (count === 4) return 2;
    return 3;
  }

  function backHtml(team) {
    var reflection = team.reflection;
    /* 조가 보낸 것은 국면 id 하나입니다. 상황과 그 조의 선택은 여기서 붙입니다. */
    var picked = window.DRBReflect.card(team, reflection.pick);
    var actual = actualOf(reflection.pick);

    var said;
    if (picked) {
      var choice = picked.choice.top.length
        ? picked.choice.top.map(function (t) { return t.name + " " + t.amount; }).join(" · ")
        : "투자 없음";
      said =
        "<div class='mcard__when mcard__when--" + esc(picked.kind) + "'>" + esc(picked.where) + "</div>" +
        "<h2 class='mcard__title'>" + esc(picked.title) + "</h2>" +
        (picked.situation ? "<p class='mcard__situation'>" + esc(picked.situation) + "</p>" : "") +
        "<div class='mcard__choice'>" +
          "<span class='mcard__label'>이 조가 한 선택</span>" +
          "<span class='mcard__value'>" + esc(choice) +
          (picked.choice.policy ? " · " + esc(picked.choice.policy) : "") + "</span>" +
        "</div>";
    } else {
      said = "<p class='mcard__none'>고른 국면을 찾지 못했습니다.</p>";
    }
    said +=
      "<div class='mcard__say'>" +
        "<span class='mcard__label'>앞으로 이런 상황이 온다면</span>" +
        "<p class='mcard__comment'>" + esc(reflection.comment) + "</p>" +
      "</div>";

    return "<div class='mcard__cols'>" +
      "<div class='mcard__said'>" + said + "</div>" +
      (actual
        ? "<aside class='mcard__drb'>" +
            "<span class='mcard__drb-label'>그때 DRB는 · " + esc(actual.year) + "</span>" +
            paragraphs(actual.choice) +
          "</aside>"
        : "") +
    "</div>";
  }

  function cardHtml(team) {
    var name = esc(team.name);
    if (!team.reflection) {
      return "<article class='mcard mcard--empty'>" +
        "<span class='mcard__name'>" + name + "</span>" +
        "<p class='mcard__none'>회고를 남기지 않았습니다</p>" +
      "</article>";
    }
    return "<article class='mcard' data-team='" + name + "'>" +
      "<div class='mcard__inner'>" +
        "<button class='mcard__face mcard__front' type='button' aria-label='" + name + " 카드 뒤집기'>" +
          "<span class='mcard__eyebrow'>회고</span>" +
          "<span class='mcard__name'>" + name + "</span>" +
          "<span class='mcard__hint'>눌러서 뒤집기</span>" +
        "</button>" +
        "<div class='mcard__face mcard__back' aria-hidden='true'>" +
          "<div class='mcard__bar'>" +
            "<span class='mcard__team'>" + name + "</span>" +
            "<span class='spacer'></span>" +
            "<button class='btn btn--sm btn--ghost mcard__close' type='button'>덮기</button>" +
          "</div>" +
          backHtml(team) +
        "</div>" +
      "</div>" +
    "</article>";
  }

  /* 뒤집힌 쪽만 누르고 읽을 수 있게 합니다. 안 보이는 면은 키보드로도 닿지 않습니다. */
  function setFlipped(card, flipped) {
    var front = card.querySelector(".mcard__front");
    var back = card.querySelector(".mcard__back");
    if (!front || !back) return;
    card.classList.toggle("is-flipped", flipped);
    front.inert = flipped;
    back.inert = !flipped;
    back.setAttribute("aria-hidden", flipped ? "false" : "true");
  }

  function render(data) {
    var grid = el("mtGrid");
    var state = el("mtState");
    grid.innerHTML = "";

    var teams = data && data.teams ? data.teams : [];
    var written = teams.filter(function (team) { return team.reflection; });

    if (!written.length) {
      state.className = "mt-state";
      state.innerHTML =
        "<b>아직 저장된 회고가 없습니다.</b><br>" +
        "진행자 화면에서 <b>[회고]</b> 챕터를 열면 그때 이 PC 에 자동으로 저장됩니다. " +
        "오전에 교육을 진행한 그 PC · 그 브라우저에서 열어주세요.";
      el("mtWhen").textContent = "";
      el("mtMeta").textContent = "";
      return;
    }

    state.className = "mt-state hidden";
    el("mtWhen").textContent = sessionLabel(data);
    el("mtMeta").textContent = written.length + " / " + teams.length + "조 작성";

    grid.style.setProperty("--cols", String(columnsFor(teams.length)));
    grid.innerHTML = teams.map(cardHtml).join("");
    Array.prototype.forEach.call(grid.querySelectorAll(".mcard[data-team]"), function (card) {
      setFlipped(card, false);
    });
  }

  function boot() {
    el("mtGrid").addEventListener("click", function (event) {
      var front = event.target.closest(".mcard__front");
      var close = event.target.closest(".mcard__close");
      if (!front && !close) return;
      var card = (front || close).closest(".mcard");
      setFlipped(card, !!front);
      /* 뒤집은 뒤에도 키보드가 그 카드에 머물게 합니다 */
      var next = card.querySelector(front ? ".mcard__close" : ".mcard__front");
      if (next) next.focus({ preventScroll: true });
    });

    el("btnMtReset").onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll(".mcard[data-team]"), function (card) {
        setFlipped(card, false);
      });
    };

    /* 다른 세션을 고르면 카드는 다시 덮인 채로 시작합니다 */
    el("mtSession").onchange = function () {
      selected = this.value;
      refresh();
    };
    el("btnMtDelete").onclick = function () {
      var now = current(window.DRBReflect.sessions());
      if (!now) return;
      if (!window.confirm("이 세션의 회고를 이 PC 에서 지울까요?\n\n" + sessionLabel(now) +
                          "\n\n지우면 되돌릴 수 없습니다.")) return;
      if (!window.DRBReflect.removeSession(now.id)) {
        window.alert("지우지 못했습니다. 브라우저 저장 공간을 확인해주세요.");
      }
      selected = "";
      refresh();
    };

    refresh();
  }

  function refresh() {
    var list = window.DRBReflect.sessions();
    var now = current(list);
    selected = now ? now.id : "";
    paintPicker(list, now);
    render(now);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
