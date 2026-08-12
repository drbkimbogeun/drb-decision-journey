/* ============================================================
   global.js — 해외 진출 (어디에 / 어떤 방식으로 / 얼마나)

   ERA 4(2000~2015)부터 열립니다.
   "해외에 투자한다"로 끝내지 않고 세 가지를 함께 정하게 합니다.

     무엇을?   → investments.js 의 글로벌 항목을 고른다
     얼마나?   → 토큰을 몇 개 넣는가
     어디에?   → countries
     어떤 방식으로? → modes

   같은 금액이라도 어느 나라에 어떤 방식으로 넣었느냐에 따라
   원가·수요·위험·완성까지 걸리는 시간이 전부 달라집니다.
   ============================================================ */

window.DRB_GLOBAL = {

  /* ---------- 어디에 ---------- */
  countries: [
    {
      id: "china",
      name: "중국",
      short: "CN",
      desc: "거대한 시장이자 거대한 경쟁자입니다. 물량은 크지만 단가 싸움이 심합니다.",
      map: { x: 74, y: 40 },
      demandMult:     1.25,   // 수요 기반 확대 배수
      costMult:       0.80,   // 생산 원가 배수 (낮을수록 유리)
      competitionAdd: 0.12,   // 이 나라에 몰릴수록 경쟁강도 상승
      riskAdd:        0.05,
      note: "고객이 이미 많이 가 있습니다"
    },
    {
      id: "sea",
      name: "동남아",
      short: "SEA",
      desc: "원가는 가장 낮습니다. 다만 인프라와 숙련도가 아직 부족합니다.",
      map: { x: 76, y: 55 },
      demandMult:     0.95,
      costMult:       0.72,
      competitionAdd: 0.06,
      riskAdd:        0.10,
      note: "싸지만 손이 많이 갑니다"
    },
    {
      id: "na",
      name: "북미",
      short: "NA",
      desc: "단가를 제일 잘 쳐줍니다. 대신 요구 수준과 비용이 높습니다.",
      map: { x: 20, y: 36 },
      demandMult:     1.10,
      costMult:       1.20,
      competitionAdd: 0.08,
      riskAdd:        0.04,
      priceBonus:     0.10,
      note: "고객이 까다롭지만 값을 쳐줍니다"
    },
    {
      id: "eu",
      name: "유럽",
      short: "EU",
      desc: "기술 인증 장벽이 높습니다. 넘으면 오래가는 거래가 됩니다.",
      map: { x: 47, y: 30 },
      demandMult:     1.05,
      costMult:       1.15,
      competitionAdd: 0.07,
      riskAdd:        0.05,
      priceBonus:     0.12,
      techRequire:    8,      // 기술이 이만큼 더 필요합니다
      note: "기술이 모자라면 문을 못 엽니다"
    }
  ],

  /* ---------- 어떤 방식으로 ---------- */
  modes: [
    {
      id: "export",
      name: "수출",
      desc: "현지에 짓지 않고 내보냅니다. 가장 싸고 빠르지만 효과도 가장 작습니다.",
      costFactor:   0.40,     // 같은 토큰으로 이만큼만 씀 (나머지는 현금으로 남음)
      effectFactor: 0.45,
      delay:        0,        // 몇 턴 뒤 가동되는가
      exposure:     0.6,
      pros: ["즉시 시작", "위험 작음"],
      cons: ["효과가 작다", "환율에 그대로 노출"]
    },
    {
      id: "sales",
      name: "판매거점",
      desc: "현지에 사람을 둡니다. 고객을 직접 만나는 만큼 관계가 쌓입니다.",
      costFactor:   0.65,
      effectFactor: 0.70,
      delay:        1,
      exposure:     0.5,
      trustBonus:   2,
      pros: ["고객 관계 확보", "중간 위험"],
      cons: ["생산능력은 늘지 않는다"]
    },
    {
      id: "jv",
      name: "합작 (JV)",
      desc: "현지 파트너와 손을 잡습니다. 돈이 덜 들지만 우리 마음대로 할 수 없습니다.",
      costFactor:   0.70,
      effectFactor: 0.90,
      delay:        1,
      exposure:     0.4,
      controlPenalty: 0.15,   // 성과의 일부가 파트너 몫
      pros: ["적은 자본으로 빠르게", "현지 위험 분담"],
      cons: ["통제력이 약하다", "성과를 나눠 갖는다"]
    },
    {
      id: "plant",
      name: "직접 생산법인",
      desc: "직접 공장을 짓습니다. 가장 크고 가장 오래 걸리고 가장 무겁습니다.",
      costFactor:   1.00,
      effectFactor: 1.25,
      delay:        2,
      exposure:     0.8,
      rigidityAdd:  6,        // 경직성 — 나중에 방향을 바꾸기 어려워집니다
      pros: ["효과가 가장 크다", "원가 경쟁력 확보"],
      cons: ["가동까지 두 국면", "고정비·경직성 증가", "실패해도 접기 어렵다"]
    }
  ],

  /* ---------- 거점의 생애 ---------- */
  stages: [
    { id: "review",  name: "검토",     color: "var(--text-3)" },
    { id: "build",   name: "건설 중",  color: "var(--warn)" },
    { id: "running", name: "가동",     color: "var(--good)" },
    { id: "expand",  name: "확장",     color: "var(--info)" },
    { id: "shrink",  name: "축소",     color: "var(--bad)" }
  ],

  /* 본국은 항상 있습니다 */
  home: { id: "kr", name: "한국", short: "KR", map: { x: 79, y: 37 } }
};
