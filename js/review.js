/* ============================================================
   review.js — 간담회 자료 화면

   ★ 이 화면은 서버를 부르지 않습니다.
     진행자 화면이 [회고] 챕터를 열 때 이 PC 의 localStorage 에 자료를
     복사해 둡니다. 여기서는 그것을 읽어 보여주기만 합니다.

     그래서
       - 교육 세션이 24시간 뒤 지워져도 이 화면은 계속 열립니다
       - 새 탭에서 열어도 인증이 필요 없습니다 (localStorage 는 탭끼리 공유)
       - 인사자료를 서버에 더 오래 남기지 않습니다

   ★ 회고는 세션마다 따로 저장됩니다 (reflectcard.js — 최근 3개 세션).
     기본은 가장 최근에 한 교육이고, 위에서 지난 세션을 고를 수 있습니다.

   ⚠ 진행자 화면을 띄웠던 그 브라우저에서 열어야 합니다. 다른 PC 에는 없습니다.
   ============================================================ */

(function () {
  "use strict";

  /* 보고 있는 세션. 비어 있으면 가장 최근 세션입니다. */
  var selected = "";

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
  }
  function toast(message) {
    var node = el("toast");
    node.textContent = message;
    node.classList.add("is-show");
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.classList.remove("is-show"); }, 2600);
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
    var pick = el("rvSession");
    pick.innerHTML = list.map(function (s) {
      return "<option value='" + esc(s.id) + "'" + (now && s.id === now.id ? " selected" : "") + ">" +
        esc(sessionLabel(s)) + "</option>";
    }).join("");
    pick.classList.toggle("hidden", list.length < 2);
    el("btnRvDelete").classList.toggle("hidden", !now);
  }

  function render(data) {
    var list = el("rvList");
    var state = el("rvState");
    list.innerHTML = "";

    var written = data && data.teams
      ? data.teams.filter(function (team) { return team.reflection; })
      : [];

    if (!written.length) {
      state.className = "rv-state";
      state.innerHTML =
        "<b>아직 저장된 회고가 없습니다.</b><br>" +
        "진행자 화면에서 <b>[회고]</b> 챕터를 열면 그때 이 PC 에 자동으로 저장됩니다. " +
        "교육을 진행한 그 브라우저에서 열어주세요.";
      el("rvWhen").textContent = "";
      el("rvMeta").textContent = "";
      return;
    }

    state.className = "rv-state hidden";
    el("rvWhen").textContent = sessionLabel(data);
    el("rvMeta").textContent = written.length + " / " + data.teams.length + "조 작성";

    data.teams.forEach(function (team) {
      var card = document.createElement("article");
      card.className = "rvcard";

      if (!team.reflection) {
        card.classList.add("rvcard--empty");
        card.innerHTML =
          "<div class='rvcard__team'>" + esc(team.name) + "</div>" +
          "<p class='rvcard__none'>이 조는 회고를 남기지 않았습니다.</p>";
        list.appendChild(card);
        return;
      }

      /* 조가 보낸 것은 국면 id 하나입니다. 상황과 그 조의 선택은 여기서 붙입니다. */
      var picked = window.DRBReflect.card(team, team.reflection.pick);
      var choice = picked && picked.choice.top.length
        ? picked.choice.top.map(function (t) { return t.name + " " + t.amount; }).join(" · ")
        : "투자 없음";

      card.innerHTML =
        "<div class='rvcard__team'>" + esc(team.name) + "</div>" +
        (picked
          ? "<div class='rvcard__when'>" + esc(picked.where) +
              (picked.kind === "event" ? " · 돌발상황" : "") + "</div>" +
            "<h2 class='rvcard__title'>" + esc(picked.title) + "</h2>" +
            (picked.situation
              ? "<p class='rvcard__situation'>" + esc(picked.situation) + "</p>" : "") +
            "<div class='rvcard__choice'>" +
              "<span class='rvcard__label'>이 조가 한 선택</span>" +
              "<span class='rvcard__value'>" + esc(choice) +
              (picked.choice.policy ? " · " + esc(picked.choice.policy) : "") + "</span>" +
            "</div>"
          : "<p class='rvcard__none'>고른 국면을 찾지 못했습니다.</p>") +
        "<div class='rvcard__say'>" +
          "<span class='rvcard__label'>앞으로 이런 상황이 온다면</span>" +
          "<p class='rvcard__comment'>" + esc(team.reflection.comment) + "</p>" +
        "</div>";
      list.appendChild(card);
    });
  }

  function refresh() {
    var list = window.DRBReflect.sessions();
    var now = current(list);
    selected = now ? now.id : "";
    paintPicker(list, now);
    render(now);
  }

  function boot() {
    el("rvSession").onchange = function () {
      selected = this.value;
      refresh();
    };
    el("btnRvDelete").onclick = function () {
      var now = current(window.DRBReflect.sessions());
      if (!now) return;
      if (!window.confirm("이 세션의 회고를 이 PC 에서 지울까요?\n\n" + sessionLabel(now) +
                          "\n\n지우면 되돌릴 수 없습니다.")) return;
      var ok = window.DRBReflect.removeSession(now.id);
      selected = "";
      refresh();
      toast(ok ? "그 세션의 회고를 지웠습니다." : "지우지 못했습니다. 브라우저 저장 공간을 확인해주세요.");
    };
    el("btnRvReload").onclick = function () {
      refresh();
      toast("이 PC 에 저장된 최신 내용으로 다시 읽었습니다.");
    };
    el("btnRvPrint").onclick = function () { window.print(); };
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
