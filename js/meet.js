/* ============================================================
   meet.js — 「다시, 그 결정 앞에서」 윤혁님과의 만남, 슬라이드 진행

   표지 → 맞았을까 → 불확실성 → (조 카드 덮인 면 ▶ 뒤집힘 ▶ 그때 윤혁님은?) × 조 → 마무리.
   프레젠터 ▶ 한 번 = 한 장. 진행자는 마우스 없이 리모컨만 쥐고 있습니다.
   ▶ 는 PageDown 또는 →, ◀ 는 PageUp 또는 ← 로 들어옵니다. Home · Esc 는 처음으로.

   ★ 이 화면은 서버를 부르지 않습니다.
     진행자 화면이 [회고] 챕터를 열 때 이 PC 의 localStorage 에 복사해 둔 것을
     읽기만 합니다 — 간담회 자료(review.js)와 같은 저장분입니다.
     그래서 오전에 교육을 진행한 그 PC · 그 브라우저에서 열어야 합니다.

   ★ 회고 내용은 DRBReflect.card() 로 만듭니다.
     진행자 화면 · 간담회 자료와 같은 함수라, 세 화면이 서로 다른 말을 하지 않습니다.

   ★ '그때 DRB는' 은 actual_drb.js 의 확인된 기록(filled)만 보여줍니다.
     기록은 국면이 아니라 시대 단위입니다 — 국면에 맞춰 지어내지 않습니다.

   ★ 화면에는 질문을 띄우지 않습니다. '그때 윤혁님은?' 장은 그 한 줄뿐이고,
     질문은 「애프터 토크 사회자 대본.md」에서 사회자가 읽습니다.

   ★ 조 카드는 덮인 채로 나옵니다. 아직 이야기하지 않은 조의 것을 먼저 읽지 않게.
     회고를 남기지 않은 조는 건너뜁니다.
   ============================================================ */

