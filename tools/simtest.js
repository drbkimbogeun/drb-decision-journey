/* ============================================================
   simtest.js — 시뮬레이션 엔진 검증용 (교육 당일에는 쓰지 않습니다)

   실행 :  node tools/simtest.js
   목적 :
     - 서로 다른 전략을 쓴 4개 조가 정말 다른 회사가 되는지
     - 어느 한 전략이 항상 이기지는 않는지
     - 숫자가 터무니없이 튀지 않는지
   를 확인합니다. 데이터를 고친 뒤 이 파일을 돌려보면 균형을 빠르게 볼 수 있습니다.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const sandbox = { window: {}, console, localStorage: null };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

["data/config.js", "data/eras.js", "data/investments.js", "data/policies.js",
 "data/events.js", "data/rounds.js", "data/actual_drb.js", "data/whatif.js", "js/engine.js"
].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
});

const W = sandbox.window;
const Engine = W.DRBEngine;
const CFG = W.DRB_CONFIG;

/* ---------- 전략 정의 (조마다 다른 성향) ---------- */
const STRATEGIES = {
  "1조 소비재·규모형": {
    era1: { consumer: 20, facility: 20, people: 10 },
    era2: { beltExpand: 30, facility: 30, quality: 20 },
    era3: { smartFactory: 40, autoPartsX: 0, customerLock: 20, cash: 20 },
    policy: { era1: "growth", era2: "growth", era3: "transform" },
    where: "china", how: "plant"
  },
  "2조 기술집중형": {
    era1: { belt: 30, people: 20 },
    era2: { rnd: 40, quality: 20, people: 20 },
    era3: { aiRnd: 40, newMaterial: 20, esg: 20 },
    policy: { era1: "techfirst", era2: "techfirst", era3: "techLead" },
    where: "eu", how: "sales"
  },
  "3조 품질·고객형": {
    era1: { quality: 20, consumer: 20, people: 10 },
    era2: { quality: 30, beltExpand: 20, people: 30 },
    era3: { esg: 30, customerLock: 30, talent: 20 },
    policy: { era1: "customer", era2: "customer", era3: "talent" },
    where: "na", how: "sales"
  },
  "4조 안정보수형": {
    era1: { cash: 30, facility: 10, quality: 10 },
    era2: { cash: 30, beltExpand: 20, quality: 30 },
    era3: { cash: 40, pilot: 20, smartFactory: 20 },
    policy: { era1: "stable", era2: "focus", era3: "optionality" },
    where: "sea", how: "export"
  },
  "5조 미래베팅형": {
    era1: { belt: 40, facility: 10 },
    era2: { auto: 40, globalPlant: 30, people: 10 },
    era3: { mobility: 30, globalReshape: 30, newMaterial: 20 },
    policy: { era1: "growth", era2: "globalFirst", era3: "transform" },
    where: "sea", how: "jv"
  }
};

function budgetFor(sub, cash) {
  if (cash >= sub.budget) return sub.budget;
  return Math.max(CFG.tokenUnit, Math.floor(Math.max(0, cash) / CFG.tokenUnit) * CFG.tokenUnit);
}

function play(name, strat, log) {
  let state = Engine.createState();
  let prevPolicy = null;
  let turn = 0;
  const rows = [];

  W.DRB_ROUNDS.forEach(round => {
    const era = W.DRB_ERAS[round.era];
    const investments = W.DRB_INVESTMENTS[era.investSet];
    const policies = W.DRB_POLICIES[era.policySet];

    round.subrounds.forEach(sub => {
      const budget = budgetFor(sub, state.cash);

      /* 전략표대로 배분하되, 예산을 넘으면 비례 축소하고 남으면 현금으로 */
      const want = strat[era.id] || {};
      const alloc = {};
      let sum = 0;
      Object.keys(want).forEach(k => {
        const unit = CFG.tokenUnit;
        let v = Math.floor(want[k] / unit) * unit;
        if (sum + v > budget) v = Math.max(0, Math.floor((budget - sum) / unit) * unit);
        if (v > 0) { alloc[k] = v; sum += v; }
      });
      const cashItem = investments.find(i => i.keepCash);
      if (budget - sum > 0 && cashItem) alloc[cashItem.id] = (alloc[cashItem.id] || 0) + (budget - sum);

      const policyId = strat.policy[era.id];
      const policy = policies.find(p => p.id === policyId);
      if (!policy) throw new Error(`${name}: ${era.id} 에 없는 정책 '${policyId}'`);

      const choices = {};
      investments.forEach(i => {
        if (i.dimensions && alloc[i.id]) choices[i.id] = { where: strat.where, how: strat.how };
      });

      const out = Engine.runSubround({
        state, era, investments, policy, policyId,
        prevPolicyId: prevPolicy, allocation: alloc, choices,
        subround: sub, turnIndex: turn, crowding: 0.3
      });

      state = out.state;
      prevPolicy = policyId;
      turn++;

      rows.push({
        turn: `R${round.no}-${sub.id.slice(-1)}`,
        budget,
        alloc: Object.entries(alloc).map(([k, v]) => `${k}:${v}`).join(" "),
        revenue: out.report.kpi.revenue,
        profit: out.report.kpi.profit,
        util: out.report.kpi.utilization,
        fill: out.report.kpi.fillRate,
        cash: state.cash,
        events: out.report.events.map(e => e.title).join(" / ") || "-",
        headline: out.report.headline
      });
    });
  });

  if (log) {
    console.log(`\n══════ ${name} ══════`);
    rows.forEach(r => {
      console.log(
        `  ${r.turn} 예산${String(r.budget).padStart(3)} | ${r.alloc.padEnd(42)}` +
        ` 매출${String(r.revenue).padStart(6)} 손익${String(r.profit).padStart(7)}` +
        ` 가동${String(r.util).padStart(3)}% 납기${String(r.fill).padStart(3)}% 현금${String(r.cash).padStart(7)}`
      );
      if (r.events !== "-") console.log(`        └ 사건: ${r.events}`);
    });
  }

  return { name, state, rows, style: Engine.judgeStyle(state) };
}

