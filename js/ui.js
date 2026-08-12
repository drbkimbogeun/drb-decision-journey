/* ============================================================
   ui.js — 화면 그리기

   이 파일은 '보여주기'만 합니다. 숫자는 engine.js가 이미 계산해 놓은 것을
   그대로 표시할 뿐, 여기서 값을 바꾸지 않습니다.
   ============================================================ */

window.DRBUI = (function () {
  "use strict";

  var CFG = window.DRB_CONFIG;
  var S   = window.DRBState;

  /* ---------- 도구 ---------- */
  function el(id) { return document.getElementById(id); }

  function fmt(n, digits) {
    if (n === undefined || n === null || isNaN(n)) return "-";
    var d = digits === undefined ? 0 : digits;
    return Number(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function signed(n, digits) {
    var v = Number(n) || 0;
    var s = fmt(Math.abs(v), digits);
    if (v > 0) return "+" + s;
    if (v < 0) return "-" + s;
    return "0";
  }

  function deltaClass(n) {
    if (n > 0.05)  return "delta--up";
    if (n < -0.05) return "delta--down";
    return "delta--flat";
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function toast(msg) {
    var t = el("toast");
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("is-show"); }, 2200);
  }

  function openModal(title, html) {
    el("modalTitle").textContent = title;
    el("modalBody").innerHTML = html;
    el("modal").classList.add("is-open");
  }

  function closeModal() {
    el("modal").classList.remove("is-open");
  }

  /* ============================================================
     상단바
     ============================================================ */
  function renderTopbar() {
    var g = S.g();
    var r = S.round();
    var e = S.era();

    el("tbRound").textContent = "ERA " + r.no;
    el("tbYear").textContent  = e.yearLabel;
    el("tbEra").textContent   = e.name;

    renderTimeline();

    /* 조 전환 */
    var sel = el("tbTeam");
    if (sel.options.length !== g.teamNames.length) {
      clearNode(sel);
      g.teamNames.forEach(function (n) {
        var o = document.createElement("option");
        o.value = n; o.textContent = n;
        sel.appendChild(o);
      });
    }
    sel.value = g.activeTeam;

    el("btnAdmin").classList.toggle("btn--primary", !!g.adminMode);
  }

  /* ============================================================
     상단 타임라인

     연도를 실제 간격대로 찍습니다. 앞쪽은 10년씩 벌어지고
     뒤로 갈수록 촘촘해져서, 시대가 빨라지는 것이 눈에 보입니다.
     ============================================================ */
  function allSubrounds() {
    var out = [];
    window.DRB_ROUNDS.forEach(function (r) {
      r.subrounds.forEach(function (sr) {
        out.push({ year: sr.year, roundNo: r.no, id: sr.id });
      });
    });
    return out;
  }

  function renderTimeline() {
    var box = el("tbTimeline");
    if (!box) return;

    /* 이미 그린 노드는 지우고 트랙과 미래 표시는 남긴다 */
    Array.prototype.slice.call(box.querySelectorAll(".timeline__node"))
      .forEach(function (n) { n.remove(); });

    var subs = allSubrounds();
    if (!subs.length) return;

    var first = subs[0].year;
    var last  = subs[subs.length - 1].year;
    var span  = Math.max(1, last - first);
    var cur   = S.turnIndex();

    subs.forEach(function (sr, i) {
      var node = document.createElement("div");
      node.className = "timeline__node" +
        (i < cur ? " is-done" : i === cur ? " is-active" : "");
      /* 오른쪽 끝 22px 은 '?' 자리로 비워둔다 */
      node.style.left = ((sr.year - first) / span * 88) + "%";
      node.innerHTML = "<span class='timeline__dot'></span>" +
                       "<span class='timeline__year'>" + sr.year + "</span>";
      box.appendChild(node);
    });

    /* 마지막 연도에 도달하면 그 뒤는 물음표 */
    el("tbFuture").textContent = cur >= subs.length - 1 ? "━ ?" : "";
  }

  /* ============================================================
     전망 선명도 (Forecast Visibility)
     ============================================================ */
  function renderVisibility(node, era) {
    if (!node) return;
    clearNode(node);

    var v = era.visibility === undefined ? 70 : era.visibility;
    var on = Math.round(v / 10);

    var label = document.createElement("span");
    label.className = "visibility__label";
    label.textContent = "전망 선명도";

    var bar = document.createElement("span");
    bar.className = "visibility__bar";
    for (var i = 0; i < 10; i++) {
      var cell = document.createElement("span");
      var cls = "visibility__cell";
      if (i < on) cls += v >= 60 ? " is-on" : (v >= 40 ? " is-mid" : " is-low");
      cell.className = cls;
      bar.appendChild(cell);
    }

    var note = document.createElement("span");
    note.className = "visibility__note";
    note.textContent = v + "% — " + (era.visibilityNote || "");

    node.appendChild(label);
    node.appendChild(bar);
    node.appendChild(note);
  }

  /* ============================================================
     경쟁사 목록 (시대 시작 화면 / 결과 화면)
     ============================================================ */
  function renderRivalList(node, opts) {
    if (!node) return;
    opts = opts || {};
    clearNode(node);

    var defs = window.DRB_RIVALS || [];
    var live = S.rivals();

    defs.forEach(function (def) {
      var rv = live.filter(function (r) { return r.id === def.id; })[0];
      var row = document.createElement("div");
      row.className = "rival-row";

      var lastMove = rv && rv.moves.length ? rv.moves[rv.moves.length - 1] : null;
      var moveText = opts.showMove && lastMove
        ? lastMove.year + " · " + lastMove.text
        : def.desc;

      row.innerHTML =
        "<span class='rival-row__name'>" +
        "<span class='rival-row__badge' style='background:" + def.color + "'></span>" +
        escapeHtml(def.name) + "</span>" +
        "<span class='rival-row__move'>" + escapeHtml(moveText) + "</span>" +
        "<span class='rival-row__type'>" + escapeHtml(def.type) + "</span>";
      node.appendChild(row);
    });
  }

  /* 우리 vs 경쟁사 평균 */
  var STANDING_NAMES = { tech: "기술력", capacity: "생산능력", quality: "품질", trust: "고객신뢰", cash: "현금" };

  function renderStanding(node) {
    if (!node) return;
    clearNode(node);
    var rows = S.relativeStanding();
    if (!rows) return;

    rows.forEach(function (r) {
      var box = document.createElement("div");
      box.className = "standing__item";
      box.innerHTML =
        "<div class='standing__name'>" + (STANDING_NAMES[r.key] || r.key) + "</div>" +
        "<div class='standing__diff delta " + deltaClass(r.diff) + "'>" + signed(r.diff) + "</div>" +
        "<div class='standing__sub'>우리 " + r.mine + " / 평균 " + r.rivalAvg + "</div>";
      node.appendChild(box);
    });
  }

  /* ============================================================
     세계지도 — 우리 거점과 경쟁사 거점
     ============================================================ */
  function renderWorldMap(node, legendNode) {
    if (!node || !window.DRB_GLOBAL) return;
    clearNode(node);
    var G = window.DRB_GLOBAL;

    /* 아주 단순화한 대륙 실루엣 (정확한 지도가 아니라 위치 감각용) */
    node.innerHTML =
      "<svg viewBox='0 0 100 50' preserveAspectRatio='none' aria-hidden='true'>" +
      "<path class='worldmap__land' d='M8,14 L26,10 L32,20 L26,34 L16,40 L10,30 Z'/>" +
      "<path class='worldmap__land' d='M22,38 L30,36 L32,46 L26,49 L21,44 Z'/>" +
      "<path class='worldmap__land' d='M42,10 L56,8 L58,18 L50,22 L43,18 Z'/>" +
      "<path class='worldmap__land' d='M44,24 L58,22 L60,38 L50,44 L44,34 Z'/>" +
      "<path class='worldmap__land' d='M60,12 L86,10 L92,22 L84,32 L70,34 L62,24 Z'/>" +
      "<path class='worldmap__land' d='M72,44 L88,42 L90,48 L74,49 Z'/>" +
      "</svg>";

    function addNode(x, y, cls, color, label) {
      var n = document.createElement("div");
      n.className = "map-node " + cls;
      n.style.left = x + "%";
      n.style.top = y + "%";
      n.innerHTML = "<span class='map-node__dot'" +
        (color ? " style='background:" + color + "'" : "") + "></span>" +
        "<span class='map-node__label'>" + escapeHtml(label) + "</span>";
      node.appendChild(n);
    }

    /* 본국 */
    addNode(G.home.map.x, G.home.map.y, "map-node--home", null, "한국 · 우리");

    /* 우리 거점 */
    var mine = S.team().state.sites || [];
    var byCountry = {};
    mine.forEach(function (site) {
      if (!byCountry[site.country]) byCountry[site.country] = [];
      byCountry[site.country].push(site);
    });
    Object.keys(byCountry).forEach(function (cid) {
      var c = G.countries.filter(function (x) { return x.id === cid; })[0];
      if (!c) return;
      var sites = byCountry[cid];
      var running = sites.filter(function (s) { return s.stage === "running" || s.stage === "expand"; });
      var stage = running.length ? "map-node--ours" : "map-node--build";
      var label = c.name + " · " + (running.length ? sites[0].modeName : "건설 중");
      addNode(c.map.x, c.map.y - 6, stage, null, label);
    });

    /* 경쟁사 거점 */
    S.rivals().forEach(function (rv, idx) {
      var def = (window.DRB_RIVALS || []).filter(function (d) { return d.id === rv.id; })[0];
      var seen = {};
      (rv.state.sites || []).forEach(function (site) {
        if (seen[site.country]) return;
        seen[site.country] = true;
        var c = G.countries.filter(function (x) { return x.id === site.country; })[0];
        if (!c) return;
        addNode(c.map.x + (idx - 1) * 5, c.map.y + 8, "map-node--rival",
                def ? def.color : null, rv.name);
      });
    });

    if (legendNode) {
      legendNode.innerHTML =
        "<span class='map-legend__item'><span class='map-legend__dot' style='background:var(--drb-red)'></span>본사</span>" +
        "<span class='map-legend__item'><span class='map-legend__dot' style='background:var(--info)'></span>우리 거점(가동)</span>" +
        "<span class='map-legend__item'><span class='map-legend__dot' style='background:var(--warn)'></span>건설 중</span>" +
        (window.DRB_RIVALS || []).map(function (d) {
          return "<span class='map-legend__item'><span class='map-legend__dot' style='background:" +
                 d.color + "'></span>" + escapeHtml(d.name) + "</span>";
        }).join("");
    }
  }

  /* ============================================================
     사이드 — 회사 상태
     ============================================================ */
  function renderSide() {
    var t = S.team();
    var last = S.lastHistory();
    var box = el("sideMetrics");
    clearNode(box);

    CFG.metrics.forEach(function (m) {
      var value = t.state[m.key];
      var delta = last ? (last.after[m.key] - last.before[m.key]) : 0;
      var pct = Math.max(0, Math.min(100, (value / m.max) * 100));

      var wrap = document.createElement("div");
      wrap.className = "metric";
      wrap.setAttribute("data-metric", m.key);
      wrap.title = m.desc;

      var top = document.createElement("div");
      top.className = "metric__top";

      var name = document.createElement("span");
      name.className = "metric__name";
      name.textContent = m.name;

      var val = document.createElement("span");
      val.className = "metric__value num";
      val.textContent = fmt(value, m.key === "cash" ? 0 : 0) + (m.unit || "");

      var d = document.createElement("span");
      d.className = "metric__delta delta " + deltaClass(delta);
      d.textContent = last ? signed(delta, 0) : "";

      top.appendChild(name);
      top.appendChild(val);
      top.appendChild(d);

      var bar = document.createElement("div");
      bar.className = "metric__bar";
      var fill = document.createElement("div");
      fill.className = "metric__fill";
      fill.style.width = pct + "%";
      bar.appendChild(fill);

      wrap.appendChild(top);
      wrap.appendChild(bar);
      box.appendChild(wrap);
    });

    /* 현재 정책 */
    var pol = el("sidePolicy");
    if (t.policyId) {
      var p = S.policies().filter(function (x) { return x.id === t.policyId; })[0];
      pol.textContent = p ? p.name : t.policyId;
      pol.className = "chip chip--accent";
    } else {
      pol.textContent = "아직 정하지 않음";
      pol.className = "chip";
    }

    /* 지난 국면 요약 */
    var lastBox = el("sideLast");
    if (last) {
      lastBox.className = "";
      lastBox.innerHTML = "";
      var line1 = document.createElement("div");
      line1.style.fontSize = "var(--fs-small)";
      line1.innerHTML = "매출 <b class='num'>" + fmt(last.report.kpi.revenue) + "</b>억 · " +
                        "손익 <b class='num " + deltaClass(last.report.kpi.profit) + "'>" +
                        signed(last.report.kpi.profit) + "</b>억";
      var line2 = document.createElement("div");
      line2.style.cssText = "font-size:var(--fs-tiny);color:var(--text-3);margin-top:4px";
      line2.textContent = "가동률 " + last.report.kpi.utilization + "% · 납기 " + last.report.kpi.fillRate + "%";
      lastBox.appendChild(line1);
      lastBox.appendChild(line2);
    } else {
      lastBox.className = "hint";
      lastBox.textContent = "아직 없습니다";
    }
  }

  /* 상세 지표 모달 */
  function showDetail() {
    var t = S.team();
    var rows = CFG.detailMetrics.map(function (m) {
      return "<div class='breakdown__row'><span class='breakdown__label'>" + m.name +
             "<br><span style='color:var(--text-3);font-size:var(--fs-tiny)'>" + m.desc + "</span></span>" +
             "<span class='breakdown__value'>" + fmt(t.state[m.key], 1) + "</span></div>";
    }).join("");

    var pend = (t.state.pending || []).map(function (p) {
      return "<div class='breakdown__row'><span class='breakdown__label'>" + p.label +
             " <span style='color:var(--text-3)'>(" + (p.dueTurn - S.turnIndex()) + "턴 뒤)</span></span>" +
             "<span class='breakdown__value'>" + signed(p.amount, 1) + " " + p.metric + "</span></div>";
    }).join("") || "<p class='hint'>대기 중인 투자 효과가 없습니다.</p>";

    openModal("상세 지표",
      "<div class='breakdown'>" + rows + "</div>" +
      "<div class='section-label' style='margin-top:var(--sp-5)'>아직 도착하지 않은 투자 효과</div>" +
      "<div class='breakdown'>" + pend + "</div>");
  }

  /* ============================================================
     환경 지표 블록
     ============================================================ */
  function renderEnv(node, list) {
    clearNode(node);
    list.forEach(function (d) {
      var box = document.createElement("div");
      box.className = "env__item";
      var n = document.createElement("div");
      n.className = "env__name";
      n.textContent = d.name;
      var v = document.createElement("div");
      v.className = "env__value";
      v.textContent = d.value;
      if (d.tone === "good") v.style.color = "var(--good)";
      if (d.tone === "bad")  v.style.color = "var(--bad)";
      box.appendChild(n);
      box.appendChild(v);
      node.appendChild(box);
    });
  }

  /* ============================================================
     산업 브리핑 카드 — 그 시점에 알 수 있었던 것만
     ============================================================ */
  var MARKS = { up: "▲", down: "▼", q: "?", flat: "·" };

  function renderBriefing(node, brief) {
    clearNode(node);
    if (!brief) return;

    var head = document.createElement("div");
    head.className = "brief__head";
    head.textContent = brief.title;
    node.appendChild(head);

    var body = document.createElement("div");
    body.className = "brief__body";

    function column(label, lines, isRisk) {
      var col = document.createElement("div");
      col.className = "brief__col" + (isRisk ? " brief__col--risk" : "");
      var l = document.createElement("div");
      l.className = "brief__label";
      l.textContent = label;
      col.appendChild(l);

      lines.forEach(function (item) {
        var tone = isRisk ? "down" : (item.tone || "flat");
        var text = isRisk ? item : item.text;
        var row = document.createElement("div");
        row.className = "brief__line brief__line--" + tone;
        var mark = document.createElement("span");
        mark.className = "brief__mark";
        mark.textContent = isRisk ? "−" : (MARKS[tone] || "·");
        var t = document.createElement("span");
        t.textContent = text;
        row.appendChild(mark);
        row.appendChild(t);
        col.appendChild(row);
      });
      return col;
    }

    if (brief.domestic) body.appendChild(column("국내", brief.domestic, false));
    if (brief.global)   body.appendChild(column("글로벌", brief.global, false));
    if (brief.risk)     body.appendChild(column("RISK", brief.risk, true));

    node.appendChild(body);
  }

  /* ============================================================
     라운드 시작 화면
     ============================================================ */
  function renderRoundOpen() {
    var r = S.round();
    var e = S.era();
    el("roMeta").textContent = "ERA " + r.no + " · " + r.title + "  (" + e.span + ")";
    el("roYear").textContent = e.yearLabel;
    el("roName").textContent = e.name;
    el("roDesc").textContent = e.narrative;
    el("roQuestion").textContent = "“" + (e.question || r.subtitle) + "”";
    el("roGuide").textContent = r.subtitle;
    renderBriefing(el("roBrief"), e.briefing);
    renderVisibility(el("roVisibility"), e);

    /* 경쟁사는 2번째 시대부터 소개합니다 (첫 시대는 우리 회사에 집중) */
    if (r.no >= 2) {
      el("roRivalsWrap").classList.remove("hidden");
      renderRivalList(el("roRivals"), { showMove: true });
    } else {
      el("roRivalsWrap").classList.add("hidden");
    }
  }

  /* ============================================================
     상황 화면
     ============================================================ */
  function renderSituation() {
    var r = S.round();
    var sr = S.subround();
    var e = S.era();

    el("siMeta").textContent = "ERA " + r.no + " · " + sr.title;
    el("siTitle").textContent = sr.situation.title;
    el("siBody").textContent = sr.situation.body;

    /* 이미지: 파일이 없으면 자리표시자를 보여준다 */
    var fig = el("siFigure");
    clearNode(fig);
    if (sr.situation.image) {
      var img = new Image();
      img.alt = sr.situation.imageAlt || "";
      img.onerror = function () {
        clearNode(fig);
        var ph = document.createElement("div");
        ph.className = "img-placeholder";
        ph.textContent = "🖼 이미지 자리 — " + sr.situation.image +
                         "\n(" + (sr.situation.imageAlt || "설명 없음") + ")";
        fig.appendChild(ph);
      };
      img.src = sr.situation.image;
      fig.appendChild(img);
    }

    /* 돌발상황 예고 */
    var evBox = el("siEvent");
    if (sr.event && window.DRB_EVENTS[sr.event]) {
      var ev = window.DRB_EVENTS[sr.event];
      el("siEventTitle").textContent = ev.title;
      el("siEventBody").textContent = ev.body;
      evBox.classList.remove("hidden");
    } else {
      evBox.classList.add("hidden");
    }

    renderEnv(el("siEnv"), e.display);

    /* 조 안에서 나눠 맡는 관점 — 한 사람이 다 정하지 않게 */
    var rolesBox = el("siRoles");
    clearNode(rolesBox);
    (CFG.roles || []).forEach(function (role) {
      var card = document.createElement("div");
      card.className = "role-card";
      var n = document.createElement("div");
      n.className = "role-card__name";
      n.textContent = role.name;
      var q = document.createElement("div");
      q.className = "role-card__q";
      q.textContent = role.question;
      card.appendChild(n);
      card.appendChild(q);
      rolesBox.appendChild(card);
    });
  }

  /* ============================================================
     투자 배분 화면
     ============================================================ */
  function renderInvest(alloc, onChange, choices, onChoice) {
    var items = S.investments();
    var budget = S.budget();
    var list = el("inList");
    choices = choices || {};
    clearNode(list);

    var planned = S.subround().budget;
    var sub = S.era().yearLabel + " · " + S.subround().title +
              " — 이번에 쓸 수 있는 예산은 " + budget +
              " 입니다. (토큰 " + (budget / CFG.tokenUnit) + "개)";
    if (S.budgetIsTight()) {
      sub += "  ⚠ 현금이 부족해 예산이 " + planned + "에서 " + budget + "으로 줄었습니다.";
    }
    el("inSub").textContent = sub;
    el("inSub").style.color = S.budgetIsTight() ? "var(--bad)" : "";

    el("inGuide").innerHTML = S.budgetIsTight()
      ? "현금이 바닥났습니다. 지금은 <b>버티는 것</b>도 전략입니다."
      : "남긴 예산은 자동으로 <b>현금</b>으로 넘어갑니다. 아끼는 것도 하나의 전략입니다.";

    items.forEach(function (item) {
      var amt = alloc[item.id] || 0;

      var card = document.createElement("div");
      card.className = "alloc" + (amt > 0 ? " is-invested" : "");

      var name = document.createElement("div");
      name.className = "alloc__name";
      name.textContent = item.name;

      var stepper = document.createElement("div");
      stepper.className = "alloc__stepper";

      var minus = document.createElement("button");
      minus.className = "btn btn--icon";
      minus.textContent = "−";
      minus.setAttribute("aria-label", item.name + " 줄이기");
      minus.onclick = function () { onChange(item.id, -CFG.tokenUnit); };

      var val = document.createElement("span");
      val.className = "alloc__amount num";
      val.textContent = amt;

      var plus = document.createElement("button");
      plus.className = "btn btn--icon";
      plus.textContent = "+";
      plus.setAttribute("aria-label", item.name + " 늘리기");
      plus.onclick = function () { onChange(item.id, CFG.tokenUnit); };

      stepper.appendChild(minus);
      stepper.appendChild(val);
      stepper.appendChild(plus);

      var desc = document.createElement("div");
      desc.className = "alloc__desc";
      desc.textContent = item.desc;

      var tos = document.createElement("div");
      tos.className = "alloc__tradeoff";
      (item.tradeoffs || []).forEach(function (t) {
        var s = document.createElement("span");
        s.className = "tradeoff tradeoff--" + t.type;
        s.textContent = t.text;
        tos.appendChild(s);
      });

      card.appendChild(name);
      card.appendChild(stepper);
      card.appendChild(desc);
      card.appendChild(tos);

      /* 해외 진출처럼 '어디에 / 어떤 방식으로' 를 함께 정해야 하는 항목 */
      if (item.dimensions && amt > 0 && window.DRB_GLOBAL) {
        card.appendChild(buildDimensions(item, choices[item.id] || {}, onChoice));
      }

      list.appendChild(card);
    });

    updateBudgetBar(alloc);
  }

  /* 다차원 선택 UI — 무엇을(항목) 다음에 어디에·어떻게 를 묻습니다 */
  function buildDimensions(item, picked, onChoice) {
    var G = window.DRB_GLOBAL;
    var wrap = document.createElement("div");
    wrap.className = "dimension";

    function group(dimKey, label, options, current, render) {
      var l = document.createElement("div");
      l.className = "dimension__label";
      l.textContent = label;
      wrap.appendChild(l);

      var opts = document.createElement("div");
      opts.className = "dimension__opts";
      options.forEach(function (o) {
        var b = document.createElement("button");
        b.className = "dim-opt" + (current === o.id ? " is-selected" : "");
        b.innerHTML = render(o);
        b.title = o.desc || "";
        b.onclick = function () { onChoice(item.id, dimKey, o.id); };
        opts.appendChild(b);
      });
      wrap.appendChild(opts);
    }

    if (item.dimensions.indexOf("where") >= 0) {
      group("where", "어디에", G.countries, picked.where, function (c) {
        return escapeHtml(c.name) +
               "<span class='dim-opt__sub'>" + escapeHtml(c.note || "") + "</span>";
      });
    }
    if (item.dimensions.indexOf("how") >= 0) {
      group("how", "어떤 방식으로", G.modes, picked.how, function (m) {
        return escapeHtml(m.name) +
               "<span class='dim-opt__sub'>" +
               (m.delay > 0 ? m.delay + "국면 뒤 가동" : "즉시 시작") + "</span>";
      });
    }

    var need = [];
    if (item.dimensions.indexOf("where") >= 0 && !picked.where) need.push("진출 지역");
    if (item.dimensions.indexOf("how") >= 0 && !picked.how) need.push("진출 방식");
    if (need.length) {
      var w = document.createElement("div");
      w.className = "dimension__warn";
      w.textContent = "⚠ " + need.join(" · ") + "을(를) 정하지 않으면 효과가 크게 줄어듭니다.";
      wrap.appendChild(w);
    }

    return wrap;
  }

  function allocSum(alloc) {
    var sum = 0;
    Object.keys(alloc).forEach(function (k) { sum += alloc[k] || 0; });
    return sum;
  }

  function updateBudgetBar(alloc) {
    var budget = S.budget();
    var used = allocSum(alloc);
    var remain = budget - used;

    var v = el("inRemain");
    v.textContent = remain;
    v.classList.toggle("is-over", remain < 0);

    el("inBar").style.width = budget > 0 ? Math.min(100, (used / budget) * 100) + "%" : "0%";
    el("inTokens").textContent = (remain / CFG.tokenUnit) + " 개";
  }

  /* ============================================================
     정책 화면
     ============================================================ */
  function renderPolicy(selectedId, onPick) {
    var list = el("poList");
    var prev = S.team().prevPolicyId;
    clearNode(list);

    S.policies().forEach(function (p) {
      var btn = document.createElement("button");
      btn.className = "policy" + (selectedId === p.id ? " is-selected" : "");
      btn.onclick = function () { onPick(p.id); };

      var name = document.createElement("div");
      name.className = "policy__name";
      name.textContent = p.name;
      if (prev === p.id) {
        var cur = document.createElement("span");
        cur.className = "policy__current";
        cur.textContent = "(지난 국면과 동일)";
        name.appendChild(cur);
      }

      var lines = document.createElement("div");
      lines.className = "policy__lines";
      (p.pros || []).forEach(function (s) {
        var d = document.createElement("span");
        d.className = "policy__pro";
        d.textContent = s;
        lines.appendChild(d);
      });
      (p.cons || []).forEach(function (s) {
        var d = document.createElement("span");
        d.className = "policy__con";
        d.textContent = s;
        lines.appendChild(d);
      });

      btn.appendChild(name);
      btn.appendChild(lines);
      list.appendChild(btn);
    });

    var warn = el("poWarn");
    if (prev && selectedId && selectedId !== prev) {
      var pct = Math.round((1 - CFG.engine.policyChangePenalty) * 100);
      warn.textContent = "⚠ 정책을 바꾸면 조직이 흔들립니다. 이번 국면의 투자 효율이 " +
                         pct + "% 떨어지고 조직피로도가 올라갑니다.";
      warn.classList.remove("hidden");
    } else {
      warn.classList.add("hidden");
    }
  }

  /* ============================================================
     결과 화면
     ============================================================ */
  function renderResult(result) {
    var rep = result.report;
    var hist = S.lastHistory();

    el("reHeadline").textContent = rep.headline;

    /* 돌발상황과 우리 회사의 반응 */
    var evBox = el("reEvents");
    clearNode(evBox);
    rep.events.forEach(function (ev) {
      var box = document.createElement("div");
      box.className = "result-event";

      var label = document.createElement("div");
      label.className = "result-event__label";
      label.textContent = "돌발상황";

      var title = document.createElement("div");
      title.className = "result-event__title";
      title.textContent = ev.title;

      var body = document.createElement("div");
      body.className = "result-event__body";
      body.textContent = ev.body;

      box.appendChild(label);
      box.appendChild(title);
      box.appendChild(body);

      if (ev.reactions.length) {
        var re = document.createElement("div");
        re.className = "result-event__reaction";
        var head = document.createElement("div");
        head.style.cssText = "color:var(--text-3);font-size:var(--fs-tiny);margin-bottom:4px";
        head.textContent = "우리 회사에는 이렇게 작용했습니다";
        re.appendChild(head);
        ev.reactions.forEach(function (r) {
          var line = document.createElement("div");
          line.style.color = r.positive ? "var(--good)" : "var(--bad)";
          line.textContent = (r.positive ? "＋ " : "－ ") + r.text;
          re.appendChild(line);
        });
        box.appendChild(re);
      }
      evBox.appendChild(box);
    });

    /* 정책 변경 등 알림 */
    rep.notes.forEach(function (n) {
      var box = document.createElement("div");
      box.className = "result-event";
      box.style.borderLeftColor = n.tone === "good" ? "var(--good)" : "var(--warn)";
      box.style.background = n.tone === "good" ? "var(--good-soft)" : "var(--warn-soft)";
      var b = document.createElement("div");
      b.className = "result-event__body";
      b.textContent = n.text;
      box.appendChild(b);
      evBox.appendChild(box);
    });

    /* KPI */
    var kpi = el("reKpi");
    clearNode(kpi);
    [
      { name: "매출",       value: fmt(rep.kpi.revenue) + "억", sub: "" },
      { name: "영업손익",   value: signed(rep.kpi.profit) + "억",
        sub: rep.kpi.profit >= 0 ? "흑자" : "적자", tone: rep.kpi.profit >= 0 ? "up" : "down" },
      { name: "설비 가동률", value: rep.kpi.utilization + "%",
        sub: rep.kpi.utilization >= 95 ? "한계 조업" : rep.kpi.utilization < 60 ? "설비가 논다" : "정상" },
      { name: "납기 충족률", value: rep.kpi.fillRate + "%",
        sub: rep.kpi.fillRate < 90 ? "주문을 놓쳤다" : "약속을 지켰다",
        tone: rep.kpi.fillRate < 90 ? "down" : "up" }
    ].forEach(function (k) {
      var box = document.createElement("div");
      box.className = "kpi__item";
      var n = document.createElement("div");
      n.className = "kpi__name";
      n.textContent = k.name;
      var v = document.createElement("div");
      v.className = "kpi__value";
      v.textContent = k.value;
      if (k.tone === "up")   v.style.color = "var(--good)";
      if (k.tone === "down") v.style.color = "var(--bad)";
      var s = document.createElement("div");
      s.className = "kpi__sub";
      s.style.color = "var(--text-3)";
      s.textContent = k.sub;
      box.appendChild(n); box.appendChild(v); box.appendChild(s);
      kpi.appendChild(box);
    });

    /* 실물 토큰 이동 안내 */
    var tk = el("reTokens");
    clearNode(tk);
    CFG.metrics.forEach(function (m) {
      var diff = hist.after[m.key] - hist.before[m.key];
      if (Math.abs(diff) < 0.5) return;
      var box = document.createElement("div");
      box.className = "token-change";
      var n = document.createElement("span");
      n.className = "token-change__name";
      n.textContent = m.name;
      var v = document.createElement("span");
      v.className = "token-change__value delta " + deltaClass(diff);
      v.textContent = signed(diff, 0);
      box.appendChild(n); box.appendChild(v);
      tk.appendChild(box);
    });
    if (!tk.children.length) {
      var none = document.createElement("p");
      none.className = "hint";
      none.textContent = "이번 국면에는 눈에 띄는 자원 변화가 없었습니다.";
      tk.appendChild(none);
    }

    /* 매출 귀인 */
    renderBreakdown(el("reRevWhy"), rep.revenueBreakdown, "억", fmt(rep.kpi.revenue) + "억");
    renderBreakdown(el("reProfitWhy"), rep.profitBreakdown, "억", signed(rep.kpi.profit) + "억");

    /* 관리자 모드 — 모든 변화의 근거 */
    var adminBox = el("reAdmin");
    if (S.g().adminMode) {
      adminBox.classList.remove("hidden");
      var body = el("reAdminBody");
      clearNode(body);
      Object.keys(rep.changes).forEach(function (metric) {
        var head = document.createElement("div");
        head.className = "section-label";
        head.style.marginTop = "var(--sp-3)";
        head.textContent = metric;
        body.appendChild(head);
        rep.changes[metric].forEach(function (c) {
          var row = document.createElement("div");
          row.className = "breakdown__row";
          var l = document.createElement("span");
          l.className = "breakdown__label";
          l.textContent = c.label;
          var v = document.createElement("span");
          v.className = "breakdown__value delta " + deltaClass(c.amount);
          v.textContent = signed(c.amount, 1);
          row.appendChild(l); row.appendChild(v);
          body.appendChild(row);
        });
      });
      var effRow = document.createElement("div");
      effRow.className = "breakdown__row breakdown__total";
      effRow.innerHTML = "<span class='breakdown__label'>이번 턴 투자 효율</span>" +
                         "<span class='breakdown__value'>×" + rep.investEff + "</span>";
      body.appendChild(effRow);
    } else {
      adminBox.classList.add("hidden");
    }

    /* 경쟁 상황 */
    el("reCrowd").textContent = "경쟁강도 " + (rep.competitionLevel || 0) + "%" +
      (rep.crowding > 0 ? " · 같은 분야에 몰림 " + rep.crowding + "%" : "");
    renderStanding(el("reStanding"));

    var mv = el("reRivalMoves");
    clearNode(mv);
    var moves = (hist && hist.rivalMoves) || [];
    if (moves.length) {
      var head = document.createElement("div");
      head.className = "section-label";
      head.textContent = "그 사이 경쟁사들은";
      mv.appendChild(head);
      moves.forEach(function (m) {
        var def = (window.DRB_RIVALS || []).filter(function (d) { return d.id === m.id; })[0];
        var row = document.createElement("div");
        row.className = "rival-row";
        row.innerHTML =
          "<span class='rival-row__name'><span class='rival-row__badge' style='background:" +
          (def ? def.color : "var(--text-3)") + "'></span>" + escapeHtml(m.name) + "</span>" +
          "<span class='rival-row__move'>" + escapeHtml(m.text) + "</span>" +
          "<span class='rival-row__type'>" + (m.year || "") + "</span>";
        mv.appendChild(row);
      });
    }

    /* 해외 거점이 하나라도 있으면 지도를 보여준다 */
    var sites = S.team().state.sites || [];
    var anyRivalSite = S.rivals().some(function (r) { return (r.state.sites || []).length > 0; });
    if (sites.length || anyRivalSite) {
      el("reMapWrap").classList.remove("hidden");
      renderWorldMap(el("reMap"), el("reMapLegend"));
    } else {
      el("reMapWrap").classList.add("hidden");
    }

    el("reHint").textContent = S.isLastSubround()
      ? "이 시대가 끝났습니다. 다음은 실제 DRB의 선택입니다."
      : "결과를 팀에서 한 문장으로 정리한 뒤 다음으로 넘어가세요.";
  }

  /* ============================================================
     시간 진행 (타임랩스)

     결정을 확정하면 바로 숫자 화면으로 가지 않고,
     그 기간 동안 우리와 경쟁사와 시장이 움직이는 것을 보여줍니다.
     ============================================================ */
  function buildLapseLines(hist) {
    var lines = [];
    var era = S.era();
    var startYear = (hist.year || 0) - (era.pace ? era.pace.yearsPerSubround : 8);

    /* 우리가 한 일 */
    var items = S.investments();
    Object.keys(hist.allocation || {})
      .filter(function (k) { return hist.allocation[k] > 0; })
      .sort(function (a, b) { return hist.allocation[b] - hist.allocation[a]; })
      .slice(0, 3)
      .forEach(function (k, i) {
        var item = items.filter(function (x) { return x.id === k; })[0];
        if (!item) return;
        var ch = (hist.choices || {})[k];
        var text = item.name + " " + hist.allocation[k];
        if (ch && ch.where && window.DRB_GLOBAL) {
          var c = window.DRB_GLOBAL.countries.filter(function (x) { return x.id === ch.where; })[0];
          var m = window.DRB_GLOBAL.modes.filter(function (x) { return x.id === ch.how; })[0];
          if (c) text += " — " + c.name + (m ? " " + m.name : "");
        }
        lines.push({ who: "우리", kind: "ours", text: text, order: i });
      });

    /* 경쟁사가 한 일 */
    (hist.rivalMoves || []).forEach(function (m, i) {
      lines.push({ who: m.name, kind: "rival", text: m.text, order: i + 1 });
    });

    /* 시장에서 벌어진 일 — 이건 속보 알림으로도 뜹니다 */
    (hist.report.events || []).forEach(function (ev, i) {
      var full = window.DRB_EVENTS[ev.id] || ev;
      var isOurs = !!full.conditional;   // 조건부 사건 = 우리 회사에만 벌어진 일
      lines.push({
        who: isOurs ? "우리 회사" : "시장",
        kind: isOurs ? "ours" : "market",
        text: ev.title,
        event: full,
        isOurs: isOurs,
        order: 6 + i
      });
    });

    /* 연도를 고르게 뿌린다 */
    lines.sort(function (a, b) { return a.order - b.order; });
    var step = Math.max(1, Math.round(((hist.year || 0) - startYear) / Math.max(1, lines.length)));
    lines.forEach(function (l, i) {
      l.year = Math.min(hist.year, startYear + step * (i + 1));
    });
    return lines;
  }

  /* ============================================================
     뉴스 속보 알림 — 시간이 흐르는 도중에 사건이 터집니다
     ============================================================ */
  function showNewsFlash(ev, year, isOurs) {
    var box = el("newsflash");
    if (!box) return;

    var item = document.createElement("div");
    item.className = "newsflash__item" + (isOurs ? " newsflash__item--ours" : "");
    item.innerHTML =
      "<div class='newsflash__tag'>" + (isOurs ? "우리 회사" : "속보") + "</div>" +
      "<div class='newsflash__title'>" + escapeHtml(ev.headline || ev.title) + "</div>" +
      "<div class='newsflash__year num'>" + year + "</div>";
    box.appendChild(item);

    setTimeout(function () {
      item.classList.add("newsflash__item--fade");
      setTimeout(function () { if (item.parentNode) item.remove(); }, 500);
    }, 5200);
  }

  function clearNewsFlash() {
    var box = el("newsflash");
    if (box) clearNode(box);
  }

  function renderTimelapse(hist, onDone) {
    var feed = el("tlFeed");
    var yearBox = el("tlYear");
    clearNode(feed);
    clearNewsFlash();

    var era = S.era();
    var startYear = (hist.year || 0) - (era.pace ? era.pace.yearsPerSubround : 8);
    var lines = buildLapseLines(hist);

    el("tlCaption").textContent = startYear + " → " + hist.year + " · " +
      (era.pace ? era.pace.yearsPerSubround : 8) + "년이 흐릅니다";
    yearBox.textContent = startYear;

    var i = 0;
    var timer = null;

    function step() {
      if (i >= lines.length) {
        clearInterval(timer);
        yearBox.textContent = hist.year;
        setTimeout(onDone, 700);
        return;
      }
      var l = lines[i++];
      yearBox.textContent = l.year;

      var row = document.createElement("div");
      row.className = "timelapse__line timelapse__line--" + l.kind;
      row.innerHTML = "<span class='timelapse__who'>" + escapeHtml(l.who) + "</span>" +
                      "<span>" + escapeHtml(l.text) + "</span>";
      feed.appendChild(row);

      /* 사건이 터지는 순간 화면 오른쪽에 속보가 뜹니다 */
      if (l.event) showNewsFlash(l.event, l.year, l.isOurs);
    }

    /* 뒤로 갈수록 화면도 빨라집니다 */
    var speed = era.pace && era.pace.yearsPerSubround >= 10 ? 900
              : era.pace && era.pace.yearsPerSubround >= 7 ? 700 : 520;
    step();
    timer = setInterval(step, speed);

    return function stop() {
      clearInterval(timer);
      while (i < lines.length) { step(); }
    };
  }

  /* ============================================================
     2026 엔딩
     ============================================================ */
  function renderEndingMarket() {
    var box = el("endMarket");
    clearNode(box);

    var lines = [];
    S.rivals().forEach(function (rv) {
      var def = (window.DRB_RIVALS || []).filter(function (d) { return d.id === rv.id; })[0];
      var moves = (window.DRB_RIVAL_MOVES || {});
      var pool = moves[(rv.history[rv.history.length - 1] || {}).role] || moves.future || ["다음 수를 준비"];
      lines.push({
        who: rv.name,
        text: pool[(rv.state.tech + rv.state.capacity) % pool.length] + " 검토"
      });
    });
    lines.push({ who: "시장", text: "새로운 기술이 또 나왔습니다" });
    lines.push({ who: "고객", text: "요구가 다시 바뀌었습니다" });

    lines.forEach(function (l, i) {
      var row = document.createElement("div");
      row.className = "ending__market-line";
      row.style.animationDelay = (i * 0.25) + "s";
      row.innerHTML = "<b style='min-width:70px'>" + escapeHtml(l.who) + "</b>" +
                      "<span>" + escapeHtml(l.text) + "</span>";
      box.appendChild(row);
    });
  }

  function showEndingStep(n) {
    ["end1", "end2", "end3", "end4"].forEach(function (id, i) {
      var node = el(id);
      if (node) node.classList.toggle("is-active", i === n);
    });
    if (n === 2) renderEndingMarket();
  }

  function renderBreakdown(node, rows, unit, totalText) {
    clearNode(node);
    if (!rows.length) {
      var p = document.createElement("p");
      p.className = "hint";
      p.textContent = "특별한 요인이 없었습니다.";
      node.appendChild(p);
      return;
    }
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "breakdown__row";
      var l = document.createElement("span");
      l.className = "breakdown__label";
      l.textContent = r.label;
      var v = document.createElement("span");
      v.className = "breakdown__value delta " + deltaClass(r.value);
      v.textContent = signed(r.value) + unit;
      row.appendChild(l); row.appendChild(v);
      node.appendChild(row);
    });
    var total = document.createElement("div");
    total.className = "breakdown__row breakdown__total";
    total.innerHTML = "<span class='breakdown__label'>결과</span>" +
                      "<span class='breakdown__value'>" + totalText + "</span>";
    node.appendChild(total);
  }

  /* ============================================================
     ACTUAL DRB 화면
     ============================================================ */
  function renderActual() {
    var a = S.actual();
    var t = S.team();
    var r = S.round();

    el("acNotice").textContent = CFG.notices.factVsSim;

    /* 우리 조가 이번 라운드에 한 일 */
    var ours = el("acOurs");
    clearNode(ours);
    var mine = t.history.filter(function (h) { return h.roundId === r.id; });
    var totals = {};
    mine.forEach(function (h) {
      Object.keys(h.allocation).forEach(function (k) {
        totals[k] = (totals[k] || 0) + h.allocation[k];
      });
    });
    var items = S.investments();
    var sorted = Object.keys(totals)
      .filter(function (k) { return totals[k] > 0; })
      .sort(function (a1, b1) { return totals[b1] - totals[a1]; });

    if (!sorted.length) {
      ours.innerHTML = "<p class='hint'>이번 라운드에는 아무 곳에도 투자하지 않았습니다.</p>";
    } else {
      var html = "<div class='breakdown'>";
      sorted.forEach(function (k) {
        var item = items.filter(function (i) { return i.id === k; })[0];
        html += "<div class='breakdown__row'><span class='breakdown__label'>" +
                (item ? item.name : k) + "</span><span class='breakdown__value'>" +
                totals[k] + "</span></div>";
      });
      html += "</div>";
      html += "<p style='margin-top:var(--sp-3);font-size:var(--fs-small);color:var(--text-2)'>정책 · " +
              mine.map(function (h) { return h.policyName; }).join(" → ") + "</p>";
      ours.innerHTML = html;
    }

    /* 실제 DRB */
    var drb = el("acDrb");
    clearNode(drb);
    if (a.filled) {
      drb.innerHTML =
        "<div style='font-weight:700;margin-bottom:var(--sp-2)'>" + escapeHtml(a.year) + "</div>" +
        "<div style='white-space:pre-line'>" + escapeHtml(a.choice) + "</div>";
    } else {
      drb.innerHTML =
        "<div class='placeholder-note'>" +
        "<b>[DRB 실제 사례 입력 예정]</b><br>" +
        "이 자리에는 People팀이 확인한 <b>실제 DRB의 선택</b>만 들어갑니다.<br>" +
        "AI나 개발자가 추측해서 채우지 않습니다.<br><br>" +
        "입력 위치 : <code>data/actual_drb.js</code> → <code>" + a.id + "</code>" +
        "</div>";
    }

    /* 상세 (상황 / 결과 / 사진 / 진행자 설명) */
    var detail = el("acDetail");
    clearNode(detail);

    if (a.filled) {
      detail.appendChild(factBox("당시 상황", a.situation));

      /* 실제 연표 — 사사(社史)에서 그대로 옮긴 것 */
      if (a.timeline && a.timeline.length) {
        var tl = document.createElement("div");
        tl.className = "factbox";
        var tlLabel = document.createElement("div");
        tlLabel.className = "factbox__label";
        tlLabel.textContent = "◆ 실제 연표";
        tl.appendChild(tlLabel);

        var list = document.createElement("div");
        list.className = "drbtimeline";
        a.timeline.forEach(function (t) {
          var row = document.createElement("div");
          row.className = "drbtimeline__row" + (t.key ? " is-key" : "");
          row.innerHTML = "<span class='drbtimeline__year num'>" + escapeHtml(t.year) + "</span>" +
                          "<span class='drbtimeline__text'>" + escapeHtml(t.text) + "</span>";
          list.appendChild(row);
        });
        tl.appendChild(list);
        detail.appendChild(tl);
      }

      detail.appendChild(factBox("실제 결과", a.result));
      if (a.note) detail.appendChild(factBox("진행자 설명", a.note));
      if (a.image) {
        var figWrap = document.createElement("div");
        figWrap.className = "situation__figure";
        var img = new Image();
        img.alt = a.imageAlt || "";
        img.onerror = function () {
          clearNode(figWrap);
          var ph = document.createElement("div");
          ph.className = "img-placeholder";
          ph.textContent = "🖼 사진 자리 — " + a.image;
          figWrap.appendChild(ph);
        };
        img.src = a.image;
        figWrap.appendChild(img);
        detail.appendChild(figWrap);
      }
    } else {
      var box = document.createElement("div");
      box.className = "factbox";
      box.innerHTML =
        "<div class='factbox__label'>◆ ACTUAL DRB — 아직 입력되지 않았습니다</div>" +
        "<div class='factbox__body'>" +
        "실제 DRB의 상황 · 선택 · 결과 · 사진은 People팀이 사내 자료로 확인한 뒤 입력합니다.<br><br>" +
        "지금은 진행자가 <b>구두로</b> 실제 사례를 소개하고, " +
        "각 조가 '우리 선택과 무엇이 달랐는지' 이야기하는 시간으로 진행하세요." +
        "</div>";
      detail.appendChild(box);
    }

    renderRivals(r.id, sorted, items);

    el("btnActualGo").textContent = S.isLastRound() ? "다른 선택 비교하기" : "다음 라운드로";
  }

  /* ============================================================
     같은 산업, 다른 선택 (경쟁기업 비교)
     — 검증된 자료만. 비어 있으면 그렇다고 밝힌다.
     ============================================================ */
  function renderRivals(roundId, ourTop, items) {
    var data = (window.DRB_COMPETITORS && window.DRB_COMPETITORS.byRound[roundId]) || null;
    var box = el("acRivals");
    var head = el("acRivalHead");
    var lesson = el("acRivalLesson");
    clearNode(box);

    if (!data) {
      head.textContent = "이 라운드의 경쟁사 비교 자료가 아직 없습니다.";
      lesson.textContent = "";
      return;
    }

    head.textContent = data.filled
      ? data.headline
      : "[검증 후 입력 예정] 같은 시대에 다른 회사들은 어떤 선택을 했는지, People팀이 확인한 자료만 여기에 들어갑니다.";

    /* 우리 조 */
    var ours = document.createElement("div");
    ours.className = "rival rival--ours";
    ours.innerHTML =
      "<div class='rival__name'>우리 조</div>" +
      "<div class='rival__country'>" + escapeHtml(S.g().activeTeam) + "</div>" +
      "<div class='rival__choice'>" +
      (ourTop && ourTop.length
        ? escapeHtml(ourTop.slice(0, 2).map(function (k) {
            var it = items.filter(function (i) { return i.id === k; })[0];
            return it ? it.name : k;
          }).join(" + ")) + " 중심"
        : "투자 없음") +
      "</div>";
    box.appendChild(ours);

    (window.DRB_COMPETITORS.companies || []).forEach(function (c) {
      var choice = (data.choices || []).filter(function (x) { return x.id === c.id; })[0];
      var text = choice && choice.text ? choice.text : "";
      var card = document.createElement("div");
      card.className = "rival";
      card.innerHTML =
        "<div class='rival__name'>" + escapeHtml(c.name) + "</div>" +
        "<div class='rival__country'>" + escapeHtml(c.country) + " · " + escapeHtml(c.note) + "</div>" +
        (text
          ? "<div class='rival__choice'>" + escapeHtml(text) + "</div>"
          : "<div class='rival__choice rival__choice--empty'>[입력 예정]</div>");
      box.appendChild(card);
    });

    lesson.textContent = data.filled && data.lesson
      ? data.lesson
      : "누가 정답이었는지를 고르는 화면이 아닙니다. 각 선택이 무엇을 얻고 무엇을 포기했는지 보세요.";
  }

  /* ============================================================
     What If — 다른 선택을 했다면
     (AI가 상상하는 것이 아니라 엔진으로 실제 재계산합니다)
     ============================================================ */
  function renderWhatIf() {
    var axes = window.DRB_WHATIF_AXES || [];
    var t = S.team();

    var headRow = el("wiHead");
    clearNode(headRow);
    var th0 = document.createElement("th");
    th0.textContent = "전략";
    headRow.appendChild(th0);
    axes.forEach(function (ax) {
      var th = document.createElement("th");
      th.textContent = ax.name;
      headRow.appendChild(th);
    });

    var body = el("wiBody");
    clearNode(body);

    function addRow(name, desc, state, isOurs) {
      var tr = document.createElement("tr");
      if (isOurs) tr.className = "is-ours";

      var td0 = document.createElement("td");
      td0.innerHTML = "<div>" + escapeHtml(name) + "</div>" +
                      "<div style='font-size:var(--fs-tiny);color:var(--text-3);font-weight:400'>" +
                      escapeHtml(desc) + "</div>";
      tr.appendChild(td0);

      window.DRBEngine.scoreAxes(state).forEach(function (sc) {
        var td = document.createElement("td");
        var cls = sc.level === "높음" ? "high" : (sc.level === "보통" ? "mid" : "low");
        td.innerHTML = "<span class='level level--" + cls + "'>" + sc.level + "</span>";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }

    /* 우리가 실제로 걸어온 길 */
    addRow("우리 조가 걸어온 길", S.g().activeTeam + " · 실제 플레이 결과", t.state, true);

    /* 대안 전략들 — 같은 엔진으로 6국면 재계산 */
    (window.DRB_WHATIF || []).forEach(function (sc) {
      try {
        var finalState = window.DRBEngine.runScenario(sc);
        addRow(sc.name, sc.desc, finalState, false);
      } catch (e) {
        console.error("What If 계산 실패:", sc.id, e);
      }
    });

    el("wiNote").innerHTML =
      "이 표에는 <b>총점도 순위도 없습니다.</b> 어느 줄이 정답인지 정해져 있지 않습니다.<br>" +
      "성장을 택하면 안정성을 내주고, 현금을 지키면 선택권을 잃습니다.<br><br>" +
      "각 값은 <b>규칙 기반 시뮬레이션 엔진</b>이 같은 조건에서 6국면을 다시 돌려 계산한 것입니다. " +
      "AI가 지어낸 값이 아닙니다.";
  }

  function factBox(title, body) {
    var box = document.createElement("div");
    box.className = "factbox";
    var l = document.createElement("div");
    l.className = "factbox__label";
    l.textContent = "◆ " + title;
    var t = document.createElement("div");
    t.className = "factbox__body";
    t.textContent = body;
    box.appendChild(l);
    box.appendChild(t);
    return box;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ============================================================
     최종 화면
     ============================================================ */
  function renderFinal(onGapPick) {
    var t = S.team();
    var style = window.DRBEngine.judgeStyle(t.state);

    el("fiStyleName").textContent = style.name;
    el("fiStyleDesc").textContent = style.desc;

    /* ---------- 여기서 처음 공개되는 변화 대응력 ---------- */
    var adapt = window.DRBEngine.adaptiveCapacity(t.state);
    var power = Math.round(
      (t.state.capacity * 0.3 + t.state.tech * 0.25 + t.state.quality * 0.2 +
       t.state.trust * 0.15 + clamp01(t.state.cash / 200) * 100 * 0.1)
    );

    el("fiPowerStars").textContent = window.DRBEngine.stars(power);
    el("fiPowerScore").textContent = power + " / 100";
    el("fiAdaptStars").textContent = window.DRBEngine.stars(adapt.score);
    el("fiAdaptScore").textContent = adapt.score + " / 100";
    el("fiVerdict").textContent = verdictText(power, adapt.score);

    var ap = el("fiAdaptParts");
    clearNode(ap);
    adapt.parts.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "breakdown__row";
      row.innerHTML = "<span class='breakdown__label'>" + escapeHtml(p.name) + "</span>" +
                      "<span class='breakdown__value delta " + deltaClass(p.value) + "'>" +
                      signed(p.value, 1) + "</span>";
      ap.appendChild(row);
    });

    /* 경쟁사와의 위치 */
    renderStanding(el("fiStanding"));
    renderRivalList(el("fiRivals"), { showMove: true });

    /* 우리가 만든 지도 */
    var sites = t.state.sites || [];
    if (sites.length) {
      el("fiMapWrap").classList.remove("hidden");
      renderWorldMap(el("fiMap"), el("fiMapLegend"));
    } else {
      el("fiMapWrap").classList.add("hidden");
    }

    /* 80년 Replay */
    var rp = el("fiReplay");
    clearNode(rp);
    t.history.forEach(function (h) {
      var top = topInvest(h.allocation);
      var row = document.createElement("div");
      row.className = "replay__row";
      var ch = "";
      Object.keys(h.choices || {}).forEach(function (k) {
        var c = (window.DRB_GLOBAL.countries || []).filter(function (x) {
          return x.id === h.choices[k].where; })[0];
        if (c) ch = " → " + c.name;
      });
      row.innerHTML =
        "<span class='replay__year'>" + (h.year || "") + "</span>" +
        "<span class='replay__what'>" + escapeHtml((top || "투자 없음") + ch) +
        " <span style='color:var(--text-3)'>· " + escapeHtml(h.policyName) + "</span></span>";
      rp.appendChild(row);
    });

    /* 최종 지표 */
    var mbox = el("fiMetrics");
    clearNode(mbox);
    CFG.metrics.forEach(function (m) {
      var box = document.createElement("div");
      box.className = "kpi__item";
      box.innerHTML = "<div class='kpi__name'>" + m.name + "</div>" +
                      "<div class='kpi__value'>" + fmt(t.state[m.key]) + "</div>";
      mbox.appendChild(box);
    });

    /* 여정 */
    var jbox = el("fiJourney");
    clearNode(jbox);
    t.history.forEach(function (h) {
      var row = document.createElement("div");
      row.className = "journey__row";
      var w = document.createElement("span");
      w.className = "journey__when";
      w.textContent = "R" + h.roundNo + " · " + h.eraLabel;
      var d = document.createElement("span");
      var top = topInvest(h.allocation);
      d.textContent = (top ? top + "에 집중" : "투자 없음") + " · " + h.policyName;
      var v = document.createElement("span");
      v.className = "num delta " + deltaClass(h.report.kpi.profit);
      v.textContent = signed(h.report.kpi.profit) + "억";
      row.appendChild(w); row.appendChild(d); row.appendChild(v);
      jbox.appendChild(row);
    });

    /* 누적 투자 */
    var ibox = el("fiInvest");
    clearNode(ibox);
    var summary = window.DRBEngine.summarizeInvestments(t.state);
    summary.forEach(function (s) {
      var name = investName(s.id);
      var row = document.createElement("div");
      row.className = "breakdown__row";
      row.innerHTML = "<span class='breakdown__label'>" + name + "</span>" +
                      "<span class='breakdown__value'>" + s.amount + " (" + s.share + "%)</span>";
      ibox.appendChild(row);
    });

    /* 가장 고민했던 결정 */
    var gbox = el("fiGap");
    clearNode(gbox);
    window.DRB_ROUNDS.forEach(function (r) {
      var btn = document.createElement("button");
      btn.className = "gap-option" + (t.gapPick === r.id ? " is-selected" : "");
      btn.onclick = function () { onGapPick(r.id); };
      btn.innerHTML =
        "<div style='font-weight:700'>ERA " + r.no + " · " + escapeHtml(r.title) + "</div>" +
        "<div style='font-size:var(--fs-small);color:var(--text-2);margin-top:4px'>" +
        "우리는 " + escapeHtml(roundTopInvest(t, r.id) || "아무 곳에도 투자하지 않음") +
        "을 선택했습니다</div>";
      gbox.appendChild(btn);
    });

    el("fiReason").value = t.reason || "";

    renderDecisionCard(t);
  }

  /* 특정 라운드에서 가장 많이 투자한 항목 이름 */
  function roundTopInvest(t, roundId) {
    var tot = {};
    t.history.filter(function (h) { return h.roundId === roundId; }).forEach(function (h) {
      Object.keys(h.allocation).forEach(function (k) { tot[k] = (tot[k] || 0) + h.allocation[k]; });
    });
    return topInvest(tot);
  }

  function topInvestId(alloc) {
    var best = null, v = 0;
    Object.keys(alloc || {}).forEach(function (k) {
      if (alloc[k] > v) { v = alloc[k]; best = k; }
    });
    return best;
  }

  /* ============================================================
     대표이사에게 가져갈 결정 카드
     ============================================================ */
  function renderDecisionCard(t) {
    var roundId = t.gapPick || (window.DRB_ROUNDS[window.DRB_ROUNDS.length - 1].id);
    var round = window.DRB_ROUNDS.filter(function (r) { return r.id === roundId; })[0];
    if (!round) return;

    var mine = t.history.filter(function (h) { return h.roundId === round.id; });
    var era = window.DRB_ERAS[round.era];
    var actual = window.DRB_ACTUAL[round.actualId];

    el("fiCardHead").textContent = S.g().activeTeam + "의 결정 · ERA " + round.no + " (" + era.yearLabel + ")";

    var tot = {};
    mine.forEach(function (h) {
      Object.keys(h.allocation).forEach(function (k) { tot[k] = (tot[k] || 0) + h.allocation[k]; });
    });
    var allocText = Object.keys(tot)
      .filter(function (k) { return tot[k] > 0; })
      .sort(function (a, b) { return tot[b] - tot[a]; })
      .map(function (k) { return investName(k) + " " + tot[k]; })
      .join(" · ") || "투자 없음";

    var profit = mine.reduce(function (a, h) { return a + h.report.kpi.profit; }, 0);
    var resultText = mine.length
      ? "누적 손익 " + signed(profit) + "억 · " + mine[mine.length - 1].report.headline
      : "-";

    var rows = [
      { label: "당시 상황", value: round.subrounds[0].situation.title },
      { label: "우리의 선택", value: (topInvest(tot) || "투자 없음") + " 중심 · 정책 " +
               mine.map(function (h) { return h.policyName; }).join(" → ") },
      { label: "투자 배분", value: allocText },
      { label: "그렇게 한 이유", value: t.reason || "(아직 적지 않았습니다)" },
      { label: "결과", value: resultText },
      { label: "실제 DRB", value: actual && actual.filled ? actual.choice : "[DRB 실제 사례 입력 예정]", isDrb: true }
    ];

    var body = el("fiCardBody");
    clearNode(body);
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "decision-row";
      var l = document.createElement("div");
      l.className = "decision-row__label";
      l.textContent = r.label;
      var v = document.createElement("div");
      v.className = "decision-row__value" + (r.isDrb ? " decision-row__value--drb" : "");
      v.textContent = r.value;
      row.appendChild(l);
      row.appendChild(v);
      body.appendChild(row);
    });
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* 현재 경쟁력과 변화 대응력의 조합으로 마지막 한마디를 정합니다.
     순위가 아니라 '어떤 회사가 되었는가'를 말해주는 문장입니다. */
  function verdictText(power, adapt) {
    if (power >= 55 && adapt >= 55) {
      return "지금도 강하고, 앞으로도 움직일 수 있는 회사입니다. 다만 이 상태를 유지하는 데에도 계속 비용이 듭니다.";
    }
    if (power >= 55 && adapt < 40) {
      return "현재 사업은 성공적입니다. 그러나 시장이 크게 바뀌면 선택할 수 있는 대안이 많지 않습니다. " +
             "지금 잘 되는 것이 내일도 잘 될 것이라는 보장은 없습니다.";
    }
    if (power < 40 && adapt >= 55) {
      return "지금 당장 눈에 띄는 성과는 크지 않습니다. 대신 현금과 기술과 사람을 남겨두었습니다. " +
             "무엇이 오든 다시 시작할 수 있는 회사입니다.";
    }
    if (power < 40 && adapt < 40) {
      return "성과도 여력도 넉넉하지 않습니다. 다만 게임은 여기서 끝나지만 회사는 끝나지 않습니다. " +
             "지금부터 무엇을 먼저 회복할지가 다음 결정입니다.";
    }
    return "크게 앞서지도, 크게 뒤처지지도 않았습니다. 어느 쪽으로든 움직일 수 있는 자리에 서 있습니다.";
  }

  function topInvest(alloc) {
    var best = null, bestV = 0;
    Object.keys(alloc || {}).forEach(function (k) {
      if (alloc[k] > bestV) { bestV = alloc[k]; best = k; }
    });
    return best ? investName(best) : null;
  }

  function investName(id) {
    var found = null;
    Object.keys(window.DRB_INVESTMENTS).forEach(function (setKey) {
      window.DRB_INVESTMENTS[setKey].forEach(function (i) {
        if (i.id === id && !found) found = i.name;
      });
    });
    return found || id;
  }

  return {
    el: el, fmt: fmt, signed: signed, deltaClass: deltaClass,
    toast: toast, openModal: openModal, closeModal: closeModal,
    renderTopbar: renderTopbar, renderSide: renderSide, showDetail: showDetail,
    renderRoundOpen: renderRoundOpen, renderSituation: renderSituation,
    renderInvest: renderInvest, updateBudgetBar: updateBudgetBar, allocSum: allocSum,
    renderPolicy: renderPolicy, renderResult: renderResult,
    renderActual: renderActual, renderWhatIf: renderWhatIf, renderFinal: renderFinal,
    renderDecisionCard: renderDecisionCard,
    renderTimeline: renderTimeline, renderTimelapse: renderTimelapse,
    showEndingStep: showEndingStep, renderWorldMap: renderWorldMap,
    showNewsFlash: showNewsFlash, clearNewsFlash: clearNewsFlash,
    investName: investName, escapeHtml: escapeHtml
  };
})();
