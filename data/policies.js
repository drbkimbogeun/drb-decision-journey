/* ============================================================
   policies.js — 경영정책

   ★ 정책은 '보너스'가 아니라 '성향'입니다.
     반드시 pros(장점)와 cons(대가)를 함께 갖게 하세요.
     정책을 자주 바꾸면 조직이 흔들리도록 페널티가 걸립니다.
     (페널티 크기는 config.js의 engine.policyChangePenalty)

   mods 항목 의미
     investEff   투자 효율 배율        (1.0 = 기본)
     demandMult  수요 배율
     unitCost    원가 배율
     fixedCost   고정비 배율
     rdEff       R&D 축적 효율 배율
     qualityDrift 매 턴 품질 가감 (절대값)
     trustDrift   매 턴 고객신뢰 가감 (절대값)
     fatigueDrift 매 턴 조직피로도 가감 (절대값)
     shockMult   돌발상황 피해 배율 (낮을수록 잘 버팀)
   ============================================================ */

window.DRB_POLICIES = {

  /* ---------------------------------------------------------- */
  era1: [
    {
      id: "growth",
      name: "공격적 성장",
      pros: ["투자 효율 +15%", "수요 확보에 유리"],
      cons: ["현금이 빠르게 마름", "돌발상황에 취약"],
      mods: { investEff: 1.15, demandMult: 1.06, fixedCost: 1.08, shockMult: 1.30, fatigueDrift: 3 }
    },
    {
      id: "stable",
      name: "안정 경영",
      pros: ["돌발상황 피해 감소", "고정비 부담 완화"],
      cons: ["성장 속도가 느림", "투자 효율 -10%"],
      mods: { investEff: 0.90, demandMult: 0.96, fixedCost: 0.93, shockMult: 0.72, fatigueDrift: -2 }
    },
    {
      id: "techfirst",
      name: "기술 우선",
      pros: ["R&D 축적 효율 +30%", "기술이 단가를 지켜줌"],
      cons: ["단기 수익성 악화", "생산·영업이 뒷전"],
      mods: { rdEff: 1.30, unitCost: 1.05, demandMult: 0.97, investEff: 1.0 }
    },
    {
      id: "customer",
      name: "고객 우선",
      pros: ["고객신뢰가 매 턴 오름", "납기 사고 피해 감소"],
      cons: ["품질·서비스 비용 발생", "원가 상승"],
      mods: { trustDrift: 3, unitCost: 1.06, shockMult: 0.88 }
    },
    {
      id: "efficiency",
      name: "생산효율 우선",
      pros: ["원가 -8%", "같은 설비로 더 많이 생산"],
      cons: ["품질이 매 턴 깎임", "조직피로도 상승"],
      mods: { unitCost: 0.92, qualityDrift: -3, fatigueDrift: 5, demandMult: 1.02 }
    }
  ],

  /* ---------------------------------------------------------- */
  era2: [
    {
      id: "growth",
      name: "공격적 확장",
      pros: ["투자 효율 +18%", "수요 +8%"],
      cons: ["현금 소진 가속", "불황이 오면 크게 흔들림"],
      mods: { investEff: 1.18, demandMult: 1.08, fixedCost: 1.10, shockMult: 1.35, fatigueDrift: 4 }
    },
    {
      id: "focus",
      name: "본업 집중",
      pros: ["원가 -6%", "조직이 흔들리지 않음"],
      cons: ["신규사업·해외 투자 효율 -20%", "성장 한계"],
      mods: { unitCost: 0.94, investEff: 0.95, shockMult: 0.80, fatigueDrift: -3, newFieldEff: 0.80 }
    },
    {
      id: "techfirst",
      name: "기술 우선",
      pros: ["R&D 축적 효율 +30%", "높아진 요구기술 대응"],
      cons: ["단기 수익성 악화"],
      mods: { rdEff: 1.30, unitCost: 1.05, demandMult: 0.97 }
    },
    {
      id: "talent",
      name: "인재 중심",
      pros: ["투자 효율 +10%", "조직피로도 감소"],
      cons: ["인건비(고정비) +12%"],
      mods: { investEff: 1.10, fixedCost: 1.12, fatigueDrift: -5, qualityDrift: 2 }
    },
    {
      id: "customer",
      name: "고객 우선",
      pros: ["고객신뢰가 매 국면 오름", "클레임 피해 감소"],
      cons: ["원가 +6%"],
      mods: { trustDrift: 3, unitCost: 1.06, shockMult: 0.85 }
    },
    {
      id: "globalFirst",
      name: "글로벌 우선",
      pros: ["해외·신사업 투자 효율 +25%", "수요 +8%"],
      cons: ["환율·현지 위험에 크게 노출", "국내 기반이 얇아짐"],
      mods: { newFieldEff: 1.25, demandMult: 1.08, shockMult: 1.30, investEff: 1.05, fatigueDrift: 3 }
    }
  ],

  /* ----------------------------------------------------------
     ERA 3 · 전환기 — "얼마나 빨리 움직일 것인가"와
     "얼마나 남겨둘 것인가"의 싸움입니다.
     ---------------------------------------------------------- */
  era3: [
    {
      id: "transform",
      name: "빠른 전환",
      pros: ["투자 효율 +20%", "경직성 감소", "수요 +8%"],
      cons: ["현금 소진 가속", "잘못 걸면 크게 흔들림"],
      mods: { investEff: 1.20, demandMult: 1.08, rigidityDrift: -4, shockMult: 1.35, fatigueDrift: 5 }
    },
    {
      id: "focusCore",
      name: "핵심 집중",
      pros: ["원가 -7%", "충격에 강함"],
      cons: ["신사업·해외 효율 -25%", "새 시장이 열리지 않음"],
      mods: { unitCost: 0.93, newFieldEff: 0.75, shockMult: 0.75, demandMult: 0.96 }
    },
    {
      id: "techLead",
      name: "기술 선도",
      pros: ["R&D 축적 효율 +35%", "높아진 요구기술 대응"],
      cons: ["단기 수익성 악화", "현금 압박"],
      mods: { rdEff: 1.35, unitCost: 1.06, demandMult: 0.96 }
    },
    {
      id: "talent",
      name: "인재 중심",
      pros: ["투자 효율 +12%", "조직피로 크게 감소", "품질 유지"],
      cons: ["인건비(고정비) +16%"],
      mods: { investEff: 1.12, fixedCost: 1.16, fatigueDrift: -7, qualityDrift: 2 }
    },
    {
      id: "optionality",
      name: "선택지 유지",
      pros: ["유연성이 매 국면 오름", "경직성 감소", "충격 피해 -35%"],
      cons: ["성장 속도 감소", "투자 효율 -12%"],
      mods: { flexDrift: 5, rigidityDrift: -5, shockMult: 0.65, demandMult: 0.94, investEff: 0.88 }
    },
    {
      id: "stable",
      name: "안정 경영",
      pros: ["돌발상황 피해 -30%", "고정비 -8%"],
      cons: ["성장 속도 감소", "투자 효율 -10%"],
      mods: { investEff: 0.90, demandMult: 0.95, fixedCost: 0.92, shockMult: 0.70, fatigueDrift: -3 }
    }
  ]
};
