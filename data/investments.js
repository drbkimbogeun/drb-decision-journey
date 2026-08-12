/* ============================================================
   investments.js — 시대별 투자 영역  ·  3개 시대

   투자 1(토큰 0.1개)당 효과를 perUnit 에 적습니다.
     now   : 이번 국면 즉시 반영
     next  : 다음 국면에 반영 (설비처럼 시간이 걸리는 것)
     later : 두 국면 뒤에 반영 (새 사업처럼 오래 걸리는 것)
     stock : 누적되어 임계를 넘을 때 터지는 것 (R&D)
     mult  : 이번 국면 계산에만 쓰이는 배율 (원가·수요 등)

   dimensions: ["where","how"]  ← 있으면 '어디에 / 어떤 방식으로' 선택이 열립니다

   ★ 어떤 투자도 장점만 갖지 않게 합니다. tradeoffs에 대가를 반드시 적으세요.
     type — plus(즉시 좋음) / minus(대가) / later(시간이 걸림)

   ⚠ 그 시대에 실제로 가능했던 수단만 넣습니다.
     1950년대에 스마트팩토리·해외법인 같은 선택지가 나오면 안 됩니다.

   role — 경쟁사 AI가 성격을 판단할 때 쓰는 태그
     capacity 생산 / quality 품질 / tech 기술 / demand 판로
     future 새 사업 / people 인력 / flex 유연성 / cash 현금
   ============================================================ */

