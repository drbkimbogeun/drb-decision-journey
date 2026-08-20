/* ============================================================
   events.js — 돌발상황

   ⚠⚠ 여기 있는 사건은 전부 '만들어낸 상황'입니다. DRB의 실제 기록이 아닙니다. ⚠⚠

     그 시대 고무·부품 업계가 흔히 겪던 일을 판단 연습용으로 재구성한 것입니다.
     연도도 국면 구성에 맞춘 것이지 그 해에 DRB에 그 일이 있었다는 뜻이 아닙니다.
     실제 DRB의 사건·연도는 actual_drb.js 에만 들어갑니다. 그 파일만 사실입니다.

     ★ 실제 연표와 헷갈릴 만한 사건에는 factNote 를 답니다.
       진행자 화면에 그 한 줄이 같이 떠서, 방 전체가 무엇이 사실이고
       무엇이 가정인지 그 자리에서 알게 됩니다.
       (예: 자동차 공동개발 — 실제는 1967년 현대자동차, 게임은 1986년 입찰)

   ★ 핵심 원칙 : 같은 사건이라도 팀마다 결과가 달라야 합니다.
     base      = 모든 팀에 공통으로 오는 충격
     reactions = 팀의 상태·투자 이력에 따라 그 팀에만 추가로 붙는 반응
                 (조건을 만족한 팀에게만 적용되고, 화면에도 이유가 표시됩니다)

   ★ headline 은 '시간 진행' 중에 뉴스 속보처럼 뜨는 한 줄입니다.
     신문 헤드라인처럼 짧고 건조하게 쓰세요.

   조건(when) 쓰는 법
     { field: "trust",           op: ">=", value: 60 }   회사 상태값
     { field: "invest.quality",  op: ">=", value: 20 }   이번 국면 해당 항목 투자액
     { field: "total.belt",      op: ">=", value: 40 }   지금까지 누적 투자액
     { field: "sites",           op: ">=", value: 1  }   해외 거점 개수
     { field: "policy",          op: "==", value: "focus" }  현재 정책

   효과(mod) 쓰는 법
     mult  : 배율에 더해집니다 (unitCost +0.25 = 원가 25% 상승)
     delta : 지표를 직접 더하거나 뺍니다 (trust -8)

   ★★ 한 곳만 딸 수 있는 기회 (limited) ★★
     보통 반응은 조건을 넘긴 모든 조에게 붙습니다. 그런데 현실에는
     "한 회사만 계약한다" 는 기회가 있습니다 — 자동차 공동개발 파트너 같은.

     반응에 limited 를 달면 그 반응은 조건을 넘긴 조들끼리 경쟁이 됩니다.

       limited: {
         id:    "autoPartner",           고유 이름
         slots: 1,                       몇 곳까지 딸 수 있는가
         title: "자동차 공동개발 파트너",  화면에 뜨는 이름
         score: [                        누가 따는가 — 점수가 높은 곳
           { field: "invest.auto", weight: 1.0, max: 100 },
           { field: "tech",        weight: 0.5, max: 100 }
         ],
         lost: { text: "...", mod: {...} }   못 딴 조에게 붙는 것 (없어도 됩니다)
       }

     ⚠ 판정은 '모든 조가 확정한 뒤' 에 이뤄집니다. 그 전까지는 아무 효과도
       주지 않습니다 — 먼저 낸 조가 유리해지면 안 되기 때문입니다.
       진행자 화면이 판정해서 각 조에 알려줍니다 (라이브 세션).
       한 대로 여러 조를 돌리는 연습 모드에서는 마지막 조가 확정할 때 판정합니다.
   ============================================================ */

