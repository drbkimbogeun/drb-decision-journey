/* ============================================================
   uicheck.js — 화면 코드 정적 점검 (교육 당일에는 쓰지 않습니다)

   실행 :  node tools/uicheck.js
   확인 :
     1) 모든 JS 파일의 문법 오류
     2) js 에서 부르는 el("...") id 가 html 에 실제로 있는지
     3) html 에 있는데 아무도 안 쓰는 id
     4) state.js 흐름이 처음부터 끝까지 도는지 (localStorage 흉내)
   ============================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let fail = 0;

function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }
function ok(msg)  { console.log("OK   " + msg); }
function bad(msg) { console.log("실패 " + msg); fail++; }

/* ---------- 1. 문법 검사 ---------- */
console.log("=".repeat(80));
console.log("1. JS 문법");
console.log("=".repeat(80));

["data/config.js", "data/eras.js", "data/investments.js", "data/policies.js",
 "data/events.js", "data/rounds.js", "data/actual_drb.js",
 "data/competitors.js", "data/whatif.js", "data/global.js", "data/rivals.js",
 "js/engine.js", "js/state.js", "js/ui.js", "js/main.js"].forEach(f => {
  try {
    new vm.Script(read(f), { filename: f });
    ok(f);
  } catch (e) {
    bad(`${f} — ${e.message}`);
  }
});

/* ---------- 2. id 참조 일치 ---------- */
console.log("\n" + "=".repeat(80));
console.log("2. el(\"id\") 참조가 HTML 에 실제로 있는지");
console.log("=".repeat(80));

const html = read("index.html");
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

