/* ============================================================
   engine.js — 시뮬레이션 엔진

   이 파일은 '계산만' 합니다. 화면을 그리지 않습니다.
   게임의 모든 숫자는 여기서 규칙에 따라 결정됩니다.

   설계 원칙
     1) 1:1 대응 금지 — "R&D 30 투자 → 매출 +30" 같은 계산은 하지 않습니다.
        수요 × 생산능력 × 가격 × 품질 × 신뢰 × 시대환경이 함께 작용합니다.
     2) 시간차 — 설비는 다음 턴에, R&D는 쌓여야 터집니다.
     3) 설명 가능 — 모든 변화는 이유(label)와 함께 기록됩니다.
        관리자 모드에서 계산 근거를 그대로 볼 수 있습니다.
   ============================================================ */

window.DRBEngine = (function () {
  "use strict";

  var CFG = window.DRB_CONFIG;

  /* ---------- 작은 도구들 ---------- */

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /* 0~100 범위를 갖는 지표들 */
  var BOUNDED = ["capacity", "tech", "quality", "trust", "people", "fatigue",
                 "reach", "flex", "rigidity"];

  /* 투자 효율의 영향을 받지 않는 항목 (돈을 아낀 만큼만 효과가 나는 것들) */
  var RAW_KEYS = ["shield", "exposure"];

  /* ============================================================
     초기 상태
     ============================================================ */
  function createState() {
    var init = CFG.initialState;
    return {
      cash:     init.cash,
      capacity: init.capacity,
      tech:     init.tech,
      quality:  init.quality,
      trust:    init.trust,
      people:   init.people,

      /* 상세 지표 */
      rdStock:     0,     // R&D 축적
      fatigue:     10,    // 조직피로도
      reach:       40,    // 영업·거래처 도달범위
      demandBonus: 0,     // 신규사업·해외로 넓힌 수요 기반
      exposure:    0,     // 환율·무역 사건 노출도
      shield:      0,     // 이번 턴 한정 충격 완화 (매 턴 초기화)

      /* 후반부에 중요해지는 지표 — 변화 대응력의 재료 */
      flex:        36,    // 공급망·설비 유연성
      rigidity:    10,    // 경직성 (커질수록 방향 전환이 어렵다)
      experiments:  0,    // 작게 해본 실험 횟수
      sites:       [],    // 해외 거점 [{country, mode, scale, stage, dueTurn}]
      globalReach:  0,    // 가동 중인 해외 거점의 크기 합

      /* 기록 */
      pending:     [],    // [{ dueTurn, metric, amount, label }]
      investTotals: {},   // 누적 투자액 { facility: 30, ... }
      lastConditional: null,  // 직전 턴에 터진 조건부 사건 (연속 발생 방지)
      lastIdleRate: 0,
      lastRevenue:  0,
      lastProfit:   0
    };
  }

  /* ============================================================
     변화 대응력 (Adaptive Capacity)

     게임 중에는 참가자에게 보여주지 않습니다.
     마지막에만 공개해서 "매출이 높은 회사 = 좋은 회사"가 아니라는 것을
     숫자로 보여주는 장치입니다.

     선택권을 만드는 것 : 현금 · 기술 · 판로 · 유연성 · 사람 · 해외 · 실험
     선택권을 없애는 것 : 경직성 · 조직피로
     ============================================================ */
  function adaptiveCapacity(s) {
    var parts = [
      { name: "현금 여력",     value: clamp(s.cash / 420, 0, 1) * 18 },
      { name: "기술 옵션",     value: clamp((s.tech + s.rdStock * 0.5) / 95, 0, 1) * 18 },
      { name: "고객 다변화",   value: clamp(s.reach / 100, 0, 1) * 12 },
      { name: "공급망 유연성", value: clamp(s.flex / 90, 0, 1) * 22 },
      { name: "인재 역량",     value: clamp(s.people / 100, 0, 1) * 12 },
      { name: "글로벌 포트폴리오", value: clamp(s.globalReach / 45, 0, 1) * 12 },
      { name: "실험 경험",     value: clamp(s.experiments / 4, 0, 1) * 10 }
    ];
    var penalties = [
      { name: "경직성",       value: -clamp(s.rigidity / 100, 0, 1) * 20 },
      { name: "조직 피로",     value: -clamp(s.fatigue / 100, 0, 1) * 10 }
    ];
    var total = 0;
    parts.concat(penalties).forEach(function (p) { total += p.value; });
    return {
      score: clamp(Math.round(total), 0, 100),
      parts: parts.concat(penalties).map(function (p) {
        return { name: p.name, value: Math.round(p.value * 10) / 10 };
      })
    };
  }

  /* 별 5개로 환산 (최종 화면 표시용) */
  function stars(score) {
    var n = Math.max(1, Math.min(5, Math.round(score / 20)));
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }

  /* ============================================================
     조건 평가 — events.js 의 when / trigger 를 판단
     ============================================================ */
  function readField(field, s, ctx) {
    if (field.indexOf("invest.") === 0) {
      return ctx.allocation[field.slice(7)] || 0;
    }
    if (field.indexOf("total.") === 0) {
      return s.investTotals[field.slice(6)] || 0;
    }
    if (field === "policy")   return ctx.policyId;
    if (field === "idleRate") return s.lastIdleRate;
    if (field === "sites")    return (s.sites || []).length;
    return s[field];
  }

  function testCondition(cond, s, ctx) {
    if (!cond) return true;
    var v = readField(cond.field, s, ctx);
    if (v === undefined || v === null) return false;
    switch (cond.op) {
      case ">=": return v >= cond.value;
      case ">":  return v >  cond.value;
      case "<=": return v <= cond.value;
      case "<":  return v <  cond.value;
      case "==": return v === cond.value;
      case "!=": return v !== cond.value;
      default:   return false;
    }
  }

  /* ============================================================
     메인 : 한 소라운드를 계산한다
     ------------------------------------------------------------
     ctx = {
       state, era, investments, policy, policyId, prevPolicyId,
       allocation, subround, turnIndex
     }
     반환 = { state, report }
     ============================================================ */
  function runSubround(ctx) {
    var E   = CFG.engine;
    var s   = JSON.parse(JSON.stringify(ctx.state));   // 원본 훼손 방지
    var era = ctx.era;
    var m   = era.market;
    var mods = (ctx.policy && ctx.policy.mods) || {};

    var report = {
      turnIndex:   ctx.turnIndex,
      subroundId:  ctx.subround.id,
      policyName:  ctx.policy ? ctx.policy.name : "-",
      policyChanged: false,
      spent: 0,
      allocation: ctx.allocation,
      changes: {},        // { metric: [{label, amount}] }  ← 모든 변화의 근거
      events: [],         // 발생한 사건과 팀별 반응
      revenueBreakdown: [],
      profitBreakdown: [],
      notes: [],
      /* 한 곳만 딸 수 있는 기회 중, 조건은 넘겼는데 아직 판정이 안 난 것 */
      pendingAwards: [],
      kpi: {}
    };

    /* 어떤 지표가 왜 변했는지를 전부 기록한다 */
    function track(metric, amount, label) {
      if (!amount) return;
      if (!report.changes[metric]) report.changes[metric] = [];
      report.changes[metric].push({ label: label, amount: amount });
      s[metric] = (s[metric] || 0) + amount;
    }

    /* ---------- 0. 턴 시작 정리 ---------- */
    s.shield = 0;

    /* ---------- 1. 정책 적용 ---------- */
    var investEff = mods.investEff || 1;

    if (ctx.prevPolicyId && ctx.prevPolicyId !== ctx.policyId) {
      report.policyChanged = true;
      investEff *= E.policyChangePenalty;
      track("fatigue", E.policyChangeFatigue, "정책 변경에 따른 조직 혼란");
      report.notes.push({
        tone: "warn",
        text: "정책을 바꿨습니다. 이번 턴 투자 효율이 " +
              Math.round((1 - E.policyChangePenalty) * 100) + "% 떨어집니다."
      });
    }

    /* 사람이 많으면 실행이 빠르고, 지쳐 있으면 느리다 */
    var peopleFactor  = 0.85 + 0.30 * (s.people / 100);   // 인력 50 → 1.00
    var fatigueFactor = 1 - (s.fatigue / 100) * 0.35;
    investEff *= peopleFactor * fatigueFactor;
    report.investEff = round1(investEff * 100) / 100;

    /* ---------- 2. 투자 집행 ---------- */
    var multAcc = { unitCost: 0, demand: 0, price: 0, fixedCost: 0 };
    var spent = 0;

    ctx.investments.forEach(function (item) {
      var amt = ctx.allocation[item.id] || 0;
      if (amt <= 0) return;

      if (!item.keepCash) spent += amt;
      s.investTotals[item.id] = (s.investTotals[item.id] || 0) + amt;

      /* 정책이 '해보지 않은 분야'의 투자 효율을 깎는 경우
         (예: 본업 집중 정책 → 신사업·해외 -20%)
         어떤 항목이 그에 해당하는지는 investments.js 의 newField 로 표시합니다. */
      var eff = amt * investEff;
      if (mods.newFieldEff && item.newField) {
        eff *= mods.newFieldEff;
      }

      var p = item.perUnit || {};

      /* 즉시 효과 */
      if (p.now) {
        Object.keys(p.now).forEach(function (k) {
          var base = RAW_KEYS.indexOf(k) >= 0 ? amt : eff;
          track(k, round1(p.now[k] * base), item.name + " 투자 (즉시)");
        });
      }

      /* 다음 턴 효과 */
      if (p.next) {
        Object.keys(p.next).forEach(function (k) {
          s.pending.push({
            dueTurn: ctx.turnIndex + 1,
            metric: k,
            amount: round1(p.next[k] * eff),
            label: item.name + " 투자 효과 발생"
          });
        });
      }

      /* 두 턴 뒤 효과 */
      if (p.later) {
        Object.keys(p.later).forEach(function (k) {
          s.pending.push({
            dueTurn: ctx.turnIndex + 2,
            metric: k,
            amount: round1(p.later[k] * eff),
            label: item.name + " 투자 효과 발생 (지연분)"
          });
        });
      }

      /* 누적 스톡 (R&D) */
      if (p.stock) {
        Object.keys(p.stock).forEach(function (k) {
          var rdEff = (k === "rdStock" ? (mods.rdEff || 1) : 1);
          track(k, round1(p.stock[k] * eff * rdEff), item.name + " 투자 축적");
        });
      }

      /* 이번 턴 계산에 쓰이는 배율 */
      if (p.mult) {
        Object.keys(p.mult).forEach(function (k) {
          multAcc[k] = (multAcc[k] || 0) + p.mult[k] * eff;
        });
      }

      /* ---------- 해외 진출 : 어디에 / 어떤 방식으로 ----------
         같은 금액이라도 나라와 방식에 따라 결과가 완전히 달라집니다. */
      if (item.dimensions && window.DRB_GLOBAL) {
        var G  = window.DRB_GLOBAL;
        var ch = (ctx.choices || {})[item.id] || {};
        var country = G.countries.filter(function (c) { return c.id === ch.where; })[0];
        var mode    = G.modes.filter(function (m) { return m.id === ch.how; })[0]
                   || G.modes[0];

        if (country) {
          var scale = eff * mode.effectFactor * (1 - (mode.controlPenalty || 0));

          /* 기술이 모자라면 유럽 같은 곳은 문이 잘 안 열립니다 */
          if (country.techRequire && s.tech < m.techRequirement + country.techRequire) {
            scale *= 0.6;
            report.notes.push({
              tone: "warn",
              text: country.name + " 는 기술 인증 문턱이 높습니다. 아직 우리 기술로는 절반만 통했습니다."
            });
          }

          s.sites.push({
            country: country.id,
            countryName: country.name,
            mode: mode.id,
            modeName: mode.name,
            scale: round1(scale),
            stage: mode.delay > 0 ? "build" : "running",
            dueTurn: ctx.turnIndex + mode.delay,
            since: ctx.turnIndex
          });

          track("exposure", round1(amt * (mode.exposure || 0.5) * 0.4),
                country.name + " " + mode.name + " 진출 (환율·현지 위험 노출)");
          if (mode.rigidityAdd) {
            track("rigidity", round1(mode.rigidityAdd * (amt / 40)),
                  country.name + " 직접 생산법인 — 한번 지으면 접기 어렵다");
          }
          if (mode.trustBonus) {
            track("trust", mode.trustBonus, country.name + " 현지 고객 접점 확보");
          }

          report.notes.push({
            tone: "good",
            text: country.name + " · " + mode.name + " 결정 — " +
                  (mode.delay > 0 ? mode.delay + "국면 뒤 가동됩니다." : "즉시 시작합니다.")
          });
        } else if (amt > 0) {
          report.notes.push({
            tone: "warn",
            text: item.name + " 에 투자했지만 진출 지역을 정하지 않아 효과가 절반으로 줄었습니다."
          });
        }
      }
    });

    if (spent > 0) {
      track("cash", -spent, "이번 턴 투자 집행");
    }
    report.spent = spent;

    /* ---------- 3. 지난 투자의 효과가 지금 도착한다 ---------- */
    var stillPending = [];
    s.pending.forEach(function (p) {
      if (p.dueTurn <= ctx.turnIndex) {
        track(p.metric, p.amount, p.label);
      } else {
        stillPending.push(p);
      }
    });
    s.pending = stillPending;

    /* ---------- 3-2. 해외 거점이 자라거나 시든다 ---------- */
    var runningGlobal = 0;
    (s.sites || []).forEach(function (site) {
      if (site.stage === "build" && site.dueTurn <= ctx.turnIndex) {
        site.stage = "running";
        report.notes.push({ tone: "good", text: site.countryName + " " + site.modeName + " 가동을 시작했습니다." });
      }
      if (site.stage === "running" || site.stage === "expand") {
        runningGlobal += site.scale;
      }
    });
    s.globalReach = round1(runningGlobal);

    /* 가동 중인 거점이 수요와 원가에 실제로 작용한다 */
    if (window.DRB_GLOBAL && runningGlobal > 0) {
      var G2 = window.DRB_GLOBAL;
      var demandFromGlobal = 0, costFromGlobal = 0, priceFromGlobal = 0;
      (s.sites || []).forEach(function (site) {
        if (site.stage !== "running" && site.stage !== "expand") return;
        var c = G2.countries.filter(function (x) { return x.id === site.country; })[0];
        if (!c) return;
        demandFromGlobal += site.scale * c.demandMult * 0.30;
        costFromGlobal   += site.scale * (c.costMult - 1) * 0.004;
        priceFromGlobal  += site.scale * (c.priceBonus || 0) * 0.004;
      });
      if (demandFromGlobal > 0) {
        track("demandBonus", round1(demandFromGlobal * 0.10), "해외 거점 가동 효과");
      }
      multAcc.unitCost = (multAcc.unitCost || 0) + costFromGlobal;
      multAcc.price    = (multAcc.price || 0) + priceFromGlobal;
    }

    /* ---------- 4. 정책의 지속 효과 ---------- */
    if (mods.qualityDrift)  track("quality",  mods.qualityDrift,  "정책: " + ctx.policy.name);
    if (mods.trustDrift)    track("trust",    mods.trustDrift,    "정책: " + ctx.policy.name);
    if (mods.fatigueDrift)  track("fatigue",  mods.fatigueDrift,  "정책: " + ctx.policy.name);
    if (mods.peopleDrift)   track("people",   mods.peopleDrift,   "정책: " + ctx.policy.name);
    if (mods.flexDrift)     track("flex",     mods.flexDrift,     "정책: " + ctx.policy.name);
    if (mods.rigidityDrift) track("rigidity", mods.rigidityDrift, "정책: " + ctx.policy.name);

    /* ---------- 4-2. 회사가 커지면 무거워진다 (선두 독주 방지) ----------
       규모 자체가 나쁜 것은 아니지만, 커질수록 방향을 바꾸기 어려워집니다. */
    var sizeIndex = s.capacity + s.globalReach * 0.5;
    if (sizeIndex > 60) {
      track("rigidity", round1((sizeIndex - 60) / 100 * 4), "규모가 커진 만큼 조직이 무거워짐");
    }
    track("rigidity", -1.2, "자연 완화");
    track("flex", -0.5, "관리하지 않으면 유연성은 굳는다");

    /* ---------- 5. R&D 축적이 임계를 넘으면 기술이 도약한다 ---------- */
    var jumps = 0;
    while (s.rdStock >= E.rdStockPerTech && jumps < 5) {
      s.rdStock -= E.rdStockPerTech;
      jumps++;
    }
    if (jumps > 0) {
      track("tech", E.techJumpAmount * jumps, "R&D 축적이 임계를 넘어 기술 도약");
      report.notes.push({
        tone: "good",
        text: "쌓아온 R&D가 터졌습니다. 기술력 +" + (E.techJumpAmount * jumps)
      });
    }

    /* ---------- 6. 돌발상황 ---------- */
    var eventMult = { unitCost: 0, demand: 0, price: 0 };
    var shockMult = mods.shockMult || 1;
    var shield    = clamp(s.shield, 0, 0.45);

    function applyEvent(ev) {
      /* ★ conditional 을 기록에 남깁니다. 두 가지는 성격이 전혀 다릅니다 —
           국면에 정해진 사건은 밖에서 오고(자동차 입찰 · IMF), 조건부 사건은
           우리 회사가 그 상태가 되어서 터집니다(품질 30 미만 → 클레임).
           둘을 같은 '돌발' 로 적어두면 "돌발은 두 번" 이라고 말해놓고
           회고 화면에는 네 번이 뜹니다. 실제로 그렇게 보였습니다. */
      var entry = { id: ev.id, title: ev.title, body: ev.body,
                    conditional: !!ev.conditional, reactions: [] };

      function applyMod(mod, sourceLabel) {
        if (!mod) return;
        if (mod.mult) {
          Object.keys(mod.mult).forEach(function (k) {
            var v = mod.mult[k];
            /* 나쁜 방향(원가↑ / 수요↓ / 가격↓)만 완화 대상 */
            var isBad = (k === "unitCost") ? v > 0 : v < 0;
            if (isBad) v = v * shockMult * (1 - shield);
            eventMult[k] = (eventMult[k] || 0) + v;
          });
        }
        if (mod.delta) {
          Object.keys(mod.delta).forEach(function (k) {
            var v = mod.delta[k];
            if (v < 0) v = v * shockMult * (1 - shield);
            track(k, round1(v), sourceLabel);
          });
        }
      }

      applyMod(ev.base, "사건: " + ev.title);

      (ev.reactions || []).forEach(function (r) {
        if (!testCondition(r.when, s, ctx)) return;

        /* ---------- 한 곳만 딸 수 있는 기회 ----------
           조건을 넘겼다고 바로 주지 않습니다. 모든 조가 확정한 뒤에 판정합니다.
           판정 전에 주면 먼저 확정한 조가 유리해집니다. */
        if (r.limited) {
          var winners = (ctx.awards || {})[r.limited.id];
          if (winners === undefined || winners === null) {
            entry.reactions.push({
              text: r.limited.title + " — 모든 조가 확정하면 판정합니다",
              positive: true, pending: true
            });
            report.pendingAwards.push(r.limited.id);
            return;
          }
          var won = [].concat(winners).indexOf(ctx.teamName) >= 0;
          if (won) {
            entry.reactions.push({ text: r.text, positive: isPositiveMod(r.mod), won: true });
            applyMod(r.mod, "→ " + r.text);
          } else if (r.limited.lost) {
            entry.reactions.push({ text: r.limited.lost.text, positive: false, lost: true });
            applyMod(r.limited.lost.mod, "→ " + r.limited.lost.text);
          }
          return;
        }

        entry.reactions.push({ text: r.text, positive: isPositiveMod(r.mod) });
        applyMod(r.mod, "→ " + r.text);
      });

      report.events.push(entry);
    }

    function isPositiveMod(mod) {
      if (!mod) return true;
      var score = 0;
      if (mod.mult) {
        Object.keys(mod.mult).forEach(function (k) {
          score += (k === "unitCost" ? -mod.mult[k] : mod.mult[k]);
        });
      }
      if (mod.delta) {
        Object.keys(mod.delta).forEach(function (k) {
          score += (k === "fatigue" ? -mod.delta[k] : mod.delta[k]);
        });
      }
      return score >= 0;
    }

    /* 6-1. 이 소라운드에 정해진 사건 */
    if (ctx.subround.event && window.DRB_EVENTS[ctx.subround.event]) {
      applyEvent(window.DRB_EVENTS[ctx.subround.event]);
    }

    /* 6-2. 팀 상태 때문에 그 팀에만 벌어지는 사건 (한 턴에 하나만)
           같은 사건이 매 턴 반복되면 학습이 아니라 소음이 되므로,
           직전 턴에 터진 사건은 한 턴 건너뛴다. */
    if (ctx.subround.allowConditional) {
      var keys = Object.keys(window.DRB_EVENTS);
      var fired = null;
      for (var i = 0; i < keys.length; i++) {
        var ev = window.DRB_EVENTS[keys[i]];
        if (!ev.conditional) continue;
        if (ev.id === s.lastConditional) continue;
        if (testCondition(ev.trigger, s, ctx)) {
          applyEvent(ev);
          fired = ev.id;
          break;
        }
      }
      s.lastConditional = fired;
    }

    /* ---------- 7. 지표 정리 (계산 전 클램프) ---------- */
    BOUNDED.forEach(function (k) { s[k] = clamp(s[k], 0, 100); });
    s.rdStock     = Math.max(0, s.rdStock);
    s.demandBonus = clamp(s.demandBonus, 0, 60);

    /* ============================================================
       8. 시장 → 생산 → 손익
       여러 요소가 곱해져야 결과가 나온다 (어느 하나만 잘해선 안 됨)
       ============================================================ */
    /* 같은 시장에 여러 회사가 몰리면 경쟁이 심해진다.
       ctx.crowding = 0~1 (우리가 고른 주력 분야에 몇 곳이 몰렸는가)

       ★ 시대가 주는 기본 경쟁강도와, 조들이 몰려서 생기는 압력을 따로 곱합니다.
         기본값은 건드리지 않고 '남들이 나와 같은 곳에 걸었다'는 것만 아프게 만들어야
         참가자가 경쟁을 실제로 체감합니다. 세기는 config.js 의 crowdingPenalty. */
    var crowding = clamp(ctx.crowding || 0, 0, 1);
    var crowdWeight = E.crowdingPenalty === undefined ? 0.18 : E.crowdingPenalty;
    var effectiveCompetition = clamp(m.competition + crowding * 0.38, 0, 0.92);

    var factors = {
      base:        (m.demand + s.demandBonus),
      policy:      (mods.demandMult || 1),
      invest:      1 + multAcc.demand,
      event:       1 + (eventMult.demand || 0),
      trust:       0.65 + 0.35 * (s.trust / 100),
      reach:       0.65 + 0.35 * (s.reach / 100),
      techFit:     clamp(1.00 + (s.tech - m.techRequirement) / 100, 0.55, 1.35),
      competition: (1 - m.competition * 0.30) * (1 - crowding * crowdWeight)
    };
    report.crowding = Math.round(crowding * 100);
    report.competitionLevel = Math.round(effectiveCompetition * 100);

    function demandWith(over) {
      var f = Object.assign({}, factors, over || {});
      return f.base * f.policy * f.invest * f.event *
             f.trust * f.reach * f.techFit * f.competition;
    }

    var demand      = demandWith();
    var effCapacity = s.capacity * (1 - (s.fatigue / 100) * 0.15);
    var sold        = Math.min(demand, effCapacity);
    var fillRate    = demand > 0 ? sold / demand : 1;
    var utilization = effCapacity > 0 ? sold / effCapacity : 0;
    var idleRate    = 1 - utilization;

    /* 단가 : 품질과 기술이 값을 지켜준다 */
    var price = m.priceIndex
              * (0.85 + 0.15 * (s.quality / 100) + 0.22 * (s.tech / 100))
              * (1 + multAcc.price + (eventMult.price || 0));

    /* 원가 : 품질이 낮으면 불량 때문에 오히려 비싸진다 */
    var qualityCostGain = ((s.quality - 50) / 100) * 0.08;
    var unitCost = E.baseUnitCost
                 * m.materialCost
                 * (mods.unitCost || 1)
                 * (1 + multAcc.unitCost + (eventMult.unitCost || 0))
                 * (1 - qualityCostGain);

    var revenue   = sold * price * E.revenueScale;
    var varCost   = sold * unitCost * E.revenueScale;
    var fixedCost = (s.capacity * E.fixedCostPerCapacity +
                     s.people   * E.fixedCostPerPeople * m.laborCost)
                  * (mods.fixedCost || 1)
                  * (1 + multAcc.fixedCost);

    var profit = revenue - varCost - fixedCost;
    track("cash", round1(profit), "이번 턴 영업손익");

    /* ---------- 8-1. 매출이 왜 이렇게 나왔는지 ---------- */
    /* 각 요인을 '중립값'으로 바꿔 다시 계산해서, 그 요인이 없었다면
       얼마나 달랐을지를 구한다. (곱셈 모델이라 이 방식이 가장 정직하다) */
    var contributions = [
      { label: "시장 수요 (시대 환경)",  value: factors.base - 100 },
      { label: "고객신뢰",              value: demand - demandWith({ trust: 0.775 }) },
      { label: "영업·거래처",           value: demand - demandWith({ reach: 0.775 }) },
      { label: "기술 수준 대비 시장요구", value: demand - demandWith({ techFit: 1 }) },
      { label: "경쟁 강도",             value: demand - demandWith({ competition: 1 }) },
      { label: "경영정책",              value: demand - demandWith({ policy: 1 }) },
      { label: "이번 턴 투자",          value: demand - demandWith({ invest: 1 }) },
      { label: "돌발상황",              value: demand - demandWith({ event: 1 }) }
    ];

    var lostToCapacity = sold - demand;            // 음수 = 못 판 물량
    if (lostToCapacity < -0.5) {
      contributions.push({ label: "생산능력 부족으로 놓친 물량", value: lostToCapacity });
    }

    report.revenueBreakdown = contributions
      .filter(function (c) { return Math.abs(c.value) >= 0.5; })
      .map(function (c) {
        return { label: c.label, value: round1(c.value * price * E.revenueScale) };
      })
      .sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });

    report.profitBreakdown = [
      { label: "매출",       value: round1(revenue) },
      { label: "변동비(원가)", value: -round1(varCost) },
      { label: "고정비(설비·인건비)", value: -round1(fixedCost) }
    ];

    /* ---------- 8-2. 생산·품질·신뢰의 뒷정리 ---------- */
    if (utilization >= E.utilizationWarn) {
      track("quality", -2.5, "설비를 한계까지 돌려 품질이 흔들림");
      track("fatigue", 5, "과부하 조업");
    }
    if (fillRate < E.fillPenaltyBelow) {
      var miss = round1((E.fillPenaltyBelow - fillRate) * 20);
      track("trust", -miss, "주문을 다 소화하지 못해 납기 신뢰 하락");
    } else if (fillRate >= 0.97 && s.quality >= 55) {
      track("trust", 2, "납기와 품질을 지켜 신뢰 상승");
    }
    if (idleRate > 0.35) {
      track("fatigue", 3, "설비가 놀아 조직이 늘어짐");
    }

    /* 품질은 관리하지 않으면 서서히 떨어진다 */
    track("quality", -E.qualityDecay, "관리하지 않으면 품질은 떨어진다");
    /* 피로도는 조금씩 회복된다 */
    track("fatigue", -3, "자연 회복");

    /* ---------- 8-3. 현금이 바닥나면 자산을 팔아 버틴다 ----------
       실패는 탈락이 아니라 '다음 국면의 조건이 달라지는 것'입니다.
       회사는 작아지지만, 작아진 만큼 가벼워져서 다시 움직일 수 있습니다. */
    if (s.cash < E.rescueBelow) {
      var sellable = Math.min(s.capacity * 0.28, 28);
      if (sellable > 3) {
        track("capacity", -round1(sellable), "자금난 — 비핵심 설비 매각");
        track("cash", round1(sellable * 2.4), "설비 매각 대금");
        track("rigidity", -4, "몸집이 줄어 오히려 가벼워짐");
        track("flex", 3, "군더더기를 덜어내 유연해짐");
        track("fatigue", 5, "구조조정에 따른 조직 피로");
        report.notes.push({
          tone: "warn",
          text: "현금이 바닥나 비핵심 설비를 팔았습니다. 회사는 작아졌지만 살아남았습니다. " +
                "다음 국면에도 결정할 수 있습니다."
        });
      }
    }

    /* 규모가 아주 커지면 관리비가 비선형으로 붙는다 (선두 독주 방지) */
    if (s.capacity > E.sizeCostFrom) {
      var over = (s.capacity - E.sizeCostFrom) / 100;
      track("cash", -round1(over * over * E.sizeCostWeight), "규모가 커진 만큼 늘어난 관리비");
    }

    /* ---------- 9. 마무리 ---------- */
    BOUNDED.forEach(function (k) { s[k] = clamp(round1(s[k]), 0, 100); });

    /* 고객신뢰가 0이 되면 수요가 영영 돌아오지 않아 게임이 끝나버린다.
       아무리 망해도 오래된 거래처 몇 곳은 남는다고 보고 최소선을 둔다. */
    if (s.trust < E.trustFloor) {
      track("trust", round1(E.trustFloor - s.trust), "오래된 거래처 몇 곳은 남았다 (최소선)");
      s.trust = E.trustFloor;
    }

    s.cash        = round1(s.cash);
    s.rdStock     = round1(Math.max(0, s.rdStock));
    s.demandBonus = clamp(round1(s.demandBonus), 0, 90);
    s.exposure    = clamp(round1(s.exposure), 0, 100);
    s.experiments = round1(Math.max(0, s.experiments));
    s.lastIdleRate = round1(idleRate * 100) / 100;
    s.lastRevenue  = round1(revenue);
    s.lastProfit   = round1(profit);

    report.kpi = {
      revenue:     round1(revenue),
      profit:      round1(profit),
      sold:        round1(sold),
      demand:      round1(demand),
      capacity:    round1(effCapacity),
      utilization: Math.round(utilization * 100),
      fillRate:    Math.round(fillRate * 100),
      unitPrice:   Math.round(price * 100) / 100,
      unitCost:    Math.round(unitCost * 100) / 100,
      globalReach: s.globalReach,
      adaptive:    adaptiveCapacity(s).score
    };

    /* 결과를 한 줄로 설명 */
    report.headline = buildHeadline(report, s);

    return { state: s, report: report };
  }

  /* ============================================================
     결과 한 줄 요약 — AI가 아니라 규칙으로 만듭니다
     ============================================================ */
  function buildHeadline(report, s) {
    var k = report.kpi;
    if (k.fillRate < 85) {
      return "주문은 들어왔지만 다 만들지 못했습니다. 생산능력이 발목을 잡았습니다.";
    }
    if (k.utilization < 60) {
      return "만들 수는 있었지만 팔 곳이 부족했습니다. 설비가 놀고 있습니다.";
    }
    if (report.kpi.profit < 0) {
      return "매출은 있었지만 남지 않았습니다. 원가와 고정비를 다시 봐야 합니다.";
    }
    if (s.cash < 25) {
      return "이익은 났지만 현금이 위험합니다. 다음 턴 투자 여력이 거의 없습니다.";
    }
    if (k.profit > 40) {
      return "수요와 생산능력이 맞아떨어졌습니다. 이번 턴은 잘 굴러갔습니다.";
    }
    return "무난하게 굴러갔습니다. 다만 앞서 나가지도 못했습니다.";
  }

  /* ============================================================
     최종 경영스타일 판정
     ============================================================ */
  function judgeStyle(rawState) {
    var list = window.DRB_STYLES;
    var threshold = window.DRB_STYLE_THRESHOLD || 0.28;
    var best = null, bestScore = 0;

    /* 변화 대응력은 저장된 값이 아니라 그때그때 계산합니다 */
    var state = JSON.parse(JSON.stringify(rawState));
    state.adaptive = adaptiveCapacity(rawState).score;

    list.forEach(function (st) {
      if (!st.score) return;
      var v = state[st.score.metric];
      if (v === undefined || v === null) return;
      var score = (v - st.score.base) / st.score.span;
      if (score > bestScore) { bestScore = score; best = st; }
    });

    if (best && bestScore >= threshold) return best;

    /* 아무것도 두드러지지 않으면 균형형 */
    var fallback = list.filter(function (s) { return !s.score; })[0];
    return fallback || list[list.length - 1];
  }

  /* 스타일 판정 근거 (관리자·진행자 화면에서 확인용) */
  function styleScores(rawState) {
    var state = JSON.parse(JSON.stringify(rawState));
    state.adaptive = adaptiveCapacity(rawState).score;
    return window.DRB_STYLES
      .filter(function (s) { return s.score; })
      .map(function (s) {
        return {
          name: s.name,
          value: state[s.score.metric],
          score: Math.round(((state[s.score.metric] - s.score.base) / s.score.span) * 100) / 100
        };
      })
      .sort(function (a, b) { return b.score - a.score; });
  }

  /* 어느 분야에 몇 곳이 몰렸는지 (0~1) — 경쟁강도 계산에 씁니다 */
  /* ============================================================
     한 곳만 딸 수 있는 기회 — 누가 가져가는가

     ★ 진행자 화면과 참가자 노트북이 **같은 이 코드**를 씁니다.
       두 곳에서 따로 계산하면 반드시 다른 답이 나옵니다.
     ============================================================ */

  /* 이 국면의 사건에 한정 기회가 들어 있는가 */
  function limitedOffers(subround) {
    var out = [];
    if (!subround || !subround.event) return out;
    var ev = (window.DRB_EVENTS || {})[subround.event];
    if (!ev) return out;
    (ev.reactions || []).forEach(function (r) {
      if (r.limited) out.push({ offer: r.limited, when: r.when, eventId: ev.id });
    });
    return out;
  }

  /* 한 조의 입찰을 항목별로 채점합니다. 돈만 보지 않고 회사 상태를 함께 봅니다.
     각 항목을 0~1 로 눌러서 가중치를 곱합니다 — 단위가 다른 값을 그냥 더하면
     투자액(0~80)이 지표(0~100)를 잡아먹습니다.

     ★ 화면이 실제 입찰 평가표처럼 보여줄 수 있게 항목을 그대로 내놓습니다.
       예전에는 합계 하나만 나갔습니다. 그러면 "왜 저 조가 땄나" 에 답할 수가 없고,
       두 조 점수가 비슷하게 찍히면 진행자도 이유를 설명하지 못합니다.
       allotted/earned 는 100점 만점으로 환산한 값입니다 (weight 1.0 = 100점). */
  function bidBreakdown(offer, state, allocation, policyId) {
    var ctx = { allocation: allocation || {}, policyId: policyId };
    return (offer.score || []).map(function (part) {
      var raw = readField(part.field, state, ctx);
      var ok = typeof raw === "number" && isFinite(raw);
      var weight = part.weight === undefined ? 1 : part.weight;
      var max = part.max || 100;
      var ratio = ok ? clamp(raw / max, 0, 1) : 0;
      return {
        field:    part.field,
        raw:      ok ? Math.round(raw * 10) / 10 : 0,
        max:      max,
        allotted: weight * 100,          // 이 항목의 배점
        earned:   ratio * weight * 100   // 받은 점수
      };
    });
  }

  function bidScore(offer, state, allocation, policyId) {
    var total = 0;
    bidBreakdown(offer, state, allocation, policyId).forEach(function (p) {
      total += p.earned / 100;
    });
    return Math.round(total * 1000) / 1000;
  }

  /* ★ 동점자 처리 — 실제 입찰의 규정과 같은 순서입니다.

       1) 총점
       2) 배점이 큰 평가항목에서 높은 점수를 받은 곳
          (국가계약법 동점자 처리가 이렇게 합니다. 여기서는 투자액 100 →
           기술력 55 → 고객신뢰 45 → 인력 30 순으로 내려갑니다)
       3) 그 분야 누적 투자액 — 동종 실적. 먼저부터 준비해 온 곳이 가져갑니다.
       4) 조 이름

     ⚠ 추첨을 쓰지 않습니다. 진행자 화면과 조 노트북이 각각 따로 계산하기 때문에,
       같은 입력에서 반드시 같은 답이 나와야 합니다. 무작위를 넣으면 두 화면이
       다른 조를 낙찰자로 띄웁니다.
     그리고 4)까지 내려가면 "조 이름 순" 이라는 근거 없는 이유가 되므로,
     무엇으로 갈랐는지를 tieBreak 에 담아 화면이 그대로 밝히게 합니다. */
  var TIE_RULES = { item: "배점이 큰 항목", legacy: "그 분야 누적 투자액", name: "조 이름" };

  function compareBids(a, b) {
    if (b.score !== a.score) return { diff: b.score - a.score, by: null };

    /* 배점이 큰 항목부터 내려가며 비교합니다 */
    var parts = a.parts || [];
    var order = parts.map(function (p, i) { return i; }).sort(function (x, y) {
      return parts[y].allotted - parts[x].allotted;
    });
    for (var k = 0; k < order.length; k++) {
      var i = order[k];
      var pa = parts[i].earned;
      var pb = ((b.parts || [])[i] || {}).earned || 0;
      if (pa !== pb) return { diff: pb - pa, by: "item", field: parts[i].field };
    }

    if (a.legacy !== b.legacy) return { diff: b.legacy - a.legacy, by: "legacy" };
    return { diff: String(a.team).localeCompare(String(b.team), "ko"), by: "name" };
  }

  /* bidders = [{ team, state, allocation, policyId }]
     반환   = { winners: [조 이름], ranking: [...], tieBreak: {...}|null }
     조건(when)을 넘긴 조만 후보입니다. */
  function awardLimited(entry, bidders) {
    var offer = entry.offer;
    /* 응찰 조건이 걸린 투자 항목 — 누적 실적을 여기서 봅니다 */
    var betField = String((entry.when && entry.when.field) || "").replace("invest.", "");

    var ranking = (bidders || []).map(function (b) {
      var ctx = { allocation: b.allocation || {}, policyId: b.policyId };
      return {
        team: b.team,
        qualified: testCondition(entry.when, b.state, ctx),
        score: bidScore(offer, b.state, b.allocation, b.policyId),
        /* 항목별 채점 — 진행자 화면이 평가표로 펼칩니다 */
        parts: bidBreakdown(offer, b.state, b.allocation, b.policyId),
        bet: (b.allocation || {})[betField] || 0,
        /* 이번 국면 전까지 이 분야에 넣어 온 누적액 */
        legacy: ((b.state && b.state.investTotals) || {})[betField] || 0
      };
    });
    ranking.sort(function (a, b) { return compareBids(a, b).diff; });

    var live = ranking.filter(function (r) { return r.qualified; });
    var winners = live.slice(0, offer.slots || 1).map(function (r) { return r.team; });

    /* 낙찰선에서 총점이 갈리지 않았다면, 무엇으로 갈랐는지 남깁니다 */
    var tieBreak = null;
    var cut = (offer.slots || 1) - 1;
    if (live.length > cut + 1 && live[cut].score === live[cut + 1].score) {
      var how = compareBids(live[cut], live[cut + 1]);
      tieBreak = {
        rule: how.by,
        label: TIE_RULES[how.by] || how.by,
        field: how.field || null,
        won: live[cut].team,
        lost: live[cut + 1].team
      };
    }

    return { id: offer.id, title: offer.title, winners: winners, ranking: ranking, tieBreak: tieBreak };
  }

  function computeCrowding(pickedRoles) {
    var counts = {};
    var total = pickedRoles.length || 1;
    pickedRoles.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    var out = {};
    Object.keys(counts).forEach(function (r) {
      out[r] = Math.max(0, (counts[r] - 1) / Math.max(1, total - 1));
    });
    return out;
  }

  /* ============================================================
     위기 감시 — 지금 이대로 국면을 넘기면 무엇이 터지는가

     조건부 사건(c_burnout 등)은 그 조의 상태 때문에만 터집니다. 그런데 지금까지는
     터진 뒤에야 빔에서 알게 됐습니다. 조는 "우리만 왜?" 를 결과로 배웠고,
     정작 손을 쓸 수 있었던 자원 배분 시점에는 아무 신호가 없었습니다.

     ★ 임계값을 여기 다시 적지 않습니다. events.js 의 trigger 를 그대로 읽습니다.
       숫자를 두 군데 적으면 반드시 어긋나고, 그때부터 화면이 거짓말을 합니다.
     ============================================================ */

  /* 임계의 85% 를 넘어서면 '주의'. 넘고 나서 알려주면 이미 늦습니다. */
  var WATCH_BAND = 0.85;

  /* 지표 하나를 임계선과 대보고 등급을 매깁니다.
     op 가 ">=" 면 클수록 나쁘고, "<" 면 작을수록 나쁩니다.
     ratio 는 1 을 넘으면 이미 선을 넘은 것 — 어느 위기가 더 급한지 이걸로 줄 세웁니다. */
  function gradeAgainst(cur, op, value) {
    var ratio;
    if (op === ">=" || op === ">") {
      ratio = value ? cur / value : 0;
    } else if (op === "<" || op === "<=") {
      ratio = cur ? value / cur : 2;
    } else {
      return null;                       // 숫자 비교가 아닌 조건은 감시하지 않습니다
    }
    if (ratio >= 1) return { level: "danger", ratio: ratio };
    if (ratio >= WATCH_BAND) return { level: "watch", ratio: ratio };
    return null;
  }

  /* opts: { allowConditional, cash, plannedBudget }
     allowConditional 이 false 인 국면(1국면)에는 조건부 사건이 아예 안 터지므로
     사건 경고도 내지 않습니다. 자금 경색은 사건이 아니라 늘 봅니다. */
  function riskWatch(s, opts) {
    opts = opts || {};
    var out = [];
    /* 조건부 사건의 trigger 는 전부 상태값(quality·fatigue·rigidity·idleRate)만 봅니다.
       invest.* / policy 는 쓰지 않으므로 빈 ctx 로 충분합니다. */
    var ctx = { allocation: {}, policyId: null };

    if (opts.allowConditional) {
      Object.keys(window.DRB_EVENTS).forEach(function (key) {
        var ev = window.DRB_EVENTS[key];
        if (!ev.conditional || !ev.trigger) return;
        /* ★ 직전 국면에 터진 사건은 이번 국면에 터질 수 없습니다 (runSubround 6-2).
             그래도 경고를 띄우면 오지 않는 일로 겁을 주는 셈이라 건너뜁니다. */
        if (ev.id === s.lastConditional) return;

        var cur = readField(ev.trigger.field, s, ctx);
        var grade = gradeAgainst(cur, ev.trigger.op, ev.trigger.value);
        if (!grade) return;
        out.push({
          id: ev.id,
          title: ev.title,
          level: grade.level,
          ratio: grade.ratio,
          field: ev.trigger.field,
          op: ev.trigger.op,
          current: Math.round(cur * 100) / 100,
          threshold: ev.trigger.value,
          /* 무엇을 하면 덜 맞는지 — 화면에서 읽을 수 있게 조건을 그대로 넘깁니다 */
          reactions: (ev.reactions || []).map(function (r) { return r.when; }).filter(Boolean)
        });
      });
    }

    /* 자금 경색 — 사건이 아니라 예산 계산에서 나옵니다.
       현금이 이번 국면 예산보다 적으면 예산이 그만큼 깎입니다 (state.js budget()). */
    var planned = Number(opts.plannedBudget) || 0;
    if (planned > 0) {
      var cashGrade = gradeAgainst(Number(opts.cash) || 0, "<", planned);
      if (cashGrade) {
        out.push({
          id: "cash_squeeze",
          title: "자금 경색",
          level: cashGrade.level,
          ratio: cashGrade.ratio,
          field: "cash",
          op: "<",
          current: Math.round((Number(opts.cash) || 0) * 10) / 10,
          threshold: planned,
          reactions: []
        });
      }
    }

    /* 급한 것부터 — 위험이 주의보다 먼저, 같은 등급이면 선을 더 많이 넘은 것부터 */
    return out.sort(function (a, b) {
      if (a.level !== b.level) return a.level === "danger" ? -1 : 1;
      return b.ratio - a.ratio;
    });
  }

  /* ============================================================
     투자 성향 요약 (최종 화면 / 진행자 화면용)
     ============================================================ */
  function summarizeInvestments(state) {
    var totals = state.investTotals || {};
    var sum = 0;
    Object.keys(totals).forEach(function (k) { sum += totals[k]; });
    return Object.keys(totals)
      .map(function (k) {
        return { id: k, amount: totals[k], share: sum ? Math.round(totals[k] / sum * 100) : 0 };
      })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  return {
    createState: createState,
    runSubround: runSubround,
    judgeStyle: judgeStyle,
    styleScores: styleScores,
    summarizeInvestments: summarizeInvestments,
    adaptiveCapacity: adaptiveCapacity,
    riskWatch: riskWatch,
    stars: stars,
    computeCrowding: computeCrowding,
    limitedOffers: limitedOffers, awardLimited: awardLimited,
    bidScore: bidScore, bidBreakdown: bidBreakdown,
    testCondition: testCondition,
    clamp: clamp
  };
})();