window.DRB_EVENTS = {

  /* ==========================================================
     ERA 1 — 창업기
     ========================================================== */
  e1_material: {
    id: "e1_material",
    title: "생고무 수입가 급등",
    headline: "국제 생고무 시세 급등 — 국내 고무업계 원가 비상",
    body: "원료를 전량 수입에 의존하는데, 국제 생고무 시세가 한 번에 뛰었습니다.\n" +
          "값을 올리자니 거래처가 등을 돌릴 것 같고, 안 올리자니 남는 게 없습니다.",
    base: { mult: { unitCost: 0.26 } },
    reactions: [
      {
        when: { field: "cash", op: ">=", value: 70 },
        text: "현금 여유가 있어 원료를 미리 확보해 두었습니다",
        mod: { mult: { unitCost: -0.10 } }
      },
      {
        when: { field: "trust", op: ">=", value: 55 },
        text: "거래처와의 신뢰가 있어 인상분 일부를 납품가에 반영했습니다",
        mod: { mult: { price: 0.07 } }
      },
      {
        when: { field: "total.belt", op: ">=", value: 20 },
        text: "산업용 벨트를 준비해 둔 덕에 산업화 초기 발주가 우리에게 왔습니다",
        mod: { mult: { demand: 0.12 }, delta: { trust: 4 } }
      },
      {
        when: { field: "cash", op: "<", value: 35 },
        text: "현금이 없어 급하게 비싼 값에 원료를 사들였습니다",
        mod: { mult: { unitCost: 0.08 }, delta: { fatigue: 4 } }
      }
    ]
  },

  /* ==========================================================
     ERA 2 — 확장기
     ========================================================== */
  e2_autoRequest: {
    id: "e2_autoRequest",
    title: "자동차 공동개발 제안 · 고객사 해외 이전",
    /* ★ 실제 DRB 연표와 헷갈리기 쉬운 자리입니다. 바로 다음 화면(ACTUAL DRB)에
         "1967. 2 현대자동차와 자동차용 고무부품 공동개발" 이 나오기 때문입니다.
         DRB가 1986년에 자동차 입찰에서 경쟁했다는 기록은 없습니다.
         1986년은 기업부설연구소를 세운 해입니다.
         '한 곳만 계약한다' 는 것도 조들이 정면으로 부딪히게 하려고 넣은 장치이지
         실제로 있었던 일이 아닙니다. 이 한 줄이 빔에 같이 뜹니다. */
    factNote: "이 입찰은 만들어낸 상황입니다. 실제 DRB는 1967년에 현대자동차와 " +
              "자동차용 고무부품을 공동개발했고, 1986년은 기업부설연구소를 세운 해입니다.",
    headline: "완성차 업체, 부품 공동개발 파트너 물색 — 고객사 해외 이전도 가속",
    body: "자동차 회사가 부품을 함께 개발하자고 제안해 왔습니다.\n" +
          "같은 시기, 주요 고객들이 생산기지를 해외로 옮기며 현지 조달을 요구합니다.\n" +
          "두 기회는 각각 다른 준비를 요구합니다.",
    base: { mult: { demand: 0.04 } },
    reactions: [
      {
        /* ★ 완성차 업체는 파트너를 한 곳만 고릅니다.
             조건을 넘긴 조가 여럿이면 그중 한 곳만 계약합니다.
             나머지는 개발비만 쓰고 물량을 못 받습니다 — 실제로 그런 일입니다. */
        when: { field: "invest.auto", op: ">=", value: 20 },
        limited: {
          id: "autoPartner",
          slots: 1,
          title: "자동차 공동개발 파트너",
          /* 돈만 많이 넣는다고 되지 않습니다. 만들 수 있는 회사인지, 믿을 만한
             회사인지, 사람이 있는지를 함께 봅니다. 완성차 업체가 보는 것들입니다. */
          score: [
            { field: "invest.auto", weight: 1.00, max: 80 },
            { field: "tech",        weight: 0.55, max: 100 },
            { field: "trust",       weight: 0.45, max: 100 },
            { field: "people",      weight: 0.30, max: 100 }
          ],
          lost: {
            text: "자동차 공동개발에 들어갔지만 파트너로 뽑히지 못했습니다 — 개발비는 이미 나갔습니다",
            mod: { delta: { cash: -8, fatigue: 4 }, mult: { demand: -0.03 } }
          }
        },
        text: "자동차부품 개발에 들어가 있어 공동개발 파트너로 선정됐습니다",
        mod: { mult: { demand: 0.14 }, delta: { trust: 5, fatigue: 3 } }
      },
      {
        when: { field: "sites", op: ">=", value: 1 },
        text: "이미 해외 거점이 있어 고객을 따라갈 수 있었습니다",
        mod: { mult: { demand: 0.16 }, delta: { trust: 5 } }
      },
      {
        when: { field: "invest.globalPlant", op: ">=", value: 20 },
        text: "해외 거점을 짓고 있다고 알려 물량을 붙잡았습니다",
        mod: { mult: { demand: 0.08 }, delta: { trust: 3 } }
      },
      {
        when: { field: "tech", op: ">=", value: 58 },
        text: "현지에서 대체할 수 없는 기술이라 국내 조달을 유지했습니다",
        mod: { mult: { demand: 0.10, price: 0.05 } }
      },
      {
        when: { field: "people", op: "<", value: 45 },
        text: "개발을 맡길 사람이 부족해 일정을 맞추지 못했습니다",
        mod: { delta: { fatigue: 6, trust: -3 } }
      }
    ]
  },

  e2_credit: {
    id: "e2_credit",
    title: "금융시장 경색 · 자금 회수",
    headline: "금융권 일제 자금 회수 — 제조업 연쇄 부도 우려",
    body: "은행이 만기 연장을 거부했습니다. 빌릴 수 있는 돈이 없습니다.\n" +
          "거래처는 대금 지급을 미루고, 환율 때문에 원료값은 더 올랐습니다.",
    base: { delta: { cash: -26 }, mult: { demand: -0.12, unitCost: 0.10 } },
    reactions: [
      {
        when: { field: "cash", op: ">=", value: 90 },
        text: "보유 현금으로 만기를 자력 상환했습니다",
        mod: { delta: { cash: 14, trust: 4 } }
      },
      {
        when: { field: "trust", op: ">=", value: 62 },
        text: "오래된 거래처들이 대금을 앞당겨 결제해 주었습니다",
        mod: { delta: { cash: 10 } }
      },
      {
        when: { field: "cash", op: "<", value: 30 },
        text: "자금난으로 설비 일부를 급하게 처분했습니다",
        mod: { delta: { capacity: -8, fatigue: 8 } }
      },
      {
        when: { field: "exposure", op: ">=", value: 35 },
        text: "해외 비중이 커서 환율 충격을 더 크게 받았습니다",
        mod: { delta: { cash: -10 } }
      },
      {
        when: { field: "rigidity", op: ">=", value: 45 },
        text: "덩치를 키워둔 만큼 줄이는 데도 시간이 걸립니다",
        mod: { delta: { cash: -8, fatigue: 5 } }
      }
    ]
  },

  /* ==========================================================
     ERA 3 — 전환기
     ========================================================== */
  e3_supplyBreak: {
    id: "e3_supplyBreak",
    title: "글로벌 공급망 단절",
    headline: "글로벌 물류 마비 — 부품 조달 중단, 생산 라인 연쇄 정지",
    body: "예고 없이 물류와 부품 공급이 끊겼습니다.\n" +
          "한 곳에서 막힌 것이 전 공정을 세웁니다.",
    base: { mult: { unitCost: 0.22, demand: -0.10 } },
    reactions: [
      {
        when: { field: "flex", op: ">=", value: 52 },
        text: "공급망을 여러 갈래로 나눠둬 라인을 세우지 않았습니다",
        mod: { mult: { unitCost: -0.14, demand: 0.08 }, delta: { trust: 4 } }
      },
      {
        when: { field: "sites", op: ">=", value: 2 },
        text: "생산 거점이 여러 곳이라 물량을 돌릴 수 있었습니다",
        mod: { mult: { demand: 0.06 } }
      },
      {
        when: { field: "rigidity", op: ">=", value: 45 },
        text: "설비와 조직이 무거워 대응이 늦었습니다",
        mod: { mult: { unitCost: 0.06 }, delta: { fatigue: 6 } }
      },
      {
        when: { field: "cash", op: ">=", value: 110 },
        text: "현금 여력으로 웃돈을 주고 물량을 확보했습니다",
        mod: { mult: { unitCost: -0.06 } }
      }
    ]
  },

  e3_transition: {
    id: "e3_transition",
    title: "모빌리티 전환 가속 · 규제 강화",
    headline: "전기차 전환 예상보다 빨라져 — 친환경 규제도 앞당겨 시행",
    body: "전기차 전환이 예상보다 빨라졌고, 친환경 규제도 앞당겨졌습니다.\n" +
          "지금까지 팔던 것 중 일부는 앞으로 팔 수 없게 됩니다.",
    base: { mult: { demand: -0.12 } },
    reactions: [
      {
        when: { field: "total.mobility", op: ">=", value: 20 },
        text: "모빌리티 전환에 미리 손을 대둔 것이 여기서 터졌습니다",
        mod: { mult: { demand: 0.24, price: 0.06 }, delta: { trust: 5 } }
      },
      {
        when: { field: "total.newMaterial", op: ">=", value: 20 },
        text: "친환경 소재를 준비해 둬 규제를 기회로 바꿨습니다",
        mod: { mult: { demand: 0.16, price: 0.05 } }
      },
      {
        when: { field: "total.esg", op: ">=", value: 20 },
        text: "환경·안전 기준을 미리 맞춰둬 규제 심사를 그대로 통과했습니다",
        mod: { mult: { demand: 0.10 }, delta: { trust: 4 } }
      },
      {
        when: { field: "experiments", op: ">=", value: 2 },
        text: "작게 해둔 실험 중 하나가 길을 열어 주었습니다",
        mod: { mult: { demand: 0.10 }, delta: { tech: 3 } }
      },
      {
        when: { field: "rigidity", op: ">=", value: 50 },
        text: "설비가 특정 제품에 묶여 있어 바꾸는 데 시간이 걸립니다",
        mod: { mult: { demand: -0.08 }, delta: { cash: -12 } }
      }
    ]
  },

  /* ==========================================================
     조건부 사건 — 특정 국면에 고정되지 않고,
     팀이 어떤 상태가 되면 그 팀에만 발생합니다.
     ========================================================== */
  c_claim: {
    id: "c_claim",
    conditional: true,
    trigger: { field: "quality", op: "<", value: 30 },
    title: "대형 품질 클레임 발생",
    headline: "납품 불량 연속 발생 — 거래처 전량 회수 요구",
    body: "납품한 제품에서 연속으로 불량이 나왔습니다.\n" +
          "거래처가 전량 회수를 요구했습니다.",
    base: { delta: { trust: -10, cash: -14, quality: 3 } },
    reactions: [
      {
        when: { field: "trust", op: ">=", value: 60 },
        text: "쌓아둔 신뢰 덕분에 거래 중단까지 가지는 않았습니다",
        mod: { delta: { trust: 4 } }
      }
    ]
  },

  c_burnout: {
    id: "c_burnout",
    conditional: true,
    trigger: { field: "fatigue", op: ">=", value: 62 },
    title: "핵심 인력 이탈",
    headline: "장기 과부하 운영 — 숙련 인력 대거 이탈",
    body: "무리한 운영이 계속되자 오래 일하던 사람들이 회사를 떠났습니다.\n" +
          "기술도 함께 빠져나갔습니다.",
    base: { delta: { people: -9, tech: -4, fatigue: -14 } },
    reactions: [
      {
        when: { field: "invest.people", op: ">=", value: 20 },
        text: "인력에 투자하고 있어 이탈 규모가 작았습니다",
        mod: { delta: { people: 5 } }
      },
      {
        when: { field: "invest.talent", op: ">=", value: 20 },
        text: "핵심 인재를 붙잡아 둔 것이 이탈을 막았습니다",
        mod: { delta: { people: 6, trust: 2 } }
      },
      {
        when: { field: "policy", op: "==", value: "talent" },
        text: "인재 중심 정책이 이탈을 막아주었습니다",
        mod: { delta: { people: 5, trust: 2 } }
      }
    ]
  },

  c_idle: {
    id: "c_idle",
    conditional: true,
    trigger: { field: "idleRate", op: ">=", value: 0.42 },
    title: "설비 가동률 저하",
    headline: "설비 가동률 급락 — 유휴 라인 유지비 부담",
    body: "만들 수는 있는데 팔 곳이 없습니다.\n" +
          "놀고 있는 설비에도 유지비는 그대로 나갑니다.",
    base: { delta: { cash: -10, fatigue: 4 } },
    reactions: [
      {
        when: { field: "reach", op: ">=", value: 60 },
        text: "판매망을 넓혀둔 덕에 일부 물량을 다른 곳으로 돌렸습니다",
        mod: { delta: { cash: 6 } }
      }
    ]
  },

  c_rigid: {
    id: "c_rigid",
    conditional: true,
    trigger: { field: "rigidity", op: ">=", value: 58 },
    title: "방향 전환 실패",
    headline: "시장 변화에 대응 지연 — 덩치 큰 조직의 한계",
    body: "시장이 움직였는데 우리는 제때 따라가지 못했습니다.\n" +
          "덩치가 커진 만큼 배를 돌리는 데 시간이 걸립니다.",
    base: { delta: { cash: -14, fatigue: 7 }, mult: { demand: -0.07 } },
    reactions: [
      {
        when: { field: "flex", op: ">=", value: 50 },
        text: "그래도 유연하게 짜둔 부분이 있어 일부는 돌릴 수 있었습니다",
        mod: { delta: { cash: 8 }, mult: { demand: 0.04 } }
      }
    ]
  }
};