(function () {
  "use strict";

  /* 보고 있는 세션. 비어 있으면 가장 최근 세션입니다.
     회고는 세션마다 따로 저장됩니다 (reflectcard.js — 최근 3개 세션). */
  var selected = "";
  /* 지금 그려진 조들 */
  var teamsNow = [];
  /* 슬라이드 순서. 조 카드는 덮인 면(cover)과 뒤집은 면(open)이 한 장을 두 번 쓰고, 그 뒤에 cue 가 옵니다. */
  var steps = [];
  var cursor = 0;

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

  /* 회고를 남긴 조만, 조 순서대로 — 이것이 슬라이드에 나오는 조입니다 */
  function written() {
    return teamsNow.filter(function (team) { return team.reflection; });
  }

  /* 긴 회고는 글자를 조금 줄입니다 — 빔에서 잘리는 것보다 낫습니다 (300자까지 들어옵니다) */
  function commentSize(text) {
    var n = String(text || "").length;
    if (n <= 80) return "xl";
    if (n <= 160) return "l";
    if (n <= 240) return "m";
    return "s";
  }

  /* ---------- 조 카드 한 장 (덮인 면 + 뒤집은 면) ---------- */
  function phaseDots(turn) {
    var out = "";
    for (var i = 0; i < 6; i++) out += "<i" + (i === turn ? " class='is-on'" : "") + "></i>";
    return out;
  }

  function cardSlide(team, index, count) {
    var name = esc(team.name);
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
        "<div class='tcard__phase tcard__phase--" + esc(picked.kind) + "'>" + phaseDots(picked.turn) +
          "<span>" + esc(picked.where) + "</span></div>" +
        "<h2 class='tcard__t'>" + esc(picked.title) + "</h2>" +
        (picked.situation ? "<p class='tcard__situation'>" + esc(picked.situation) + "</p>" : "") +
        "<span class='tcard__k'>이 조가 한 선택</span>" +
        "<span class='tcard__v'>" + esc(choice) + (picked.choice.policy ? " · " + esc(picked.choice.policy) : "") + "</span>";
    } else {
      said = "<p class='tcard__none'>고른 국면을 찾지 못했습니다.</p>";
    }
    said +=
      "<div class='tcard__say'>" +
        "<span class='tcard__k'>앞으로 이런 상황이 온다면</span>" +
        "<p class='tcard__comment tcard__comment--" + commentSize(reflection.comment) + "'>" + esc(reflection.comment) + "</p>" +
      "</div>";

    return "<section class='slide' data-slide='team-" + index + "'>" +
      "<div class='sl-head'><span class='sl-brand'>다시, 그 결정 앞에서</span>" +
        "<span class='sl-section'>조별 토크 · " + (index + 1) + " / " + count + "</span></div>" +
      "<h1 class='sl-h1'>" + name + "가 다시 이야기하고 싶은 결정</h1>" +
      "<div class='tcard' data-team='" + name + "'>" +
        "<div class='tcard__inner'>" +
          "<div class='tcard__face tcard__front' aria-hidden='false'>" +
            "<span class='tcard__eyebrow'>회고 카드</span>" +
            "<span class='tcard__name'>" + name + "</span>" +
          "</div>" +
          "<div class='tcard__face tcard__back" + (actual ? "" : " tcard__back--single") + "' aria-hidden='true'>" +
            "<div class='tcard__said'>" + said + "</div>" +
            (actual
              ? "<aside class='tcard__drb'>" +
                  "<span class='tcard__drb-k'>그때 DRB는 · " + esc(actual.year) + "</span>" +
                  paragraphs(actual.choice) +
                "</aside>"
              : "") +
          "</div>" +
        "</div>" +
      "</div>" +
    "</section>";
  }

  /* '그때 윤혁님은?' — 이 한 줄과 어느 조 · 어느 국면인지만. 질문은 대본에 있습니다. */
  function cueSlide(team, index, count) {
    var picked = window.DRBReflect.card(team, team.reflection.pick);
    var line = esc(team.name) + (picked ? " · " + esc(picked.where) + " · " + esc(picked.title) : "");
    return "<section class='slide' data-slide='cue-" + index + "'>" +
      "<div class='sl-head'><span class='sl-brand'>다시, 그 결정 앞에서</span>" +
        "<span class='sl-section'>조별 토크 · " + (index + 1) + " / " + count + "</span></div>" +
      "<div class='sl-cue'>" +
        "<h1 class='sl-h1 sl-h1--cue'>그때 윤혁님은?</h1>" +
        "<p class='sl-cue__line'>" + line + "</p>" +
      "</div>" +
    "</section>";
  }

  /* 뒤집힌 쪽만 읽을 수 있게 — 안 보이는 면은 키보드로도 닿지 않습니다 */
  function setFlipped(card, flipped) {
    var front = card.querySelector(".tcard__front");
    var back = card.querySelector(".tcard__back");
    if (!front || !back) return;
    card.classList.toggle("is-flipped", flipped);
    front.setAttribute("aria-hidden", flipped ? "true" : "false");
    back.setAttribute("aria-hidden", flipped ? "false" : "true");
  }

  /* ---------- 슬라이드 순서와 이동 ---------- */
  function buildSteps() {
    var list = written();
    steps = [{ kind: "title", slide: "title" }, { kind: "why", slide: "why" }, { kind: "future", slide: "future" }];
    list.forEach(function (team, i) {
      steps.push({ kind: "cover", slide: "team-" + i, team: team, last: i === list.length - 1 });
      steps.push({ kind: "open", slide: "team-" + i, team: team, last: i === list.length - 1 });
      steps.push({ kind: "cue", slide: "team-" + i, cue: "cue-" + i, team: team, last: i === list.length - 1 });
    });
    steps.push({ kind: "end", slide: "end" });
  }

  function hintFor(step) {
    if (step.kind === "title") return "▶ 시작";
    if (step.kind === "cover") return "▶ 카드 뒤집기";
    if (step.kind === "open") return "▶ 그때 윤혁님은?";
    if (step.kind === "cue") return step.last ? "▶ 마무리" : "▶ 다음 조";
    if (step.kind === "end") return "";
    return "▶";
  }

  function show(index) {
    if (!steps.length) return;
    cursor = Math.max(0, Math.min(index, steps.length - 1));
    var step = steps[cursor];
    var target = step.kind === "cue" ? step.cue : step.slide;
    Array.prototype.forEach.call(el("mtStage").querySelectorAll(".slide"), function (slide) {
      slide.classList.toggle("is-on", slide.dataset.slide === target);
    });
    /* 조 카드 — 덮인 면 / 뒤집은 면. cue 로 넘어가도 카드는 뒤집힌 채 둡니다 (◀ 로 돌아오면 그대로). */
    if (step.team) {
      var card = el("mtStage").querySelector("[data-slide='" + step.slide + "'] .tcard");
      if (card) setFlipped(card, step.kind !== "cover");
    }
    el("mtHint").textContent = hintFor(step);
    el("mtHint").classList.toggle("hidden", !hintFor(step));
  }

  function next() { if (cursor < steps.length - 1) show(cursor + 1); }
  function prev() { if (cursor > 0) show(cursor - 1); }
  function first() {
    /* 처음으로 돌아가면 카드도 다시 덮습니다 */
    Array.prototype.forEach.call(el("mtStage").querySelectorAll(".tcard"), function (card) { setFlipped(card, false); });
    show(0);
  }

  /* ---------- 그리기 ---------- */
  function fillSignals() {
    /* 6국면(2026) 빔에 뜨는 신호 그대로 — 국내 AI · 전기차 · 인구 · 탄소, 세계 관세 */
    var sub = null;
    (window.DRB_ROUNDS || []).forEach(function (round) {
      (round.subrounds || []).forEach(function (s) { if (s.id === "r3s2") sub = s; });
    });
    var brief = (sub && sub.briefing) || {};
    var d = brief.domestic || [], g = brief.global || [];
    var rows = [d[0], d[1], g[0], d[2], d[3]].filter(Boolean);
    /* "제목 — 풀이" 꼴이라, 제목은 크게 풀이는 작게 */
    el("slSignals").innerHTML = rows.map(function (row) {
      var parts = String(row.text).split(" — ");
      return "<li><b>" + esc(parts[0]) + "</b>" + (parts[1] ? "<span>" + esc(parts.slice(1).join(" — ")) + "</span>" : "") + "</li>";
    }).join("");
  }

  function render(data) {
    var stage = el("mtStage");
    /* 지난번에 끼워 넣은 조 카드 · cue 장을 치웁니다 */
    Array.prototype.forEach.call(stage.querySelectorAll("[data-slide^='team-'], [data-slide^='cue-']"), function (n) { n.remove(); });

    var teams = data && data.teams ? data.teams : [];
    teamsNow = teams;
    var list = written();

    el("slDate").textContent = data ? "교육일 " + stamp(data.savedAt) : "";
    el("slTeams").textContent = teams.length ? "1조부터 " + teams.length + "조까지" : "";
    el("mtMeta").textContent = data ? list.length + " / " + teams.length + "조 작성 · " + sessionLabel(data) : "";

    var state = el("slState");
    if (!list.length) {
      state.classList.remove("hidden");
      state.innerHTML =
        "<b>아직 저장된 회고가 없습니다.</b> " +
        "진행자 화면에서 [회고] 챕터를 열면 그때 이 PC 에 자동으로 저장됩니다. " +
        "오전에 교육을 진행한 그 PC · 그 브라우저에서 열어주세요.";
    } else {
      state.classList.add("hidden");
      state.innerHTML = "";
    }

    var html = list.map(function (team, i) { return cardSlide(team, i, list.length) + cueSlide(team, i, list.length); }).join("");
    el("slEnd").insertAdjacentHTML("beforebegin", html);
    Array.prototype.forEach.call(stage.querySelectorAll(".tcard"), function (card) { setFlipped(card, false); });

    buildSteps();
    show(0);
  }

  /* 프레젠터(리모컨)와 키보드. 세션 고르는 칸이나 버튼에 초점이 있을 때는 그쪽 몫입니다. */
  function onKey(event) {
    var tag = (event.target && event.target.tagName || "").toLowerCase();
    if (tag === "select" || tag === "input" || tag === "textarea") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    var key = event.key;
    if (tag === "button" && (key === " " || key === "Enter")) return;

    if (key === "ArrowRight" || key === "PageDown" || key === " " || key === "Enter") {
      event.preventDefault(); next();
    } else if (key === "ArrowLeft" || key === "PageUp" || key === "Backspace") {
      event.preventDefault(); prev();
    } else if (key === "Home" || key === "Escape") {
      event.preventDefault(); first();
    }
  }

  function boot() {
    fillSignals();
    document.addEventListener("keydown", onKey);
    /* 마우스가 있으면 화면을 눌러도 다음 장으로 — 윗줄 버튼은 제외 */
    el("mtStage").addEventListener("click", function (event) {
      if (event.target.closest("a, button, select")) return;
      next();
    });
    el("btnMtReset").onclick = first;

    /* 다른 세션을 고르면 처음부터 다시 시작합니다 */
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
