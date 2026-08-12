/* ============================================================
   eras.js — 시대(산업환경) 데이터  ·  3개 시대 (1945 → 2026)

   ★★ 연도를 바꾸는 법 ★★
     실제 DRB 역사를 확인한 뒤에는 아래 세 곳만 고치면 됩니다.
       1) 이 파일의 yearLabel / span          (화면 상단에 뜨는 시대 이름)
       2) rounds.js 의 각 국면 year           (타임라인에 찍히는 연도)
       3) actual_drb.js 의 year               (실제 DRB 사례의 연도)
     게임 로직은 연도를 계산에 쓰지 않습니다. 마음 놓고 바꾸셔도 됩니다.

   ★ "시대가 갈수록 빨라진다"는 아래 값들로 표현됩니다.
       pace.yearsPerSubround  한 번의 결정이 담당하는 기간 (15년 → 7년)
       pace.discussSeconds    조별 토론 권장 시간 (5분 → 3분)
       visibility             전망 선명도 (85 → 30)
       briefing 항목 수       정보량 (10개 → 16개)

   ⚠ 아래 산업환경은 '그 시기 고무산업이 놓여 있던 일반적인 상황'입니다.
     DRB의 실제 연혁·실적이 아닙니다. 실제 DRB 자료는 actual_drb.js 에만.
   ============================================================ */

