/* ============================================================
   rivals.js — AI가 운영하는 경쟁기업

   ★ 이 회사들은 배경 그림이 아닙니다. 참여 조와 똑같이
     같은 시대를 살고, 같은 시뮬레이션 엔진으로 계산됩니다.
     특혜도 없고, 무한 자원도 없습니다.

   ★ AI 경쟁사도 미래를 모릅니다.
     1970년의 경쟁사는 1990년에 무슨 일이 벌어질지 알 수 없습니다.
     경쟁사가 쓰는 정보는 '지금까지 공개된 것'뿐입니다.

   ★ 다만 경쟁사는 참여 조의 '공개된 움직임'은 봅니다.
     조들이 한 시장에 몰리면 경쟁사는 다른 길을 찾거나 정면으로 붙습니다.

   경쟁사 이름은 가상입니다. 실제 기업의 역사를 흉내내지 않습니다.
   (실제 기업의 검증된 선택은 competitors.js 에 따로 들어갑니다)

   bias 값 = 그 성향이 각 역할(role)을 얼마나 선호하는가 (1.0 = 보통)
     role : capacity 생산 / quality 품질 / tech 기술 / demand 판로
            future 새 사업 / people 인력 / flex 유연성 / cash 현금
   ============================================================ */

window.DRB_RIVALS = [
  {
    id: "alpha",
    name: "Alpha",
    fullName: "Competitor Alpha",
    type: "기술 선도형",
    desc: "남보다 먼저 새로운 것을 만듭니다. 자주 실패하지만, 한 번 맞으면 크게 앞서갑니다.",
    color: "#a78bfa",

    bias: { tech: 1.75, future: 1.55, quality: 1.05, capacity: 0.70, demand: 0.85, people: 1.10, flex: 1.05, cash: 0.55 },

    /* 성향에 따른 경영 습관 */
    traits: {
      aggression: 0.80,      // 예산을 얼마나 다 쓰는가 (1 = 전부)
      riskTolerance: 0.85,   // 불확실한 곳에 얼마나 넣는가
      followMarket: 0.30,    // 남들 가는 곳을 따라가는 정도 (낮으면 역발상)
      globalAppetite: 0.65
    },

    /* 시작 상태 — 참여 조와 같은 조건에서 출발합니다 */
    start: { cash: 100, capacity: 36, tech: 36, quality: 40, trust: 38, people: 52 }
  },

  {
    id: "beta",
    name: "Beta",
    fullName: "Competitor Beta",
    type: "규모 성장형",
    desc: "크게 짓고 싸게 만듭니다. 물량으로 밀어붙이지만, 시장이 꺾이면 그 무게가 짐이 됩니다.",
    color: "#7aa2f7",

    bias: { capacity: 1.80, demand: 1.30, tech: 0.65, quality: 0.75, future: 0.85, people: 0.90, flex: 0.60, cash: 0.60 },

    traits: {
      aggression: 0.95,
      riskTolerance: 0.60,
      followMarket: 0.75,    // 큰 시장이 보이면 바로 따라 들어감
      globalAppetite: 0.90
    },

    start: { cash: 100, capacity: 46, tech: 26, quality: 36, trust: 40, people: 48 }
  },

  {
    id: "gamma",
    name: "Gamma",
    fullName: "Competitor Gamma",
    type: "안정 경영형",
    desc: "무리하지 않습니다. 성장은 느리지만 위기에서 살아남고, 고객이 오래 남습니다.",
    color: "#4dd4c0",

    bias: { quality: 1.60, cash: 1.70, people: 1.25, demand: 1.00, capacity: 0.85, tech: 0.90, future: 0.45, flex: 1.30 },

    traits: {
      aggression: 0.62,
      riskTolerance: 0.30,
      followMarket: 0.45,
      globalAppetite: 0.40
    },

    start: { cash: 110, capacity: 38, tech: 28, quality: 46, trust: 46, people: 50 }
  }
];

/* ------------------------------------------------------------
   경쟁사가 고르는 정책 — 성향별로 시대마다 어느 정책을 쓰는지.
   해당 시대에 그 정책이 없으면 첫 번째 정책을 씁니다.
   ------------------------------------------------------------ */
window.DRB_RIVAL_POLICIES = {
  alpha: { era1: "techfirst", era2: "techfirst", era3: "techLead" },
  beta:  { era1: "growth",    era2: "globalFirst", era3: "transform" },
  gamma: { era1: "stable",    era2: "focus",     era3: "optionality" }
};

/* ------------------------------------------------------------
   경쟁사의 움직임을 한 줄로 설명할 때 쓰는 문구.
   타임랩스와 진행자 화면에 그대로 표시됩니다.
   role 별로 하나씩. 시대를 타지 않는 표현으로 씁니다.
   ------------------------------------------------------------ */
window.DRB_RIVAL_MOVES = {
  capacity: ["생산설비 증설", "공장 라인 추가", "생산능력 확대"],
  quality:  ["품질관리 강화", "불량률 개선 프로그램", "품질 인증 취득"],
  tech:     ["연구개발 확대", "기술 인력 충원", "신기술 개발 착수"],
  demand:   ["거래처 확대", "판매망 정비", "신규 고객 확보"],
  future:   ["신규 사업 진입", "새로운 분야 시험", "차세대 제품 개발 착수"],
  people:   ["인력 충원", "숙련공 양성", "조직 개편"],
  flex:     ["공급망 다변화", "조달선 이원화", "생산 유연화"],
  cash:     ["투자 속도 조절", "현금 확보", "재무구조 정비"],
  global:   ["해외 거점 검토", "현지 법인 설립", "해외 고객 개발"]
};
