/* ============================================================
   script.js — 사회자 대본을 데이터에서 뽑아냅니다

   실행 :  node tools/script.js
   결과 :  사회자 대본.md  (저장소 맨 위)

   ★ 대본을 손으로 따로 적어두지 않습니다.
     빔의 '시대 설명' 화면에 뜨는 상황과 국내·세계 신호는 data/rounds.js 에 있고,
     신호마다 사회자가 풀어서 말할 문장(say)이 그 옆에 있습니다.
     대본은 그것을 그대로 꺼내 늘어놓은 것이라, 데이터를 고치면 이 파일을 다시 돌립니다.
     따로 적어두면 화면과 대본이 반드시 어긋납니다.

   ★ say 가 비어 있는 신호가 하나라도 있으면 실패로 끝냅니다 — 조용히 빈 대본을 만들지 않습니다.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "사회자 대본.md");

const box = { window: {}, console };
box.window.window = box.window;
vm.createContext(box);
["data/config.js", "data/eras.js", "data/investments.js", "data/policies.js",
 "data/events.js", "data/rounds.js", "data/global.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), box, { filename: f }));
const W = box.window;

let missing = 0;
const lines = [];
const put = (s) => lines.push(s === undefined ? "" : s);

/* 데이터의 줄바꿈을 문단으로 — 화면과 같은 호흡으로 읽게 합니다 */
function paragraphs(text) {
  return String(text || "").split(/\n\s*\n/).map((p) => p.replace(/\n/g, " ").trim()).filter(Boolean);
}

function signals(label, rows, subId) {
  put("### " + label);
  put();
  rows.forEach((row) => {
    put("**" + row.text + "**");
    if (row.say && String(row.say).trim()) {
      put(row.say.trim());
    } else {
      missing += 1;
      put("_(풀어 말할 문장이 없습니다 — data/rounds.js " + subId + " 의 이 신호에 say 를 적어주세요)_");
    }
    put();
  });
}

put("# 사회자 대본 — 국면마다 시대 상황 설명하기");
put();
put("> `node tools/script.js` 가 `data/rounds.js` · `data/eras.js` 에서 만들어 낸 파일입니다. **손으로 고치지 마세요.**");
put("> 신호나 설명을 바꾸려면 `data/rounds.js` 의 `briefing` (text · say) 을 고친 뒤 다시 돌립니다.");
put(">");
put("> 굵은 줄은 빔의 '시대 설명' 화면에 그대로 뜨는, **그 시대에 실제로 있었던 국내·세계 상황**입니다. 그 아래 문장이 사회자가 풀어서 말할 내용입니다.");
put("> DRB 이야기는 '상황'에만 있습니다 — 모든 조가 같은 시대 정보를 보고 결정합니다. 뒤에 어떻게 됐는지는 여기서 말하지 않습니다.");
put();
put("---");
put();

let turn = 0;
W.DRB_ROUNDS.forEach((round) => {
  const era = W.DRB_ERAS[round.era];
  const set = W.DRB_INVESTMENTS[era.investSet];
  const minutes = Math.round((era.pace && era.pace.discussSeconds || 300) / 60);

  round.subrounds.forEach((sub, subIndex) => {
    turn += 1;
    const title = String(sub.title).replace(/^.*?·\s*/, "");
    const visible = set.filter((i) => (Number(i.unlockSubround) || 0) <= subIndex);
    const fresh = visible.filter((i) => (Number(i.unlockSubround) || 0) === subIndex);
    const dims = visible.filter((i) => i.dimensions && i.dimensions.length);
    const meta = (W.DRB_DECISION_COMPLEXITY || {})[sub.id] || {};
    const brief = sub.briefing || era.briefing || {};

    put("## " + turn + "국면 · " + sub.year + " — " + title);
    put();
    put("**ERA " + round.no + " · " + era.name + "** · 투자 칸 " + visible.length + "개 · 토론 " + minutes + "분");
    put();

    /* 시대가 바뀌는 국면에서는 시대 전체를 한 번 열어줍니다 (eras.js narrative) */
    if (subIndex === 0 && era.narrative) {
      put("### 시대를 열며");
      put();
      paragraphs(era.narrative).forEach((p) => { put(p); put(); });
    }

    put("### 상황");
    put();
    if (sub.situation && sub.situation.title) { put("**" + sub.situation.title + "**"); put(); }
    paragraphs(sub.situation && sub.situation.body).forEach((p) => { put(p); put(); });

    signals("국내", brief.domestic || [], sub.id);
    signals("세계", brief.global || [], sub.id);

    put("### 이번 국면에 새로 정하는 것");
    put();
    if (fresh.length) put("- 새로 열린 투자 칸: " + fresh.map((i) => i.name).join(" · "));
    if (dims.length) put("- 함께 정해야 하는 것: " + dims.map((i) => i.name + " — 어디에 · 어떻게").join(" · "));
    if (meta.newDimensions && meta.newDimensions.length) put("- 새 판단: " + meta.newDimensions.join(" · "));
    put();

    put("### 던질 질문");
    put();
    put("> " + (round.subtitle || era.question));
    put();

    put("### 그리고");
    put();
    put("- \"토론 " + minutes + "분입니다. 예산은 남김없이 배분하고, 남길 돈은 현금 칸에 넣습니다. 확정하면 되돌릴 수 없습니다.\"");
    if (sub.event) put("- ⚠ 이 국면의 결정이 끝난 뒤 **돌발상황**이 있습니다. 지금은 말하지 마세요.");
    if (sub.isFinalDecision) put("- ⚠ 이 결정 뒤에는 **결과 화면이 없습니다.** 미리 말하지 마세요 — 진행자 가이드 6장.");
    if (sub.guide) put("- 진행 메모: " + sub.guide);
    put();
    put("---");
    put();
  });
});

fs.writeFileSync(OUT, lines.join("\n"), "utf8");

const total = W.DRB_ROUNDS.reduce((a, r) => a + r.subrounds.reduce((b, s) =>
  b + ((s.briefing || {}).domestic || []).length + ((s.briefing || {}).global || []).length, 0), 0);
console.log("사회자 대본 → " + OUT);
console.log("국면 " + turn + "개 · 신호 " + total + "줄 · 풀어 말할 문장이 빠진 줄 " + missing + "개");
if (missing) {
  console.error("say 가 빠진 신호가 있습니다. data/rounds.js 를 채운 뒤 다시 돌리세요.");
  process.exit(1);
}