window.DRB_ERAS = {

  /* ==========================================================
     ERA 1 — 창업기 : 무엇을 만들 것인가
     ========================================================== */
  era1: {
    id: "era1",
    yearLabel: "1940~60년대",
    span: "1945 ~ 1978",
    name: "창업기 · 무엇을 만들 것인가",
    question: "고무라는 기술 기반을 가지고 있다면, 어디에 투자할 것인가?",

    pace: { yearsPerSubround: 18, discussSeconds: 300 },
    visibility: 85,
    visibilityNote: "산업의 방향이 단순합니다. 멀리 보고 크게 결정할 수 있습니다.",

    narrative:
      "우리에게 있는 것은 고무를 다루는 기술과 기계 몇 대뿐입니다.\n" +
      "이 고무로 신발을 만들 수도 있고, 공장 기계에 들어가는 벨트를 만들 수도 있습니다.\n\n" +
      "소비재는 내일부터 팔립니다. 산업재는 지금 살 사람이 거의 없습니다.\n" +
      "나라가 공장을 짓기 시작하면 이야기가 달라지겠지만, 그것은 아직 아무도 모릅니다.",

    briefing: {
      title: "1940s–60s INDUSTRY OUTLOOK",
      domestic: [
        { tone: "up",   text: "전후 복구 수요 — 생활 필수품 부족" },
        { tone: "up",   text: "정부의 제조업 육성 의지" },
        { tone: "flat", text: "국내 제조업 기반 거의 없음" },
        { tone: "q",    text: "산업용 설비 수요가 생길 것인가?" }
      ],
      global: [
        { tone: "up",   text: "선진국 산업용 고무제품 수요 확대" },
        { tone: "flat", text: "기술·장비는 대부분 수입 의존" }
      ],
      risk: [
        "자본이 매우 부족하다",
        "숙련 인력을 구하기 어렵다",
        "원료(생고무)를 전량 수입해야 한다",
        "산업재 시장은 아직 존재하지 않는다"
      ]
    },

    market: {
      demand: 100, priceIndex: 1.00, materialCost: 1.00, laborCost: 0.70,
      techRequirement: 28, competition: 0.18, interest: 1.00
    },

    display: [
      { name: "시장 수요",    value: "생활재 중심",  tone: "" },
      { name: "요구 기술수준", value: "낮음",        tone: "good" },
      { name: "경쟁 강도",    value: "약함",         tone: "good" },
      { name: "인건비",      value: "낮음",          tone: "good" },
      { name: "원재료",      value: "수입 의존",     tone: "bad" },
      { name: "자금 조달",    value: "매우 어려움",   tone: "bad" }
    ],

    investSet: "era1",
    policySet: "era1",
    globalEnabled: false
  },

  /* ==========================================================
     ERA 2 — 확장기 : 어디까지 넓힐 것인가
     (산업화 · 자동차 · 수출 · 해외진출 · 그리고 위기)
     ========================================================== */
  era2: {
    id: "era2",
    yearLabel: "1970~90년대",
    span: "1966 ~ 2004",
    name: "확장기 · 어디까지 넓힐 것인가",
    question: "확실한 오늘의 시장인가, 불확실한 내일의 시장인가?",

    pace: { yearsPerSubround: 15, discussSeconds: 240 },
    visibility: 58,
    visibilityNote: "선택지가 늘어난 만큼, 무엇을 포기할지가 더 어려워집니다.",

    narrative:
      "공장이 늘고 수출길이 열렸습니다. 벨트는 팔리고, 회사에 처음으로 여유가 생겼습니다.\n\n" +
      "그리고 자동차가 만들어지기 시작했습니다. 지금 물량은 우습게 작습니다.\n" +
      "고객들은 하나둘 바다 건너로 나가기 시작했습니다. 따라가지 않으면 물량을 잃습니다.\n\n" +
      "다만 금융환경은 언제 뒤집힐지 모릅니다. 넓히는 만큼 지킬 것도 늘어납니다.",

    briefing: {
      title: "1970s–90s INDUSTRY OUTLOOK",
      domestic: [
        { tone: "up",   text: "제조업 설비투자 급증 — 산업용 벨트 수요 확대" },
        { tone: "up",   text: "자동차산업 성장 — 고무부품 수요 증가" },
        { tone: "down", text: "인건비가 빠르게 오름" },
        { tone: "down", text: "고객 품질 요구 수준 상승" },
        { tone: "q",    text: "금융환경 불안 — 언제 뒤집힐지 알 수 없음" }
      ],
      global: [
        { tone: "up",   text: "수출 기회 확대 · 세계 자동차 보급 증가" },
        { tone: "up",   text: "고객사들의 해외 생산기지 이전 시작" },
        { tone: "down", text: "선진 업체와 기술격차 · 후발국 저가 공세" },
        { tone: "q",    text: "해외 생산이 유리해질 것인가?" }
      ],
      risk: [
        "개발기간이 길고 실패하면 회수할 수 없다",
        "해외 거점은 짓는 데 몇 년이 걸린다",
        "환율과 금리가 계산을 뒤집을 수 있다",
        "국내와 해외에 동시에 투자할 돈은 없다"
      ]
    },

    market: {
      demand: 138, priceIndex: 1.03, materialCost: 1.14, laborCost: 1.20,
      techRequirement: 52, competition: 0.40, interest: 1.20
    },

    display: [
      { name: "시장 수요",    value: "산업재·자동차",  tone: "good" },
      { name: "요구 기술수준", value: "상승",          tone: "" },
      { name: "경쟁 강도",    value: "심해지는 중",    tone: "bad" },
      { name: "인건비",      value: "빠르게 상승",     tone: "bad" },
      { name: "수출·해외",    value: "기회 열림",      tone: "good" },
      { name: "금융 환경",    value: "불안정",         tone: "bad" }
    ],

    investSet: "era2",
    policySet: "era2",
    globalEnabled: true          // ← 이 시대부터 '어디에 / 어떻게' 선택이 열립니다
  },

  /* ==========================================================
     ERA 3 — 전환기 : 얼마나 빨리 변화할 것인가  (2026에서 끝)
     ========================================================== */
  era3: {
    id: "era3",
    yearLabel: "2000~20년대",
    span: "2005 ~ 2026",
    name: "전환기 · 얼마나 빨리 변화할 것인가",
    question: "미래를 알 수 없는 상황에서 어디까지 투자하고, 무엇을 남겨둘 것인가?",

    pace: { yearsPerSubround: 8, discussSeconds: 180 },
    visibility: 30,
    visibilityNote: "전망이 서로 엇갈립니다. 하나를 맞히려 하기보다 여러 경우에 대비해야 합니다.",

    narrative:
      "모든 것이 동시에 움직입니다.\n" +
      "자동차는 전기로 바뀌고 있고, 공장은 데이터로 돌아가기 시작했습니다.\n" +
      "공급망은 몇 번이나 끊겼다 이어졌습니다.\n\n" +
      "새로운 기술이 매년 나오는데, 어느 것이 살아남을지는 아무도 모릅니다.\n" +
      "크게 걸면 크게 잃을 수 있고, 아무것도 안 하면 조용히 뒤처집니다.",

    briefing: {
      title: "2000s–20s INDUSTRY OUTLOOK",
      domestic: [
        { tone: "up",   text: "스마트팩토리·자동화 투자 확대" },
        { tone: "q",    text: "전기차 전환 속도 — 전망 엇갈림" },
        { tone: "down", text: "인건비·에너지 비용 상승" },
        { tone: "q",    text: "친환경 규제 강화 — 시기와 강도 불확실" },
        { tone: "up",   text: "고부가 소재 수요 증가" },
        { tone: "q",    text: "숙련 인력 확보 경쟁" }
      ],
      global: [
        { tone: "q",    text: "글로벌 공급망 재편 진행 중 — 방향 불명확" },
        { tone: "up",   text: "AI·데이터 기반 제조 확산" },
        { tone: "down", text: "지역 블록화 · 보호무역 강화" },
        { tone: "q",    text: "모빌리티 산업 경계 붕괴 — 승자 불명확" },
        { tone: "up",   text: "신소재 시장 성장 가능성 높음" }
      ],
      risk: [
        "정보는 많지만 어느 것이 중요한지 알 수 없다",
        "기술 하나에 크게 걸면 틀렸을 때 되돌릴 수 없다",
        "규모가 커진 만큼 방향을 바꾸는 데 시간이 걸린다",
        "경쟁사는 우리가 고민하는 동안에도 움직인다",
        "아무것도 하지 않는 것도 조용히 뒤처지는 선택이다"
      ]
    },

    market: {
      demand: 186, priceIndex: 1.00, materialCost: 1.30, laborCost: 1.60,
      techRequirement: 74, competition: 0.58, interest: 1.15
    },

    display: [
      { name: "시장 수요",    value: "고부가 전환",   tone: "" },
      { name: "요구 기술수준", value: "최고 수준",     tone: "bad" },
      { name: "전망 선명도",   value: "매우 낮음",     tone: "bad" },
      { name: "변화 속도",    value: "매우 빠름",     tone: "bad" },
      { name: "공급망",      value: "재편 중",        tone: "" },
      { name: "신기술 기회",  value: "많음 · 불확실",  tone: "" }
    ],

    investSet: "era3",
    policySet: "era3",
    globalEnabled: true,
    isFinal: true                // ← 2026. 이 시대 뒤에는 '결과'가 없습니다.
  }
};