const jsSrc = read("js/ui.js") + read("js/main.js");
const usedIds = new Set([...jsSrc.matchAll(/\bel\("([^"]+)"\)/g)].map(m => m[1]));

/* 화면 전환용 sc-* 는 코드에서 조합해 만든다 */
const SCREENS = ["roundOpen", "situation", "invest", "policy", "timelapse", "result", "actual", "ending", "whatif", "final"];
SCREENS.forEach(s => usedIds.add("sc-" + s));

let missing = [];
usedIds.forEach(id => { if (!htmlIds.has(id)) missing.push(id); });

if (missing.length) {
  bad("HTML 에 없는 id 를 부르고 있습니다: " + missing.join(", "));
} else {
  ok(`JS 가 참조하는 id ${usedIds.size}개 모두 HTML 에 있음`);
}

let unused = [];
htmlIds.forEach(id => {
  if (!usedIds.has(id) && !/^(intro|app|stage|side|toast|modal)$/.test(id)) unused.push(id);
});
if (unused.length) {
  console.log("참고 HTML 에만 있고 JS 에서 안 쓰는 id: " + unused.join(", "));
} else {
  ok("쓰이지 않는 id 없음");
}

/* 진행자 화면도 같은 검사 */
const facHtml = read("facilitator.html");
const facIds = new Set([...facHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const facUsed = new Set([...facHtml.matchAll(/\bel\("([^"]+)"\)/g)].map(m => m[1]));
let facMissing = [];
facUsed.forEach(id => { if (!facIds.has(id)) facMissing.push(id); });
/* 모달 안에서 동적으로 만들어지는 것들 */
const dynamic = ["pasteInput", "pasteOk"];
facMissing = facMissing.filter(id => dynamic.indexOf(id) < 0);
if (facMissing.length) bad("facilitator.html 에 없는 id: " + facMissing.join(", "));
else ok("facilitator.html id 참조 정상");

/* ---------- 3. 데이터 무결성 ---------- */
console.log("\n" + "=".repeat(80));
console.log("3. 데이터 연결 상태");
console.log("=".repeat(80));

const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
["data/config.js", "data/eras.js", "data/investments.js", "data/policies.js",
 "data/events.js", "data/rounds.js", "data/actual_drb.js", "data/competitors.js", "data/whatif.js", "data/global.js", "data/rivals.js", "js/engine.js"
].forEach(f => vm.runInContext(read(f), sandbox, { filename: f }));
const W = sandbox.window;

W.DRB_ROUNDS.forEach(r => {
  const era = W.DRB_ERAS[r.era];
  if (!era) return bad(`ROUND ${r.no}: era '${r.era}' 가 eras.js 에 없습니다`);
  if (!W.DRB_INVESTMENTS[era.investSet]) bad(`${era.id}: investSet '${era.investSet}' 없음`);
  if (!W.DRB_POLICIES[era.policySet])   bad(`${era.id}: policySet '${era.policySet}' 없음`);
  if (!W.DRB_ACTUAL[r.actualId])        bad(`ROUND ${r.no}: actualId '${r.actualId}' 없음`);

  const invSet = W.DRB_INVESTMENTS[era.investSet] || [];
  if (!invSet.some(i => i.keepCash)) bad(`${era.id}: '현금 보유'(keepCash) 항목이 없습니다`);

  r.subrounds.forEach(sr => {
    if (sr.event && !W.DRB_EVENTS[sr.event]) bad(`${sr.id}: event '${sr.event}' 가 events.js 에 없습니다`);
    if (!sr.budget || sr.budget % W.DRB_CONFIG.tokenUnit !== 0) {
      bad(`${sr.id}: 예산 ${sr.budget} 이 토큰 단위(${W.DRB_CONFIG.tokenUnit})로 나뉘지 않습니다`);
    }
  });
});
ok(`라운드 ${W.DRB_ROUNDS.length}개 · 소라운드 ${W.DRB_ROUNDS.reduce((a, r) => a + r.subrounds.length, 0)}개 연결 정상`);

/* 이벤트가 참조하는 투자 id 가 실재하는지 */
const allInvestIds = new Set();
Object.values(W.DRB_INVESTMENTS).forEach(set => set.forEach(i => allInvestIds.add(i.id)));
Object.values(W.DRB_EVENTS).forEach(ev => {
  (ev.reactions || []).forEach(rc => {
    const f = rc.when && rc.when.field;
    if (!f) return;
    if (f.startsWith("invest.") || f.startsWith("total.")) {
      const id = f.split(".")[1];
      if (!allInvestIds.has(id)) bad(`이벤트 '${ev.id}': 존재하지 않는 투자 id '${id}' 를 참조합니다`);
    }
  });
});
ok("이벤트 조건이 참조하는 투자 항목 정상");

/* 정책 mods 오탈자 점검 */
const KNOWN_MODS = ["investEff", "demandMult", "unitCost", "fixedCost", "rdEff",
                    "qualityDrift", "trustDrift", "fatigueDrift", "peopleDrift",
                    "shockMult", "newFieldEff", "flexDrift", "rigidityDrift"];
Object.keys(W.DRB_POLICIES).forEach(set => {
  W.DRB_POLICIES[set].forEach(p => {
    Object.keys(p.mods || {}).forEach(k => {
      if (KNOWN_MODS.indexOf(k) < 0) bad(`정책 '${p.name}'(${set}): 엔진이 모르는 항목 '${k}'`);
    });
  });
});
ok("정책 효과 항목명 정상");

/* 투자 perUnit 이 건드리는 지표가 엔진 상태에 있는지 */
const stateKeys = Object.keys(W.DRBEngine.createState());
Object.keys(W.DRB_INVESTMENTS).forEach(set => {
  W.DRB_INVESTMENTS[set].forEach(item => {
    ["now", "next", "later", "stock"].forEach(phase => {
      Object.keys((item.perUnit || {})[phase] || {}).forEach(k => {
        if (stateKeys.indexOf(k) < 0) {
          bad(`투자 '${item.name}'(${set}) → ${phase}.${k} : 엔진 상태에 없는 지표`);
        }
      });
    });
  });
});
ok("투자 효과가 가리키는 지표 정상");

/* ---------- 4. 전체 흐름 (state.js) ---------- */
console.log("\n" + "=".repeat(80));
console.log("4. 게임 흐름 — 처음부터 끝까지");
console.log("=".repeat(80));

const store = {};
const box = {
  window: {}, console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  Date, JSON, Math,
  btoa: s => Buffer.from(s, "binary").toString("base64"),
  atob: s => Buffer.from(s, "base64").toString("binary"),
  unescape, escape, alert: msg => console.log("  (alert) " + msg)
};
box.window.window = box.window;
vm.createContext(box);
["data/config.js", "data/eras.js", "data/investments.js", "data/policies.js",
 "data/events.js", "data/rounds.js", "data/actual_drb.js",
 "data/competitors.js", "data/whatif.js", "data/global.js", "data/rivals.js",
 "js/engine.js", "js/state.js"].forEach(f => vm.runInContext(read(f), box, { filename: f }));

const S = box.window.DRBState;
S.newGame(4);
S.switchTeam("2조");

let guard = 0;
const trace = [];
while (S.phase() !== "final" && guard++ < 120) {
  const p = S.phase();
  if (p === "roundOpen")      { trace.push(`R${S.round().no} 시작`); S.setPhase("situation"); }
  else if (p === "situation") { S.setPhase("invest"); }
  else if (p === "invest")    { S.setPhase("policy"); }
  else if (p === "policy") {
    const budget = S.budget();
    const items = S.investments();
    const alloc = {};
    /* 예산을 앞의 두 항목에 반씩 */
    alloc[items[0].id] = Math.floor(budget / 2 / 10) * 10;
    alloc[items[1].id] = budget - alloc[items[0].id];
    const ch = {};
    items.forEach(i => { if (i.dimensions && alloc[i.id]) ch[i.id] = { where: "china", how: "jv" }; });
    const pol = S.policies()[0].id;
    const r = S.commitSubround(alloc, pol, ch);
    trace.push(`  ${S.subround().id} 매출 ${r.report.kpi.revenue} 손익 ${r.report.kpi.profit}`);
    S.setPhase("timelapse");
  }
  else if (p === "timelapse") { S.setPhase("result"); }
  else if (p === "result") {
    if (S.isLastSubround()) S.setPhase("actual"); else S.advance();
  }
  else if (p === "actual")    { if (S.isLastRound()) S.setPhase("ending"); else S.advance(); }
  else if (p === "ending")    { S.setPhase("whatif"); }
  else if (p === "whatif")    { S.advance(); }
  else { bad("모르는 단계: " + p); break; }
}

trace.forEach(t => console.log("     " + t));

if (S.phase() === "final") ok(`최종 화면까지 도달 (${S.team().history.length}개 국면 완료)`);
else bad("최종 화면에 도달하지 못했습니다 (phase=" + S.phase() + ")");

if (S.team().history.length !== S.totalTurns()) {
  bad(`진행한 국면 수(${S.team().history.length})가 전체(${S.totalTurns()})와 다릅니다`);
} else ok("모든 소라운드가 한 번씩 실행됨");

/* 다른 조는 아직 시작 상태여야 한다 */
if (S.g().teams["1조"].history.length !== 0) bad("조를 바꿨는데 다른 조 기록이 섞였습니다");
else ok("조별 진행 상태가 서로 섞이지 않음");

/* 결과 코드 왕복 */
S.team().reason = "확실한 현금흐름을 먼저 지키기로 했습니다.";
const code = S.exportTeamCode();
const back = S.decodeTeamCode(code);
if (!back || back.t !== "2조" || back.w !== S.team().reason) bad("결과 코드 인코딩/디코딩 실패");
else ok(`결과 코드 왕복 정상 (${code.length}자)`);

/* 저장 → 불러오기 */
const saved = S.load();
if (!saved || !saved.teams["2조"] || saved.teams["2조"].history.length !== S.totalTurns()) {
  bad("저장/불러오기 후 기록이 유지되지 않습니다");
} else ok("저장 → 불러오기 정상");

console.log("\n" + "=".repeat(80));
console.log(fail ? `문제 ${fail}건` : "문제 없음");
console.log("=".repeat(80));
process.exit(fail ? 1 : 0);
