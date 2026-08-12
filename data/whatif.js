/* ============================================================
   whatif.js — "다른 선택을 했다면 어떤 회사가 되었을까"

   게임이 끝난 뒤, 우리 조가 실제로 걸어온 길과
   아래 대안 전략들을 같은 시뮬레이션 엔진으로 6국면 돌려 비교합니다.

   ★ 중요 : 이 비교는 총점이나 순위를 매기지 않습니다.
     전략마다 '얻는 것'과 '포기하는 것'이 다르다는 것만 보여줍니다.

   ★ 이 값은 AI가 만드는 것이 아니라 engine.js 가 실제로 계산합니다.
     따라서 데이터(투자효과·시대환경)를 바꾸면 이 표도 함께 바뀝니다.

   plan 쓰는 법
     시대별로 { 투자항목id: 비중 } 을 적습니다.
     비중의 합이 1이 되지 않아도 됩니다 — 예산에 맞춰 자동으로 나눠 씁니다.
   ============================================================ */

window.DRB_WHATIF = [
  {
    id: "focus",
    name: "기존사업 집중",
    desc: "잘하는 것 하나만 끝까지 판다",
    plan: {
      era1: { belt: 0.35, facility: 0.25, quality: 0.20, people: 0.20 },
      era2: { beltExpand: 0.40, facility: 0.25, quality: 0.20, people: 0.15 },
      era3: { beltTech: 0.40, automation: 0.25, lab: 0.20, cash: 0.15 }
    },
    policy: { era1: "efficiency", era2: "focus", era3: "deepen" }
  },
  {
    id: "aggressive",
    name: "공격적 신사업",
    desc: "새로운 영역으로 계속 넓힌다",
    plan: {
      era1: { consumer: 0.30, belt: 0.30, facility: 0.25, people: 0.15 },
      era2: { auto: 0.40, export: 0.25, facility: 0.20, people: 0.15 },
      era3: { newbiz: 0.35, autoParts: 0.30, overseas: 0.20, people: 0.15 }
    },
    policy: { era1: "growth", era2: "growth", era3: "expand" }
  },
  {
    id: "export",
    name: "수출·해외 집중",
    desc: "국내보다 바깥에서 답을 찾는다",
    plan: {
      era1: { consumer: 0.35, facility: 0.30, quality: 0.20, people: 0.15 },
      era2: { export: 0.40, facility: 0.25, quality: 0.20, people: 0.15 },
      era3: { overseas: 0.35, automation: 0.25, beltTech: 0.25, cash: 0.15 }
    },
    policy: { era1: "growth", era2: "customer", era3: "expand" }
  },
  {
    id: "techquality",
    name: "기술·품질 집중",
    desc: "당장 못 벌어도 만들 수 있는 능력을 먼저 쌓는다",
    plan: {
      era1: { tech: 0.35, quality: 0.30, people: 0.25, facility: 0.10 },
      era2: { rnd: 0.35, quality: 0.30, people: 0.20, facility: 0.15 },
      era3: { lab: 0.35, beltTech: 0.30, automation: 0.20, people: 0.15 }
    },
    policy: { era1: "techfirst", era2: "techfirst", era3: "techfirst" }
  },
  {
    id: "cautious",
    name: "현금 우선 · 신중경영",
    desc: "무리하지 않고 버틸 힘을 남긴다",
    plan: {
      era1: { cash: 0.40, facility: 0.25, quality: 0.20, people: 0.15 },
      era2: { cash: 0.35, beltExpand: 0.25, facility: 0.25, quality: 0.15 },
      era3: { cash: 0.35, beltTech: 0.25, automation: 0.25, people: 0.15 }
    },
    policy: { era1: "stable", era2: "focus", era3: "stable" }
  }
];

/* ------------------------------------------------------------
   비교표에 쓸 축.
   각 축이 회사 상태의 어떤 값으로 계산되는지 정의합니다.
   high / mid 기준값을 넘으면 '높음' / '보통' 으로 표시됩니다.
   ------------------------------------------------------------ */
window.DRB_WHATIF_AXES = [
  {
    key: "growth", name: "성장",
    calc: function (s) { return s.capacity + s.demandBonus; },
    mid: 70, high: 100
  },
  {
    key: "stability", name: "안정성",
    calc: function (s) { return (100 - s.fatigue) * 0.5 + s.trust * 0.5; },
    mid: 45, high: 62
  },
  {
    key: "tech", name: "기술축적",
    calc: function (s) { return s.tech; },
    mid: 45, high: 65
  },
  {
    key: "cash", name: "현금",
    calc: function (s) { return s.cash; },
    mid: 60, high: 140
  },
  {
    key: "options", name: "향후 선택권",
    calc: function (s) { return s.tech * 0.4 + s.demandBonus * 0.8 + Math.max(0, s.cash) * 0.15; },
    mid: 40, high: 62
  },
  {
    key: "adaptive", name: "변화 대응력",
    calc: function (s) { return window.DRBEngine.adaptiveCapacity(s).score; },
    mid: 38, high: 55
  }
];