window.DRB_INVESTMENTS = {

  /* ==========================================================
     ERA 1 — 창업기 : 무엇을 만들 것인가
     핵심 갈등 = 지금 팔리는 소비재 vs 아직 시장이 없는 산업재
     ========================================================== */
  era1: [
    {
      id: "consumer",
      role: "demand",
      name: "고무신 · 운동화",
      desc: "지금 당장 팔리는 것을 만듭니다. 신을 것이 없는 시대라 만들면 팔립니다.",
      tradeoffs: [
        { type: "plus",  text: "이번 국면 수요 즉시 증가" },
        { type: "plus",  text: "판매망(거래처) 확대" },
        { type: "minus", text: "효과가 이번 국면으로 끝난다" },
        { type: "minus", text: "산업재 기술은 쌓이지 않는다" }
      ],
      perUnit: { mult: { demand: 0.011 }, now: { reach: 0.16 } }
    },
    {
      id: "belt",
      role: "future",
      newField: true,
      name: "전동벨트 · 컨베어벨트",
      desc: "공장 기계에 들어가는 벨트입니다. 지금 이 나라에는 쓸 공장이 거의 없습니다.",
      tradeoffs: [
        { type: "later", text: "두 국면 뒤 수요 기반이 크게 열림" },
        { type: "plus",  text: "산업 기술이 함께 축적됨 (이 시대의 유일한 기술 축적 경로)" },
        { type: "minus", text: "지금은 팔 곳이 거의 없다" },
        { type: "minus", text: "산업화가 오지 않으면 헛돈이 된다" }
      ],
      perUnit: { later: { demandBonus: 0.46, capacity: 0.13 }, stock: { rdStock: 0.62 }, now: { tech: 0.04 } }
    },
    {
      id: "facility",
      role: "capacity",
      name: "생산설비",
      desc: "기계를 들여놓습니다. 지금 돈이 나가고, 물건은 다음 국면부터 더 나옵니다.",
      tradeoffs: [
        { type: "later", text: "다음 국면 생산능력 ↑↑" },
        { type: "minus", text: "고정비가 계속 늘어남" },
        { type: "minus", text: "수요가 없으면 설비가 논다" }
      ],
      perUnit: { next: { capacity: 0.55 }, later: { capacity: 0.15 } }
    },
    {
      id: "quality",
      role: "quality",
      name: "품질관리",
      desc: "불량을 줄입니다. 매출로 바로 오지 않지만, 없으면 반드시 사고가 납니다.",
      tradeoffs: [
        { type: "plus",  text: "품질 ↑" },
        { type: "later", text: "고객신뢰가 천천히 오름" },
        { type: "minus", text: "이번 국면 매출 증가 효과는 없다" }
      ],
      perUnit: { now: { quality: 0.48 }, next: { trust: 0.12 } }
    },
    {
      id: "people",
      role: "people",
      name: "숙련인력",
      desc: "사람을 뽑고 가르칩니다. 모든 투자의 실행 속도를 좌우합니다.",
      tradeoffs: [
        { type: "plus",  text: "인력 ↑ · 조직피로 ↓" },
        { type: "later", text: "다음 국면부터 투자효율 ↑" },
        { type: "minus", text: "인건비(고정비) 증가" }
      ],
      perUnit: { now: { people: 0.30, fatigue: -0.15 } }
    },
    {
      id: "cash",
      role: "cash",
      name: "현금 보유",
      desc: "쓰지 않고 남깁니다. 아무 일도 일어나지 않는 것이 이 선택의 목적입니다.",
      keepCash: true,
      tradeoffs: [
        { type: "plus",  text: "돌발상황 충격 완화" },
        { type: "plus",  text: "다음 국면 투자 여력 확보" },
        { type: "minus", text: "성장 기회를 놓칠 수 있다" }
      ],
      perUnit: { now: { shield: 0.006 } }
    }
  ],

  /* ==========================================================
     ERA 2 — 확장기 : 어디까지 넓힐 것인가
     핵심 갈등 = 확실한 본업 vs 자동차 vs 해외
     ========================================================== */
  era2: [
    {
      id: "beltExpand",
      role: "demand",
      name: "벨트 사업 확대",
      desc: "공장이 늘어난 만큼 벨트도 팔립니다. 지금 가장 확실한 사업입니다.",
      tradeoffs: [
        { type: "plus",  text: "판매망 확대 (지금 바로)" },
        { type: "later", text: "다음 국면 생산능력 ↑" },
        { type: "minus", text: "여기만 파면 시장이 커지는 만큼만 큰다" }
      ],
      perUnit: { now: { reach: 0.18 }, next: { capacity: 0.45 } }
    },
    {
      id: "auto",
      role: "future",
      newField: true,
      name: "자동차용 고무부품",
      desc: "자동차가 만들어지기 시작했습니다. 지금 물량은 적고 요구는 까다롭습니다.",
      tradeoffs: [
        { type: "later", text: "두 국면 뒤 새로운 수요 기반이 열림" },
        { type: "plus",  text: "까다로운 개발이라 기술이 쌓인다" },
        { type: "minus", text: "지금 당장은 돈이 되지 않는다" },
        { type: "minus", text: "개발 부담으로 조직피로 ↑" }
      ],
      perUnit: { later: { demandBonus: 0.50 }, next: { capacity: 0.15 },
                 stock: { rdStock: 0.42 }, now: { fatigue: 0.16 } }
    },
    {
      id: "globalPlant",
      role: "future",
      newField: true,
      name: "해외 진출",
      desc: "고객이 나가는 곳으로 따라갑니다. 어느 나라에 어떤 방식으로 갈지 함께 정합니다.",
      dimensions: ["where", "how"],
      tradeoffs: [
        { type: "later", text: "가동되면 수요기반·생산능력 ↑↑" },
        { type: "plus",  text: "현지 원가 경쟁력 확보" },
        { type: "minus", text: "완성까지 최대 두 국면" },
        { type: "minus", text: "환율·현지관리 위험에 노출" }
      ],
      perUnit: { now: { exposure: 0.45 } }
    },
    {
      id: "rnd",
      role: "tech",
      name: "연구개발",
      desc: "시장이 요구하는 기술수준이 올라갔습니다. 못 따라가면 단가가 무너집니다.",
      tradeoffs: [
        { type: "later", text: "축적되면 기술력이 도약" },
        { type: "plus",  text: "기술이 높으면 단가를 지킬 수 있다" },
        { type: "minus", text: "당장의 현금흐름이 나빠진다" }
      ],
      perUnit: { stock: { rdStock: 1.1 }, now: { tech: 0.05 } }
    },
    {
      id: "facility",
      role: "capacity",
      name: "생산설비 증설",
      desc: "늘어난 주문을 감당할 생산능력을 만듭니다.",
      tradeoffs: [
        { type: "later", text: "다음 국면 생산능력 ↑↑" },
        { type: "minus", text: "고정비 증가 · 불황이 오면 부담" },
        { type: "minus", text: "회사가 무거워져 방향 전환이 어려워짐" }
      ],
      perUnit: { next: { capacity: 0.52 }, later: { capacity: 0.14 }, now: { rigidity: 0.06 } }
    },
    {
      id: "quality",
      role: "quality",
      name: "품질체계",
      desc: "고객이 요구하는 수준이 올라갔습니다. 못 맞추면 거래가 끊깁니다.",
      tradeoffs: [
        { type: "plus",  text: "품질 ↑ · 단가를 지킬 수 있음" },
        { type: "later", text: "고객신뢰가 천천히 오름" },
        { type: "minus", text: "생산량은 늘지 않는다" }
      ],
      perUnit: { now: { quality: 0.45 }, next: { trust: 0.12 } }
    },
    {
      id: "people",
      role: "people",
      name: "인력·조직",
      desc: "커진 회사를 굴러가게 만듭니다. 눈에 띄지 않지만 없으면 흔들립니다.",
      tradeoffs: [
        { type: "plus",  text: "인력 ↑ · 조직피로 ↓↓" },
        { type: "later", text: "다음 국면부터 투자효율 ↑" },
        { type: "minus", text: "인건비 증가" }
      ],
      perUnit: { now: { people: 0.27, fatigue: -0.30 } }
    },
    {
      id: "cash",
      role: "cash",
      name: "현금 확보",
      desc: "확장을 미루고 현금을 지킵니다. 금융이 흔들릴 때는 이것이 전략입니다.",
      keepCash: true,
      tradeoffs: [
        { type: "plus",  text: "돌발상황 충격 완화" },
        { type: "plus",  text: "다음 국면 투자 여력 확보" },
        { type: "minus", text: "경쟁사에 기회를 내줄 수 있다" }
      ],
      perUnit: { now: { shield: 0.007 } }
    }
  ],

  /* ==========================================================
     ERA 3 — 전환기 : 얼마나 빨리 변화할 것인가
     핵심 갈등 = 하나에 크게 걸 것인가, 여러 개를 작게 열어둘 것인가
     ========================================================== */
  era3: [
    {
      id: "smartFactory",
      role: "capacity",
      name: "스마트팩토리",
      desc: "공장을 데이터로 돌립니다. 눈에 보이는 성과가 가장 확실한 선택입니다.",
      tradeoffs: [
        { type: "plus",  text: "원가 ↓↓ · 품질 ↑ · 조직피로 ↓" },
        { type: "later", text: "다음 국면 생산능력 ↑" },
        { type: "minus", text: "설비가 무거워져 방향 전환이 어려워짐" }
      ],
      perUnit: { next: { capacity: 0.34 }, now: { quality: 0.24, fatigue: -0.20, rigidity: 0.10 },
                 mult: { unitCost: -0.009 } }
    },
    {
      id: "mobility",
      role: "future",
      newField: true,
      name: "모빌리티 전환 대응",
      desc: "자동차가 전기로 바뀝니다. 언제, 얼마나 바뀔지는 전망이 엇갈립니다.",
      tradeoffs: [
        { type: "later", text: "맞으면 두 국면 뒤 수요기반 크게 확대" },
        { type: "plus",  text: "기술이 함께 쌓임" },
        { type: "minus", text: "전환이 늦어지면 회수가 늦다" },
        { type: "minus", text: "조직피로 ↑" }
      ],
      perUnit: { later: { demandBonus: 0.52 }, stock: { rdStock: 0.40 }, now: { fatigue: 0.18 } }
    },
    {
      id: "newMaterial",
      role: "tech",
      newField: true,
      name: "신소재 · 친환경",
      desc: "규제와 고객 요구가 함께 움직입니다. 먼저 준비한 곳이 가져갑니다.",
      tradeoffs: [
        { type: "later", text: "수요기반 확대 + 단가 방어" },
        { type: "plus",  text: "기술옵션 확보" },
        { type: "minus", text: "규제 시기가 불확실해 헛돈이 될 수 있다" }
      ],
      perUnit: { later: { demandBonus: 0.34 }, stock: { rdStock: 0.85 }, now: { tech: 0.05 } }
    },
    {
      id: "globalReshape",
      role: "demand",
      newField: true,
      name: "글로벌 공급망 재편",
      desc: "거점을 다시 짭니다. 어디에 어떤 방식으로 갈지 다시 정합니다.",
      dimensions: ["where", "how"],
      tradeoffs: [
        { type: "plus",  text: "유연성 ↑ · 충격 완화" },
        { type: "later", text: "가동되면 수요기반 확대" },
        { type: "minus", text: "이미 지은 것을 놔둔 채 또 짓는 부담" }
      ],
      perUnit: { now: { flex: 0.20, exposure: 0.35 } }
    },
    {
      id: "aiRnd",
      role: "tech",
      name: "AI · 데이터 기반 R&D",
      desc: "개발하는 방식 자체를 바꿉니다. 성과는 가장 늦게, 가장 크게 옵니다.",
      tradeoffs: [
        { type: "later", text: "R&D 축적 효율이 가장 높음" },
        { type: "plus",  text: "인력 수준도 함께 오름" },
        { type: "minus", text: "이번 국면 성과는 거의 없다" }
      ],
      perUnit: { stock: { rdStock: 1.30 }, now: { people: 0.14, quality: 0.06 } }
    },
    {
      id: "pilot",
      role: "flex",
      name: "신사업 Pilot (작게 여러 개)",
      desc: "크게 걸지 않고 작게 여러 개를 시험합니다. 대부분 실패하지만, 길이 열립니다.",
      tradeoffs: [
        { type: "plus",  text: "유연성 ↑↑ · 실험 경험 축적" },
        { type: "later", text: "변화 대응력의 핵심 요소" },
        { type: "minus", text: "당장의 매출은 거의 없다" }
      ],
      perUnit: { now: { flex: 0.34, experiments: 0.10, rigidity: -0.08 }, stock: { rdStock: 0.25 } }
    },
    {
      id: "talent",
      role: "people",
      name: "핵심 인재 확보",
      desc: "기술을 아는 사람을 붙잡고 새로 데려옵니다. 지금은 사람이 가장 비쌉니다.",
      tradeoffs: [
        { type: "plus",  text: "인력 ↑↑ · 조직피로 ↓" },
        { type: "later", text: "다음 국면 투자효율 ↑" },
        { type: "minus", text: "인건비(고정비) 크게 증가" }
      ],
      perUnit: { now: { people: 0.30, fatigue: -0.26 }, mult: { fixedCost: 0.004 } }
    },
    {
      id: "esg",
      role: "quality",
      name: "환경 · 안전 대응",
      desc: "규제와 고객 심사가 함께 강해집니다. 못 맞추면 입찰 자격을 잃습니다.",
      tradeoffs: [
        { type: "plus",  text: "품질 ↑ · 고객신뢰 ↑" },
        { type: "later", text: "규제가 강해질 때 자격을 지킴" },
        { type: "minus", text: "매출로 바로 돌아오지 않는다" }
      ],
      perUnit: { now: { quality: 0.26, trust: 0.14 }, mult: { unitCost: 0.003 } }
    },
    {
      id: "customerLock",
      role: "demand",
      name: "고객 공동개발",
      desc: "고객의 다음 제품에 우리 부품을 넣습니다. 한번 들어가면 오래 갑니다.",
      tradeoffs: [
        { type: "plus",  text: "고객신뢰 ↑↑ · 판매망 ↑" },
        { type: "later", text: "다음 국면 수요기반 확대" },
        { type: "minus", text: "그 고객에 묶여 경직성 ↑" }
      ],
      perUnit: { now: { trust: 0.28, reach: 0.16, rigidity: 0.06 }, next: { demandBonus: 0.22 } }
    },
    {
      id: "cash",
      role: "cash",
      name: "현금 확보",
      desc: "쓰지 않고 남깁니다. 무엇이 올지 모를 때 가장 강한 자산입니다.",
      keepCash: true,
      tradeoffs: [
        { type: "plus",  text: "충격 완화 ↑↑ · 다음 선택권 확보" },
        { type: "minus", text: "지금 아무 일도 일어나지 않는다" }
      ],
      perUnit: { now: { shield: 0.008 } }
    }
  ]
};
