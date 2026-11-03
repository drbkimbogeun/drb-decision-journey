/* ============================================================
   meet.js — 「다시, 그 결정 앞에서」 윤혁님과의 대화, 슬라이드 진행

   표지 → 맞았을까, 틀렸을까 → (조 카드 덮인 면 ▶ 뒤집힘) × 조
     → 윤혁님과의 대화 → 우리들이 묻고싶은 이야기 → 앞으로의 DRB → 마무리.
   프레젠터 ▶ 한 번 = 한 장. 진행자는 마우스 없이 리모컨만 쥐고 있습니다.
   ▶ 는 PageDown 또는 →, ◀ 는 PageUp 또는 ← 로 들어옵니다. Home · Esc 는 처음으로.

   ★ 이 화면은 서버를 부르지 않습니다.
     진행자 화면이 [회고] 챕터를 열 때 이 PC 의 localStorage 에 복사해 둔 것을
     읽기만 합니다 — 간담회 자료(review.js)와 같은 저장분입니다.
     그래서 오전에 교육을 진행한 그 PC · 그 브라우저에서 열어야 합니다.

   ★ 회고 내용은 DRBReflect.card() 로 풉니다.
     진행자 화면 · 간담회 자료와 같은 함수라, 세 화면이 서로 다른 말을 하지 않습니다.

   ★ 뒤집은 카드에는 회고만 둡니다 — 어느 국면(연도 범위)인지, 그때 국내 · 해외가 어땠는지
     한 줄씩(rounds.js 의 recap), 그리고 조가 쓴 문장. 게임 속 국면 제목 · 그 조의 선택 ·
     그때 DRB 기록은 띄우지 않습니다. 사회자가 말로 묻습니다 (「애프터 토크 사회자 대본.md」).

   ★ 회고는 300자까지 들어옵니다. 길면 글자를 줄여 카드 한 장에 다 넣습니다.
     프레젠터로는 스크롤할 수 없으므로, 카드 안에 스크롤이 생기면 안 됩니다.

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
  /* 슬라이드 순서. 조 카드는 덮인 면(cover)과 뒤집은 면(open)이 한 장을 두 번 씁니다. */
  var steps = [];
  var cursor = 0;
  /* 음악을 켰는지. 브라우저는 키를 한 번 누르기 전에는 소리를 못 냅니다 —
     그래서 표지에서 첫 ▶ 는 음악만 켜고 화면은 표지에 둡니다. */
  var musicStarted = false;

  /* 회고 글자 크기 — 큰 것부터 대보고 카드에 들어가는 첫 크기를 씁니다 */
  var SAY_SIZES = ["xl", "l", "m", "s", "xs"];

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

  /* 회고를 남긴 조만, 조 순서대로 — 이것이 슬라이드에 나오는 조입니다 */
  function written() {
    return teamsNow.filter(function (team) { return team.reflection; });
  }

  /* 국면이 담당하는 기간 — '이 국면 연도 ~ 다음 국면 연도 직전' (rounds.js 머리말).
     마지막 국면은 결과가 없으므로 끝을 적지 않습니다. */
  function spanOf(turn) {
    var line = window.DRBReflect.timeline();
    var here = line[turn];
    if (!here) return "";
    var next = line[turn + 1];
    return here.sub.year + " ~" + (next ? " " + (next.sub.year - 1) : "");
  }

  function subOf(turn) {
    var spot = window.DRBReflect.timeline()[turn];
    return spot ? spot.sub : null;
  }

  /* ---------- 조 카드 한 장 (덮인 면 + 뒤집은 면) ---------- */
  function phaseDots(turn) {
    var out = "";
    for (var i = 0; i < 6; i++) out += "<i" + (i === turn ? " class='is-on'" : "") + "></i>";
    return out;
  }

  var IC_HOME = "<svg viewBox='0 0 32 32' fill='none' stroke='currentColor' stroke-width='2.6' stroke-linejoin='round'>" +
    "<path d='M5 15 L16 6 L27 15 V27 H5 Z'/><path d='M13 27 V19 H19 V27'/></svg>";
  var IC_GLOBE = "<svg viewBox='0 0 32 32' fill='none' stroke='currentColor' stroke-width='2.6'>" +
    "<circle cx='16' cy='16' r='11'/><ellipse cx='16' cy='16' rx='5' ry='11'/><line x1='5' y1='16' x2='27' y2='16'/></svg>";

  function cardSlide(team, index) {
    var name = esc(team.name);
    var reflection = team.reflection;
    /* 조가 보낸 것은 국면 id 하나입니다. 어느 국면인지는 여기서 붙입니다. */
    var picked = window.DRBReflect.card(team, reflection.pick);

    var head = "", era = "";
    if (picked) {
      var tag = picked.kind === "event" ? " · 돌발" : (picked.kind === "inner" ? " · 우리 상태" : "");
      head = "<span class='tcard__dots'>" + phaseDots(picked.turn) + "</span>" +
        "<span class='tcard__where'>" + (picked.turn + 1) + "국면 · " + esc(spanOf(picked.turn)) + tag + "</span>";
      var recap = (subOf(picked.turn) || {}).recap;
      if (recap) {
        era =
          "<div class='tcard__era'>" +
            "<div class='tcard__row'><span class='tcard__ic'>" + IC_HOME + "</span>" +
              "<span class='tcard__k'>국내</span><span class='tcard__v'>" + esc(recap.domestic) + "</span></div>" +
            "<div class='tcard__row'><span class='tcard__ic'>" + IC_GLOBE + "</span>" +
              "<span class='tcard__k'>해외</span><span class='tcard__v'>" + esc(recap.global) + "</span></div>" +
          "</div>";
      }
    }

    return "<section class='slide slide--card' data-slide='team-" + index + "'>" +
      "<div class='tcard' data-team='" + name + "'>" +
        "<div class='tcard__inner'>" +
          "<div class='tcard__face tcard__front' aria-hidden='false'>" +
            "<span class='tcard__eyebrow'>회고 카드</span>" +
            "<span class='tcard__name'>" + name + "</span>" +
          "</div>" +
          "<div class='tcard__face tcard__back' aria-hidden='true'>" +
            "<div class='tcard__head" + (picked && picked.kind !== "decision" ? " tcard__head--event" : "") + "'>" +
              head + "<b class='tcard__team'>" + name + "</b></div>" +
            era +
            "<div class='tcard__say'>" +
              "<span class='tcard__quote' aria-hidden='true'>“</span>" +
              "<p class='tcard__comment tcard__comment--xl'>" + esc(reflection.comment) + "</p>" +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</section>";
  }

  /* 회고가 카드 안에 다 들어가는 가장 큰 글자 — 보이는 장에서만 잴 수 있습니다 */
  function fitSay(slide) {
    var say = slide && slide.querySelector(".tcard__say");
    var text = say && say.querySelector(".tcard__comment");
    if (!say || !text || !say.clientHeight) return;
    for (var i = 0; i < SAY_SIZES.length; i++) {
      text.className = "tcard__comment tcard__comment--" + SAY_SIZES[i];
      if (say.scrollHeight <= say.clientHeight + 1) return;
    }
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

  /* ---------- 윤혁님과의 대화 — 조들이 회고를 쓴 시대 ----------
     같은 국면을 고른 조는 한 점 아래 나란히. 오래된 국면부터. */
  function fillEras(list) {
    var box = el("slEras");
    var byTurn = {};
    list.forEach(function (team) {
      var picked = window.DRBReflect.card(team, team.reflection.pick);
      if (!picked) return;
      (byTurn[picked.turn] = byTurn[picked.turn] || []).push(team.name);
    });
    var turns = Object.keys(byTurn).map(Number).sort(function (a, b) { return a - b; });
    box.classList.toggle("hidden", !turns.length);
    box.style.setProperty("--n", turns.length || 1);
    box.innerHTML = turns.length
      ? "<span class='eras__line' aria-hidden='true'></span>" +
        turns.map(function (turn) {
          return "<div class='eras__item'>" +
            "<i class='eras__dot' aria-hidden='true'></i>" +
            "<b class='eras__span'>" + esc(spanOf(turn)) + "</b>" +
            "<span class='eras__teams'>" + byTurn[turn].map(function (n) { return "<em>" + esc(n) + "</em>"; }).join("") + "</span>" +
          "</div>";
        }).join("")
      : "";
  }

  /* ---------- 음악 ----------
     게임을 시작할 때 나오는 평상시 곡(config.js 의 music.normal) 그대로입니다.
     표지 · 마무리는 게임과 같은 크기, 그 사이는 말소리를 덮지 않게 작게 깝니다. */
  function audio() { return window.DRBAudio || null; }

  function setVolumeFor(step) {
    var a = audio();
    if (!a || !musicStarted || !step) return;
    a.duck(!(step.kind === "title" || step.kind === "end"));
  }

  function paintSound() {
    var a = audio();
    var on = !!a && musicStarted && !a.isMuted();
    el("btnMtSound").textContent = on ? "음악 끄기" : "음악 켜기";
  }

  function startMusic() {
    var a = audio();
    if (!a) return;
    musicStarted = true;
    setVolumeFor(steps[cursor]);
    a.scene("normal");
    paintSound();
  }

  function toggleMusic() {
    var a = audio();
    if (!a) return;
    if (!musicStarted) { if (a.isMuted()) a.toggle(); startMusic(); return; }
    var off = a.toggle();
    if (!off) { setVolumeFor(steps[cursor]); a.scene("normal"); }
    paintSound();
  }

  /* ---------- 슬라이드 순서와 이동 ---------- */
  function buildSteps() {
    var list = written();
    steps = [{ kind: "title", slide: "title" }, { kind: "why", slide: "why" }];
    list.forEach(function (team, i) {
      steps.push({ kind: "cover", slide: "team-" + i, team: team });
      steps.push({ kind: "open", slide: "team-" + i, team: team });
    });
    steps.push({ kind: "talk", slide: "talk" }, { kind: "ask", slide: "ask" },
      { kind: "future", slide: "future" }, { kind: "end", slide: "end" });
  }

  function show(index) {
    if (!steps.length) return;
    cursor = Math.max(0, Math.min(index, steps.length - 1));
    var step = steps[cursor];
    var on = null;
    Array.prototype.forEach.call(el("mtStage").querySelectorAll(".slide"), function (slide) {
      var hit = slide.dataset.slide === step.slide;
      slide.classList.toggle("is-on", hit);
      if (hit) on = slide;
    });
    /* 조 카드 — 덮인 면 / 뒤집은 면 */
    if (step.team && on) {
      var card = on.querySelector(".tcard");
      if (card) setFlipped(card, step.kind !== "cover");
      fitSay(on);
    }
    setVolumeFor(step);
  }

  function next() {
    var a = audio();
    if (steps[cursor] && steps[cursor].kind === "title" && !musicStarted && a && !a.isMuted()) {
      startMusic();
      return;
    }
    if (cursor < steps.length - 1) show(cursor + 1);
  }
  function prev() { if (cursor > 0) show(cursor - 1); }
  function first() {
    /* 처음으로 돌아가면 카드도 다시 덮습니다 */
    Array.prototype.forEach.call(el("mtStage").querySelectorAll(".tcard"), function (card) { setFlipped(card, false); });
    show(0);
  }

  /* ---------- 그리기 ---------- */
  function render(data) {
    var stage = el("mtStage");
    /* 지난번에 끼워 넣은 조 카드를 치웁니다 */
    Array.prototype.forEach.call(stage.querySelectorAll("[data-slide^='team-']"), function (n) { n.remove(); });

    var teams = data && data.teams ? data.teams : [];
    teamsNow = teams;
    var list = written();

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

    el("slTalk").insertAdjacentHTML("beforebegin", list.map(cardSlide).join(""));
    Array.prototype.forEach.call(stage.querySelectorAll(".tcard"), function (card) { setFlipped(card, false); });
    fillEras(list);

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
    } else if (key === "m" || key === "M") {
      event.preventDefault(); toggleMusic();
    }
  }

  function boot() {
    document.addEventListener("keydown", onKey);
    /* 마우스가 있으면 화면을 눌러도 다음 장으로 — 윗줄 버튼은 제외 */
    el("mtStage").addEventListener("click", function (event) {
      if (event.target.closest("a, button, select")) return;
      next();
    });
    el("btnMtReset").onclick = first;
    el("btnMtSound").onclick = toggleMusic;

    /* 빔 해상도가 바뀌거나 글꼴이 늦게 들어오면 회고 글자 크기를 다시 맞춥니다 */
    var refit = function () { fitSay(el("mtStage").querySelector(".slide--card.is-on")); };
    window.addEventListener("resize", refit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);

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

    paintSound();
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