/* ---------- 실행 ---------- */
console.log("=".repeat(110));
console.log("DRB 경영 시뮬레이션 — 엔진 검증");
console.log("=".repeat(110));

const results = Object.keys(STRATEGIES).map(n => play(n, STRATEGIES[n], true));

console.log("\n" + "=".repeat(110));
console.log("최종 비교");
console.log("=".repeat(110));
console.log(
  "조".padEnd(16) + "현금".padStart(9) + "생산".padStart(7) + "기술".padStart(7) +
  "품질".padStart(7) + "신뢰".padStart(7) + "유연".padStart(7) + "대응력".padStart(7) + "  스타일"
);
results.forEach(r => {
  const s = r.state;
  console.log(
    r.name.padEnd(16) +
    String(Math.round(s.cash)).padStart(9) +
    String(Math.round(s.capacity)).padStart(7) +
    String(Math.round(s.tech)).padStart(7) +
    String(Math.round(s.quality)).padStart(7) +
    String(Math.round(s.trust)).padStart(7) +
    String(Math.round(s.flex)).padStart(7) +
    String(Engine.adaptiveCapacity(s).score).padStart(7) +
    "  " + r.style.name
  );
});

/* ---------- 자동 점검 ---------- */
console.log("\n" + "=".repeat(110));
console.log("점검 결과");
console.log("=".repeat(110));

const problems = [];

/* 1. 팀별 결과가 실제로 갈라지는가 */
const keys = ["cash", "capacity", "tech", "quality", "trust", "flex"];
keys.forEach(k => {
  const vals = results.map(r => r.state[k]);
  const spread = Math.max(...vals) - Math.min(...vals);
  const ok = k === "cash" ? spread >= 25 : spread >= 12;
  console.log(`${ok ? "OK  " : "확인"} ${k} 편차 ${spread.toFixed(1)}`);
  if (!ok) problems.push(`${k} 지표에서 조별 차이가 거의 없습니다 (편차 ${spread.toFixed(1)})`);
});

/* 2. 스타일이 서로 다른가 */
const styles = new Set(results.map(r => r.style.id));
console.log(`${styles.size >= 3 ? "OK  " : "확인"} 서로 다른 경영스타일 ${styles.size}종`);
if (styles.size < 3) problems.push("조별 경영스타일이 충분히 갈라지지 않습니다");

/* 3. 숫자가 정상 범위인가 */
results.forEach(r => {
  r.rows.forEach(row => {
    if (!isFinite(row.revenue) || !isFinite(row.profit)) {
      problems.push(`${r.name} ${row.turn}: 숫자가 NaN/Infinity 입니다`);
    }
    if (row.revenue < 0) problems.push(`${r.name} ${row.turn}: 매출이 음수입니다`);
  });
  ["capacity", "tech", "quality", "trust", "people"].forEach(k => {
    if (r.state[k] < 0 || r.state[k] > 100) {
      problems.push(`${r.name}: ${k} 가 0~100 범위를 벗어났습니다 (${r.state[k]})`);
    }
  });
});
console.log(`${problems.filter(p => p.includes("NaN") || p.includes("범위")).length === 0 ? "OK  " : "확인"} 수치 범위`);

/* 4. 한 전략이 모든 지표를 독식하지 않는가 */
const winners = {};
keys.forEach(k => {
  const best = results.reduce((a, b) => (a.state[k] >= b.state[k] ? a : b));
  winners[k] = best.name;
});
const uniqueWinners = new Set(Object.values(winners));
console.log(`${uniqueWinners.size >= 2 ? "OK  " : "확인"} 지표별 1위가 ${uniqueWinners.size}개 조로 갈림`);
Object.keys(winners).forEach(k => console.log(`       ${k} 1위 → ${winners[k]}`));
if (uniqueWinners.size < 2) problems.push("한 조가 모든 지표에서 1위입니다 (정답 전략이 존재)");

console.log("\n" + (problems.length ? "발견된 문제:\n - " + problems.join("\n - ") : "문제 없음"));
console.log("");
