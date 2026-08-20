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
    openPickerId = null;
  }

  /* 첫 번째 · 두 번째 … 여섯 번째 */
  var ORDINALS = ["첫", "두", "세", "네", "다섯", "여섯"];

  function ordinal(i) {
    return (ORDINALS[i] || (i + 1)) + " 번째";
  }

  /* ============================================================
     상단바

     노트북에 남은 화면이 몇 개 없습니다.
       배분   → "ERA 1 · 자원 배분 · 1945" · 남은 예산 · 타이머
       대기   → 진행자가 다음 국면을 열 때까지
       최종   → GAME OVER 도장
     ============================================================ */
  function renderTopbar() {
    var g = S.g();
    var r = S.round();
    var sr = S.subround();
    var phase = S.phase();
    var subs = allSubrounds();

    /* ---------- 화면마다 다른 머리말 ----------
       [도장] [제목] [부제] [점]  …  [메타] [예산] [타이머] */
    var stamp = "", title = "", sub = "", meta = "";

    if (phase === "invest") {
      stamp = "ERA " + r.no;
      title = "자원 배분";
      sub   = String(sr.year);
      meta  = g.activeTeam;
    } else if (phase === "timelapse") {
      title = String(sr.year);
      sub   = "진행자 화면을 보세요";
      meta  = g.activeTeam;
    } else if (phase === "final") {
      stamp = "결과";
      title = g.activeTeam;
      sub   = subs[0].year + " → " + subs[subs.length - 1].year;
    }

    el("tbStamp").textContent = stamp;
    el("tbTitle").textContent = title;
    el("tbSub").textContent = sub;
    el("tbMeta").textContent = meta;

    /* 예산은 자원 배분 화면에서만 머리말에 올라옵니다 */
    el("tbBudget").classList.toggle("hidden", phase !== "invest");

    renderTimeline();

    /* ---------- 조 전환 ---------- */
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
     진행 표시 — 6번의 결정 중 지금 몇 번째인가
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
    var box = el("tbDots");
    if (!box) return;
    clearNode(box);

    var subs = allSubrounds();
    var cur = S.turnIndex();

    subs.forEach(function (sr, i) {
      if (i > 0) {
        var link = document.createElement("span");
        link.className = "dots__link";
        box.appendChild(link);
      }
      var dot = document.createElement("span");
      dot.className = "dots__dot" + (i < cur ? " is-done" : i === cur ? " is-active" : "");
      dot.title = sr.year + "년";
      box.appendChild(dot);
    });

  }

  /* ============================================================
     세계지도 — 우리가 만든 거점
     ============================================================ */
  function renderWorldMap(node, legendNode) {
    if (!node || !window.DRB_GLOBAL) return;
    clearNode(node);
    var G = window.DRB_GLOBAL;

    /* 지도는 이미지 한 장입니다 (CSS 배경, assets/img/worldmap.webp).
       핀은 data/global.js 의 map.x / map.y 백분율로 얹습니다. */

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

    if (legendNode) {
      legendNode.innerHTML =
        "<span class='map-legend__item'><span class='map-legend__dot' style='background:var(--drb-red)'></span>본사</span>" +
        "<span class='map-legend__item'><span class='map-legend__dot' style='background:var(--info)'></span>우리 거점(가동)</span>" +
        "<span class='map-legend__item'><span class='map-legend__dot' style='background:var(--warn)'></span>건설 중</span>";
    }
  }

  /* ============================================================
     회사 상태 — 자원 배분 화면 왼쪽 레일에 작게 붙습니다.

     새 디자인에는 '항상 보이는 사이드 패널'이 없습니다. 다만 배분할 때는
     지금 현금과 생산능력을 모르면 판단할 수 없으므로 여기에만 남겨둡니다.
     ============================================================ */
  /* 새 디자인에는 항상 보이는 회사 상태 패널이 없습니다.
     숫자가 필요하면 상단 [상태] 버튼으로 모달을 엽니다. */
  function renderSide() { /* no-op */ }

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
     투자 배분 화면
     ============================================================ */
  function renderDecisionScope(context) {
    var box = el("inDecisionScope");
    if (!box) return;
    clearNode(box);
    if (!context) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");

    var summary = document.createElement("div");
    summary.className = "decision-scope__summary";
    var label = document.createElement("span");
    label.className = "decision-scope__label";
    label.textContent = context.label;
    var count = document.createElement("strong");
    count.className = "decision-scope__count";
    count.textContent = context.visibleCount + "개 선택지 · " + context.groups.length + "개 전략군";
    if (context.visibleCount < context.totalCount) {
      var pending = document.createElement("span");
      pending.className = "decision-scope__pending";
      pending.textContent = "전체 " + context.totalCount + "개 중 단계 공개";
      summary.appendChild(label);
      summary.appendChild(count);
      summary.appendChild(pending);
    } else {
      summary.appendChild(label);
      summary.appendChild(count);
    }

    var meter = document.createElement("div");
    meter.className = "complexity-meter";
    meter.setAttribute("aria-label", "의사결정 복잡도 " + context.level + " / " + context.totalLevels);
    var meterLabel = document.createElement("span");
    meterLabel.className = "complexity-meter__label";
    meterLabel.textContent = "판단 복잡도";
    meter.appendChild(meterLabel);
    for (var i = 1; i <= context.totalLevels; i++) {
      var cell = document.createElement("span");
      cell.className = "complexity-meter__cell" + (i <= context.level ? " is-on" : "");
      meter.appendChild(cell);
    }
    var meterValue = document.createElement("span");
    meterValue.className = "complexity-meter__value num";
    meterValue.textContent = context.level + "/" + context.totalLevels;
    meter.appendChild(meterValue);

    var dimensions = document.createElement("div");
    dimensions.className = "decision-scope__dimensions";
    var dimensionLabel = document.createElement("span");
    dimensionLabel.className = "decision-scope__label";
    dimensionLabel.textContent = "이번에 새로 열린 판단";
    dimensions.appendChild(dimensionLabel);
    var dimensionChips = document.createElement("div");
    dimensionChips.className = "decision-scope__chips";
    context.newDimensions.forEach(function (name) {
      var chip = document.createElement("span");
      chip.className = "decision-scope__chip";
      chip.textContent = name;
      dimensionChips.appendChild(chip);
    });
    dimensions.appendChild(dimensionChips);

    var groupLegend = document.createElement("div");
    groupLegend.className = "decision-scope__groups";
    context.groups.forEach(function (group) {
      var chip = document.createElement("span");
      chip.className = "strategy-chip";
      chip.setAttribute("data-strategy", group.id);
      chip.textContent = group.name;
      groupLegend.appendChild(chip);
    });

    box.appendChild(summary);
    box.appendChild(meter);
    box.appendChild(dimensions);
    box.appendChild(groupLegend);
  }

  function renderInvest(alloc, onChange, choices, onChoice) {
    var items = S.availableInvestments ? S.availableInvestments() : S.investments();
    var decisionContext = S.investmentDecisionContext ? S.investmentDecisionContext() : null;
    var budget = S.budget();
    var list = el("inList");
    choices = choices || {};
    clearNode(list);
    list.className = "alloc-list";
    list.style.gridTemplateColumns = "";
    delete list.dataset.rows;
    renderDecisionScope(decisionContext);

    /* 예산이 왜 이 숫자인지 화면에서 바로 읽히게 합니다.
       고정 예산은 국면마다 정해져 있고, 지난 국면 영업이익률이 거기에 얹힙니다. */
    var bd = S.budgetBreakdown();
    var sub = "";
    var warn = false;
    if (bd.tight) {
      sub = "현금이 부족해 예산이 " + bd.planned + "에서 " + bd.final + "으로 줄었습니다";
      warn = true;
    } else if (bd.bonus > 0) {
      sub = "지난 국면 영업이익률 " + Math.round(bd.margin * 100) + "% → 고정 예산 "
          + bd.fixed + "에 " + bd.bonus + " 더해졌습니다";
    } else if (bd.bonus < 0) {
      sub = "지난 국면 영업이익률 " + Math.round(bd.margin * 100) + "% → 고정 예산 "
          + bd.fixed + "에서 " + (-bd.bonus) + " 줄었습니다";
      warn = true;
    }
    el("inSub").textContent = sub;
    el("inSub").classList.toggle("hidden", !sub);
    /* 예산이 늘어난 것은 좋은 소식입니다 — 코랄(경고)로 쓰면 안 됩니다 */
    el("inSub").classList.toggle("is-good", !!sub && !warn);

    el("inGuide").innerHTML = bd.tight
      ? "현금이 바닥났습니다. 지금은 <b>버티는 것</b>도 전략입니다."
      : "남긴 예산은 자동으로 <b>현금</b>으로 넘어갑니다. 아끼는 것도 하나의 전략입니다.";

    el("inTokenUnit").textContent = CFG.tokenUnit;

    function buildAllocationCard(item) {
      var amt = alloc[item.id] || 0;
      var isCash = !!item.keepCash;

      var card = document.createElement("div");
      card.className = "alloc" + (amt > 0 ? " is-invested" : "") + (isCash ? " is-inactive" : "");
      /* 어떤 항목인지 화면에 적어둡니다 — 점검 도구가 카드를 이름이 아니라 id 로 집습니다 */
      card.setAttribute("data-id", item.id);
      card.setAttribute("data-strategy", item.strategyGroup || "resilience");

      /* ---------- 이름 ---------- */
      var name = document.createElement("div");
      name.className = "alloc__name";
      name.textContent = item.name;
      card.appendChild(name);

      if (item.newField) {
        var badge = document.createElement("span");
        badge.className = "alloc__new";
        badge.textContent = "새 분야";
        card.appendChild(badge);
        /* 뱃지가 있는 카드만 이름 오른쪽을 비웁니다 —
           없는 카드까지 비워두면 긴 이름이 괜히 두 줄로 접힙니다 */
        card.classList.add("has-new");
      }

      /* ---------- 지금 넣은 금액 ---------- */
      var val = document.createElement("div");
      val.className = "alloc__amount num";
      val.textContent = amt;
      val.setAttribute("aria-label", item.name + " " + amt + ", 토큰 " + (amt / CFG.tokenUnit) + "개");
      card.appendChild(val);

      var level = document.createElement("div");
      level.className = "alloc__level";
      level.setAttribute("aria-hidden", "true");
      var pips = Math.max(1, Math.round(budget / CFG.tokenUnit));
      for (var i = 0; i < pips; i++) {
        var pip = document.createElement("span");
        pip.className = "alloc__pip" + (i < amt / CFG.tokenUnit ? " is-on" : "");
        level.appendChild(pip);
      }
      card.appendChild(level);

      /* ---------- 효과 — 카드에 늘 적혀 있습니다 ----------
         예전에는 접어두고 길게 눌러야 열렸습니다. 그런데 카드가 절반으로 작아지는
         2국면부터는 눌러도 아무것도 나오지 않았습니다 — 이 칸이 flex 로 0 까지
         눌려버렸기 때문입니다. 무엇을 얻고 무엇을 잃는지 모르면 어디에 넣을지
         정할 수가 없으므로, 이제 접지 않습니다.

         칸이 좁아지는 뒷 국면에서는 '얻는 것 하나 · 잃는 것 하나' 만 남깁니다
         (어느 줄을 남길지는 여기서 is-key 로 표시하고, 자르는 것은 CSS 가 합니다). */
      var tos = document.createElement("div");
      tos.className = "alloc__tradeoff";
      var gotGain = false, gotCost = false;
      (item.tradeoffs || []).forEach(function (t) {
        var s2 = document.createElement("span");
        s2.className = "tradeoff tradeoff--" + t.type;
        if (t.type === "minus") {
          if (!gotCost) { gotCost = true; s2.className += " is-key"; }
        } else if (!gotGain) {
          gotGain = true; s2.className += " is-key";
        }
        s2.textContent = t.text;
        tos.appendChild(s2);
      });
      card.appendChild(tos);

      /* ---------- 올리고 내리기 ----------
         현금 보유는 남은 예산이 저절로 오는 칸이라 직접 만지지 않습니다. */
      if (isCash) {
        var note = document.createElement("div");
        note.className = "alloc__note";
        note.textContent = "남은 예산은 자동으로 현금";
        card.appendChild(note);
      } else {
        var stepper = document.createElement("div");
        stepper.className = "alloc__stepper";

        var minus = document.createElement("button");
        minus.className = "btn btn--icon btn--minus";
        minus.textContent = "−";
        minus.setAttribute("aria-label", item.name + " 줄이기");
        minus.disabled = amt <= 0;
        minus.onclick = function (ev) { ev.stopPropagation(); onChange(item.id, -CFG.tokenUnit); };

        var plus = document.createElement("button");
        plus.className = "btn btn--icon btn--plus";
        plus.textContent = "+";
        plus.setAttribute("aria-label", item.name + " 늘리기");
        plus.disabled = allocSum(alloc) + CFG.tokenUnit > budget;
        plus.onclick = function (ev) { ev.stopPropagation(); onChange(item.id, CFG.tokenUnit); };

        stepper.appendChild(minus);
        stepper.appendChild(plus);
        card.appendChild(stepper);
      }

      /* 카드에서 잘린 줄은 여기(마우스를 올리면 뜨는 풍선)에 전부 남습니다 */
      card.title = [item.desc || ""].concat(
        (item.tradeoffs || []).map(function (t) {
          return (t.type === "minus" ? "− " : t.type === "later" ? "↻ " : "+ ") + t.text;
        })
      ).filter(Boolean).join("\n");

      /* ---------- 해외 진출처럼 '어디에 / 어떤 방식으로' 를 함께 정하는 항목 ----------
         ★ 고르는 판을 카드 안에 밀어 넣으면 카드가 터집니다. 2국면부터 카드는
           높이가 절반이고, 지역 넷 · 방식 셋은 그 안에 들어갈 수 없습니다 —
           실제로 옆 카드를 덮고 글자가 겹쳤습니다.
           그래서 카드에는 '무엇을 골랐는지' 한 줄만 두고, 고르는 것은 창에서 합니다. */
      if (item.dimensions && amt > 0 && window.DRB_GLOBAL) {
        var chosen = choices[item.id] || {};
        var summary = dimensionSummary(item, chosen);
        card.classList.add("is-choosing");
        var pick = document.createElement("button");
        pick.className = "alloc__pick" + (summary.done ? " is-done" : " is-need");
        pick.textContent = summary.text;
        pick.onclick = function (ev) {
          ev.stopPropagation();
          openDimensionPicker(item, choices, onChoice);
        };
        card.appendChild(pick);
      }

      return card;
    }

    /* ★ 한 판으로 놓습니다. 칸은 4개로 고정하고, 국면이 갈수록 줄이 늘어납니다.
         4개 → 1줄 · 6~8개 → 2줄 · 10개 → 3줄.
         전략군은 카드 위 작은 딱지로 남겨 어디에 속한 선택인지 알 수 있게 합니다. */
    var groupName = {};
    if (decisionContext && decisionContext.groups) {
      decisionContext.groups.forEach(function (g) { groupName[g.id] = g.name; });
    }
    items.forEach(function (item) {
      var card = buildAllocationCard(item);
      var gid = item.strategyGroup || "resilience";
      if (groupName[gid]) {
        var tag = document.createElement("span");
        tag.className = "alloc__group";
        tag.textContent = groupName[gid];
        card.insertBefore(tag, card.firstChild);
      }
      list.appendChild(card);
    });

    /* ★ 줄은 최대 두 줄까지입니다. 세 줄이 되면 카드가 108px 로 눌려
         '무엇을 얻고 무엇을 잃는지' 를 적을 자리가 사라집니다. 줄을 늘리는 대신
         칸을 늘립니다 — 카드는 좁아지지만 높이는 지킵니다.
         4개 → 4칸 1줄 · 6개 → 3칸 2줄 · 8개 → 4칸 2줄 · 10개 → 5칸 2줄 */
    var rows = items.length <= 4 ? 1 : 2;
    var cols = Math.max(1, Math.ceil(items.length / rows));
    list.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
    list.dataset.rows = String(rows);

    refreshDimensionPicker(items, choices, onChoice);
    updateBudgetBar(alloc);
  }

  /* 다차원 선택 UI — 무엇을(항목) 다음에 어디에·어떻게 를 묻습니다 */
  /* 카드에 한 줄로 적을 말 — 무엇을 골랐는지, 아직 안 골랐는지 */
  function dimensionSummary(item, picked) {
    var G = window.DRB_GLOBAL;
    var parts = [];
    var need = [];

    if (item.dimensions.indexOf("where") >= 0) {
      var c = picked.where && G.countries.filter(function (x) { return x.id === picked.where; })[0];
      if (c) parts.push(c.name); else need.push("지역");
    }
    if (item.dimensions.indexOf("how") >= 0) {
      var m = picked.how && G.modes.filter(function (x) { return x.id === picked.how; })[0];
      if (m) parts.push(m.name); else need.push("방식");
    }

    return need.length
      ? { done: false, text: "⚠ " + need.join(" · ") + " 정하기" }
      : { done: true, text: "📍 " + parts.join(" · ") };
  }

  /* 어느 항목의 고르는 창이 열려 있는지 — 다시 그릴 때 창 안도 같이 갱신합니다 */
  var openPickerId = null;

  function openDimensionPicker(item, choices, onChoice) {
    openPickerId = item.id;
    openModal(item.name + " — 어디에, 어떤 방식으로", "");
    el("modalBody").appendChild(buildDimensions(item, choices[item.id] || {}, onChoice));
  }

  /* 창 안에서 하나를 고르면 화면 전체가 다시 그려집니다.
     그때 창까지 같이 새로 그려야 방금 고른 것에 표시가 붙습니다. */
  function refreshDimensionPicker(items, choices, onChoice) {
    if (!openPickerId) return;
    if (!el("modal").classList.contains("is-open")) { openPickerId = null; return; }
    var item = items.filter(function (x) { return x.id === openPickerId; })[0];
    if (!item) { openPickerId = null; return; }
    clearNode(el("modalBody"));
    el("modalBody").appendChild(buildDimensions(item, choices[item.id] || {}, onChoice));
  }

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
    var unit = CFG.tokenUnit;
    var totalTokens = Math.max(0, Math.round(budget / unit));
    var leftTokens = Math.max(0, Math.round(remain / unit));

    var v = el("inRemain");
    v.textContent = remain;
    v.classList.toggle("is-over", remain < 0);

    el("inBudget").textContent = budget;
    el("inTokens").textContent = "남은 토큰 " + leftTokens + " / " + totalTokens;

    /* 아직 테이블 위에 남아 있는 토큰을 그림으로 */
    var dots = el("inTokenDots");
    clearNode(dots);
    for (var i = 0; i < totalTokens; i++) {
      var dot = document.createElement("span");
      dot.className = "token-dot" + (i < leftTokens ? " is-left" : "");
      dots.appendChild(dot);
    }
  }

  /* ============================================================
     경영정책 — 배분 화면 아래 한 줄

     각 정책이 무엇인지는 진행자가 빔에서 설명합니다. 여기서는 고르기만 합니다.
     그래도 정책은 노트북에 남습니다 — 조마다 달라야 엔진이 다르게 계산합니다.
     ============================================================ */
  function renderPolicy(selectedId, onPick) {
    var list = el("poList");
    var prev = S.team().prevPolicyId;
    clearNode(list);

    S.policies().forEach(function (p) {
      var btn = document.createElement("button");
      btn.className = "policy" + (selectedId === p.id ? " is-selected" : "");
      btn.setAttribute("data-id", p.id);
      btn.setAttribute("aria-pressed", selectedId === p.id ? "true" : "false");
      btn.onclick = function () { onPick(p.id); };

      var name = document.createElement("div");
      name.className = "policy__name";
      name.textContent = p.name;
      if (prev === p.id) {
        var cur = document.createElement("span");
        cur.className = "policy__current";
        cur.textContent = "지난 국면";
        name.appendChild(cur);
      }

      /* 한 줄이라 장점·단점을 하나씩만 붙입니다. 나머지는 빔에 있습니다. */
      var lines = document.createElement("div");
      lines.className = "policy__lines";
      if ((p.pros || [])[0]) {
        var pro = document.createElement("span");
        pro.className = "policy__pro";
        pro.textContent = p.pros[0];
        lines.appendChild(pro);
      }
      if ((p.cons || [])[0]) {
        var con = document.createElement("span");
        con.className = "policy__con";
        con.textContent = p.cons[0];
        lines.appendChild(con);
      }

      btn.appendChild(name);
      btn.appendChild(lines);
      list.appendChild(btn);
    });

    var pct = Math.round((1 - CFG.engine.policyChangePenalty) * 100);
    var warn = el("poWarn");
    if (prev && selectedId && selectedId !== prev) {
      warn.textContent = "정책을 바꿨습니다 — 이번 국면 투자 효율 −" + pct + "% · 조직피로도 상승";
      warn.classList.remove("hidden");
    } else {
      warn.classList.add("hidden");
    }
  }

  /* ============================================================
     시간 진행 (타임랩스)

     결정을 확정하면 바로 숫자 화면으로 가지 않고,
     그 기간 동안 우리와 경쟁사와 시장이 움직이는 것을 보여줍니다.
     ============================================================ */
  /* 이 결정이 담당하는 기간. 결정은 그 해에 내리고 결과는 앞으로 흐릅니다.
     ★ 예전에는 '이 국면 연도 − 시대별 고정 기간' 으로 거꾸로 셌습니다.
       그래서 1국면(1945)이 1927년부터 시작했습니다 — 회사가 없던 해입니다.
       이제 다음 국면 연도까지 앞으로 흐릅니다 (1945 → 1965). */
  function lapseSpan(hist) {
    var sp = S.subroundSpan(hist.subroundId);
    var from = sp && sp.from !== undefined ? sp.from : (hist.year || 0);
    var to   = sp && sp.to !== null && sp.to !== undefined ? sp.to : from;
    return { from: from, to: to, years: Math.max(0, to - from) };
  }

  function buildLapseLines(hist) {
    var lines = [];
    var startYear = lapseSpan(hist).from;

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
    var endYear = lapseSpan(hist).to;
    var step = Math.max(1, Math.round((endYear - startYear) / Math.max(1, lines.length)));
    lines.forEach(function (l, i) {
      l.year = Math.min(endYear, startYear + step * (i + 1));
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

  /* 확정한 뒤 노트북이 머무는 화면.
     이 사이 돌발상황 · 결과 · DRB 기록은 진행자 빔에서 봅니다 —
     그래서 여기서는 "화면을 보세요" 말고 할 말이 없어야 맞습니다. */
  function renderLiveWait(kind) {
    clearNewsFlash();
    var feed = el("tlFeed");
    clearNode(feed);
    el("btnSkipLapse").classList.add("hidden");

    /* ★ 연도가 흐르는 연출은 진행자 빔에서 다 같이 봅니다. 여기서는 돌리지 않습니다.
         노트북마다 따로 돌면 방이 흩어지고, 앞을 봐야 할 때 화면을 봅니다.
         대신 우리 결정이 담당하는 기간을 가만히 띄워둡니다.
         (예전에는 진행이 멈춘 자리에 직전 연출의 마지막 숫자가 그대로 남아
          1929 같은, 회사가 없던 해가 떠 있었습니다) */
    el("tlBox").classList.add("lapse--wait");
    var hist = S.lastHistory();
    var sp = hist ? lapseSpan(hist) : null;
    if (sp && sp.years > 0) {
      el("tlFrom").textContent = sp.from;
      el("tlYear").textContent = sp.to;
    } else {
      el("tlFrom").textContent = sp ? sp.from : "";
      el("tlYear").textContent = "";
    }
    el("tlFill").style.width = "100%";

    var who = "결정 잠금 완료";
    var copy = "결정은 전송됐습니다. 앞을 보세요 — 결과는 진행자 화면에서 함께 봅니다.";
    if (kind === "event") {
      el("tlCaption").textContent = "돌발상황 · 진행자 화면을 보세요";
      who = "돌발상황";
      copy = "모든 조에게 같은 일이 일어났습니다. 우리가 무엇을 쌓아뒀는지에 따라 다르게 맞습니다.";
    } else {
      el("tlCaption").textContent = "다음 국면 공개 대기 · 진행자 화면을 보세요";
    }

    var card = document.createElement("div");
    card.className = "timelapse__line timelapse__line--market";
    var label = document.createElement("span");
    label.className = "timelapse__who";
    label.textContent = who;
    var body = document.createElement("span");
    body.textContent = copy;
    card.appendChild(label);
    card.appendChild(body);
    feed.appendChild(card);
  }
  function renderTimelapse(hist, onDone) {
    el("btnSkipLapse").classList.remove("hidden");
    el("tlBox").classList.remove("lapse--wait");
    var feed = el("tlFeed");
    var yearBox = el("tlYear");
    clearNode(feed);
    clearNewsFlash();

    var sp = lapseSpan(hist);
    var startYear = sp.from;
    var span = sp.years;
    var lines = buildLapseLines(hist);

    el("tlCaption").textContent = span > 0 ? span + "년이 흐릅니다" : "결정을 정리합니다";
    el("tlFrom").textContent = startYear;
    el("tlNote").textContent = "결정의 결과를 계산하는 중";
    el("tlFill").style.width = "0%";
    yearBox.textContent = startYear;

    var i = 0;
    var timer = null;

    function step() {
      if (i >= lines.length) {
        clearInterval(timer);
        yearBox.textContent = sp.to;
        el("tlFill").style.width = "100%";
        setTimeout(onDone, 700);
        return;
      }
      var l = lines[i++];
      yearBox.textContent = l.year;
      el("tlFill").style.width = Math.round(i / lines.length * 100) + "%";

      var row = document.createElement("div");
      row.className = "timelapse__line timelapse__line--" + l.kind;
      row.innerHTML = "<span class='timelapse__who'>" + escapeHtml(l.who) + "</span>" +
                      "<span>" + escapeHtml(l.text) + "</span>";
      feed.appendChild(row);

      /* 사건이 터지는 순간 화면 오른쪽에 속보가 뜹니다 */
      if (l.event) showNewsFlash(l.event, l.year, l.isOurs);
    }

    /* 담당 기간이 짧아질수록 화면도 빨라집니다 (뒤로 갈수록 세상이 빨라진다) */
    var speed = span >= 18 ? 900 : span >= 13 ? 700 : 520;
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

    /* ★ 경쟁사 줄이 있던 자리입니다. 이제 시장과 고객만 남습니다 —
         멈추지 않는 것은 남의 회사가 아니라 시장 자체라는 말이 더 맞습니다. */
    var lines = [];
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

  /* 지나온 여섯 개의 연도 — 마지막 2026만 켜집니다 */
  function renderEndingYears() {
    var box = el("endYears");
    if (!box || box.children.length) return;
    var subs = allSubrounds();
    subs.forEach(function (sr, i) {
      var chip = document.createElement("span");
      chip.className = "ending__year-chip num" + (i === subs.length - 1 ? " is-now" : "");
      chip.textContent = sr.year;
      box.appendChild(chip);
    });
  }

  /* 한 화면이 두 단계로 열립니다 */
  function showEndingStep(n) {
    var box = el("ending");
    if (!box) return;
    renderEndingYears();
    box.setAttribute("data-step", String(n));
    if (n >= 1) {
      renderEndingMarket();
      el("btnEndNext").innerHTML = "마지막 결정 <span class='btn__arrow'>→</span>";
    } else {
      el("btnEndNext").innerHTML = "다음 <span class='btn__arrow'>→</span>";
    }
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

    el("fiPowerScore").textContent = power;
    el("fiPowerFill").style.width = clamp01(power / 100) * 100 + "%";
    /* ★ 변화 대응력은 숫자로 내놓지 않습니다.
         정상적으로 플레이해도 30 언저리라, 숫자만 보면 "우리가 못했나" 가 됩니다.
         참가자 화면에는 순위도 나가지 않으므로, 남은 여력이 무엇인지만 말합니다.
         (조끼리의 자리는 진행자 화면 시상에서 한 번만 공개합니다) */
    var strong = adapt.parts
      .filter(function (p) { return p.value >= 0.5; })
      .sort(function (a, b) { return b.value - a.value; })
      .slice(0, 3)
      .map(function (p) { return p.name; });
    el("fiAdaptScore").textContent = strong.length ? strong.join(" · ") : "아직 남은 것이 적습니다";
    el("fiAdaptFill").style.width = clamp01(adapt.score / 100) * 100 + "%";
    el("fiVerdict").textContent = verdictText(power, adapt.score);

    /* 변화 대응력이 무엇으로 만들어졌는지 — 올린 것과 깎아먹은 것 */
    var ap = el("fiAdaptParts");
    clearNode(ap);
    adapt.parts.slice().sort(function (a, b) { return b.value - a.value; }).forEach(function (p) {
      var chip = document.createElement("span");
      chip.className = "partchip" + (p.value < 0 ? " is-down" : "");
      chip.innerHTML = escapeHtml(p.name) + "<b class='num'>" + signed(p.value, 0) + "</b>";
      ap.appendChild(chip);
    });

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
      var pct = clamp01(t.state[m.key] / m.max) * 100;
      var row = document.createElement("div");
      row.className = "statebar";
      row.title = m.desc;
      row.innerHTML =
        "<span class='statebar__name'>" + escapeHtml(m.name) + "</span>" +
        "<span class='statebar__track'><span class='statebar__fill' style='width:" + pct + "%'></span></span>" +
        "<span class='statebar__value num'>" + fmt(t.state[m.key]) + "</span>";
      mbox.appendChild(row);
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

    /* 가장 고민했던 결정 — 시대마다 한 줄씩 */
    var gbox = el("fiGap");
    clearNode(gbox);
    window.DRB_ROUNDS.forEach(function (r) {
      var top = roundTopInvest(t, r.id);
      var btn = document.createElement("button");
      btn.className = "gap-option" + (t.gapPick === r.id ? " is-selected" : "");
      btn.setAttribute("aria-pressed", t.gapPick === r.id ? "true" : "false");
      btn.onclick = function () { onGapPick(r.id); };
      btn.innerHTML =
        "<span class='gap-option__year num'>" + r.subrounds[0].year + "</span>" +
        "<span class='gap-option__what'>" +
        (top ? escapeHtml(top) + "에 걸었다" : "아무 곳에도 걸지 않았다") + "</span>";
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

  /* ============================================================
     마지막 회고 — 다시 한다면 어디를 바꾸겠는가

     국면마다 받지 않습니다. 여섯 번을 다 지나고 시상까지 끝난 뒤,
     진행자가 빔에서 이 화면을 열어줄 때 한 번만 받습니다.
     ============================================================ */

  /* 체크할 항목은 조 자신의 기록에서 만듭니다 — 남의 결정은 나오지 않습니다.
     국면 결정 6개 + 그 조가 실제로 맞은 돌발상황들. */
  function reflectItems() {
    var t = S.team();
    var out = [];
    (t && t.history ? t.history : []).forEach(function (h, index) {
      var alloc = h.allocation || {};
      var top = Object.keys(alloc)
        .filter(function (id) { return alloc[id] > 0; })
        .sort(function (a, b) { return alloc[b] - alloc[a]; })
        .slice(0, 2)
        .map(function (id) { return investName(id); });
      out.push({
        id: "decision:" + h.subroundId,
        kind: "decision",
        tag: (index + 1) + "국면",
        year: h.year,
        /* 제목이 "첫 번째 국면 · 고무신인가" 라 왼쪽 태그와 겹칩니다 */
        title: String(h.subTitle || "").replace(/^[^·]*번째 국면\s*·\s*/, ""),
        detail: (top.length ? top.join(" + ") + " 중심" : "투자 없음") +
                (h.policyName ? " · " + h.policyName : "")
      });
      /* ★ 사건은 두 가지입니다. 딱지를 나눠 붙입니다.
           돌발    — 국면에 정해진 것. 밖에서 옵니다 (1986 자동차 입찰 · 1997 IMF).
           우리 상태 — 우리 회사가 그 상태가 되어 터진 것 (품질이 떨어져 클레임 등).
         둘 다 '돌발' 로 적어두니 두 번뿐인 돌발이 화면에서 네 번으로 보였습니다. */
      ((h.report && h.report.events) || []).forEach(function (event) {
        if (!event || !event.id) return;
        var inner = !!event.conditional;
        out.push({
          id: "event:" + h.subroundId + ":" + event.id,
          kind: inner ? "inner" : "event",
          tag: inner ? "우리 상태" : "돌발",
          year: h.year,
          title: event.title || "",
          detail: inner
            ? "우리 회사가 이렇게 되어 벌어진 일 · 그때 우리가 내린 판단"
            : "밖에서 온 일 · 그때 우리가 내린 판단"
        });
      });
    });
    return out;
  }

  /* draft = { picks: { id: true }, comment: "", submitted: bool } */
  function renderReflect(draft, onToggle) {
    /* 상단바는 진행 단계를 따라갑니다. 회고는 그 밖에 있어서 여기서 덮어씁니다 */
    el("tbStamp").textContent = "";
    el("tbTitle").textContent = "회고";
    el("tbSub").textContent = "다시 한다면";
    el("tbMeta").textContent = "";     /* 조 이름은 오른쪽 선택상자에 이미 있습니다 */

    var list = el("rfList");
    clearNode(list);

    var items = reflectItems();
    if (!items.length) {
      list.innerHTML = "<p class='hint'>아직 기록이 없습니다. 국면을 진행하면 여기에 우리 조의 결정이 쌓입니다.</p>";
    }

    /* 하나만 고릅니다. 여러 개를 고르면 간담회에서 무엇을 이야기할지 흐려집니다. */
    items.forEach(function (item) {
      var picked = draft.pick === item.id;
      var row = document.createElement("label");
      row.className = "rfitem rfitem--" + item.kind + (picked ? " is-picked" : "");

      var box = document.createElement("input");
      box.type = "radio";
      box.name = "rfPick";
      box.className = "rfitem__box";
      box.checked = picked;
      box.onchange = function () { onToggle(item.id); };

      var body = document.createElement("span");
      body.className = "rfitem__body";
      body.innerHTML =
        "<span class='rfitem__head'>" +
          "<span class='rfitem__tag'>" + escapeHtml(item.tag) + "</span>" +
          "<span class='rfitem__year num'>" + escapeHtml(item.year) + "</span>" +
        "</span>" +
        "<span class='rfitem__title'>" + escapeHtml(item.title) + "</span>" +
        "<span class='rfitem__detail'>" + escapeHtml(item.detail) + "</span>";

      row.appendChild(box);
      row.appendChild(body);
      list.appendChild(row);
    });

    var comment = el("rfComment");
    if (comment.value !== draft.comment) comment.value = draft.comment;
    el("rfCount").textContent = comment.value.length;

    var chosen = items.filter(function (item) { return item.id === draft.pick; })[0];
    el("rfStatus").textContent = draft.submitted
      ? "제출 완료 · 진행자 화면을 보세요 (고치면 다시 제출할 수 있습니다)"
      : (chosen ? "고른 것 · " + chosen.tag + " " + chosen.year + " " + chosen.title
                : "이야기하고 싶은 결정 하나를 고르세요.");
    el("btnReflectSend").innerHTML = (draft.submitted ? "다시 제출" : "제출") +
                                     " <span class='btn__arrow'>→</span>";
  }

  return {
    el: el, fmt: fmt, signed: signed, deltaClass: deltaClass,
    toast: toast, openModal: openModal, closeModal: closeModal,
    renderTopbar: renderTopbar, renderSide: renderSide, showDetail: showDetail,
    renderInvest: renderInvest, updateBudgetBar: updateBudgetBar, allocSum: allocSum,
    renderPolicy: renderPolicy,
    renderFinal: renderFinal,
    renderDecisionCard: renderDecisionCard,
    renderTimeline: renderTimeline, renderLiveWait: renderLiveWait, renderTimelapse: renderTimelapse,
    showEndingStep: showEndingStep, renderWorldMap: renderWorldMap,
    renderReflect: renderReflect,
    showNewsFlash: showNewsFlash, clearNewsFlash: clearNewsFlash,
    investName: investName, escapeHtml: escapeHtml
  };
})();
