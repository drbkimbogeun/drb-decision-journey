/* ============================================================
   twoteamscheck.js — 한 브라우저에서 두 조를 같이 띄워도 둘 다 들어오는가

   실행 :  node tools/twoteamscheck.js
   준비 :  없습니다. node 만 있으면 됩니다.

   ★ 실제로 났던 사고입니다.
     1조와 2조를 같은 PC의 탭 두 개로 띄워 리허설을 돌렸더니,
     2조 값이 진행자 화면에 끝까지 올라오지 않았습니다. 원인은 두 가지였습니다.
       1) joinWithCode 가 넣은 코드를 보지 않고, 이 브라우저가 앞서 들어간
          조로 그냥 되돌아갔습니다 → 2조 코드를 넣어도 1조가 됐습니다.
       2) 조 토큰이 localStorage 에 있어 탭끼리 공유됐습니다 → 나중에 들어온
          조가 먼저 들어온 조의 토큰을 덮어썼습니다.
     둘 다 화면에는 아무 오류도 뜨지 않아서, 이런 검사가 없으면 못 잡습니다.

   진짜 js/live.js 를 그대로 돌립니다. 서버는 worker.js 의 join / team /
   snapshot 규칙만 옮긴 작은 것입니다. 탭 두 개는 localStorage 는 같이 쓰고
   sessionStorage 만 따로 씁니다 — 실제 브라우저 탭이 그렇습니다.
   ============================================================ */

const path = require("path");
const fs = require("fs");
const http = require("http");
const vm = require("vm");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");

const LIVE = process.argv[2] || path.join(ROOT, "js/live.js");

let pass = 0, fail = 0;
const ok = m => { pass++; console.log("OK   " + m); };
const bad = m => { fail++; console.error("실패 " + m); };
const expect = (c, m) => { c ? ok(m) : bad(m); return !!c; };
const step = t => console.log("\n" + "─".repeat(70) + "\n" + t);

/* ============================================================
   worker.js 의 규칙을 그대로 옮긴 서버
   ============================================================ */
const store = { id: "AB2C3D", claims: {}, teams: {} };
["1조", "2조", "3조"].forEach((n, i) => { store.claims[n] = String(1001 + i * 11); });

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function err(res, code, message, errCode) { send(res, code, { error: { message, code: errCode } }); }
function bearer(req) {
  const h = req.headers.authorization || "";
  return /^Bearer (.+)$/.exec(h) ? /^Bearer (.+)$/.exec(h)[1] : null;
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const m = /^\/api\/session\/([A-Z0-9]{6})\/(join|team|snapshot)$/.exec(req.url);
    if (!m || m[1] !== store.id) return err(res, 404, "세션을 찾을 수 없습니다.", "SESSION_NOT_FOUND");
    const action = m[2];

    if (action === "join") {
      /* 코드로 들어오기 — 코드가 곧 조입니다 */
      if (Object.keys(body).length === 1 && typeof body.joinCode === "string") {
        const name = Object.keys(store.claims).find(n => store.claims[n] === body.joinCode);
        if (!name) return err(res, 403, "Session credentials are invalid.", "INVALID_JOIN_CREDENTIALS");
        if (store.teams[name]) {
          return err(res, 409, "This team is already joined on another browser.", "TEAM_ALREADY_JOINED");
        }
        const token = crypto.randomBytes(32).toString("base64url");
        store.teams[name] = { token, snapshot: { teamName: name, history: [] } };
        return send(res, 200, { session: { id: store.id, teamCount: 3 }, teamName: name, teamToken: token, control: {} });
      }
      /* 토큰으로 원래 자리에 다시 붙기 */
      const name = body.teamName;
      const existing = store.teams[name];
      if (!existing) return err(res, 403, "Session credentials are invalid.", "INVALID_JOIN_CREDENTIALS");
      if (existing.token !== bearer(req)) {
        return err(res, 409, "This team is already joined on another browser.", "TEAM_ALREADY_JOINED");
      }
      return send(res, 200, { session: { id: store.id, teamCount: 3 }, teamName: name, teamToken: existing.token, control: {} });
    }

    if (action === "team") {
      const token = bearer(req);
      const name = Object.keys(store.teams).find(n => store.teams[n].token === token);
      if (!name) return err(res, 403, "팀 인증 정보가 올바르지 않습니다.", "FORBIDDEN");
      if (body.heartbeat !== true) {
        /* 서버는 스냅샷의 조 이름을 토큰이 가리키는 조로 강제합니다 (worker.js 와 같음) */
        store.teams[name].snapshot = Object.assign({}, body, { teamName: name });
      }
      return send(res, 200, { ok: true, receivedAt: Date.now(), control: {} });
    }

    if (action === "snapshot") {
      return send(res, 200, {
        teams: Object.keys(store.teams).map(n => ({ name: n, snapshot: store.teams[n].snapshot })),
      });
    }
  });
});

/* ============================================================
   탭 — localStorage 는 같이, sessionStorage 는 따로
   ============================================================ */
function makeStorage(backing) {
  return {
    getItem: k => (k in backing ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: k => { delete backing[k]; },
  };
}

/* 탭 하나 = live.js 가 쓰는 브라우저 물건들만 갖춘 사본입니다.
   (jsdom 은 공유폴더에서 불러오는 데만 몇 분이 걸려 쓰지 않습니다) */
function openTab(base, sharedLocal) {
  const listeners = {};
  const sandbox = {
    console,
    fetch: (p, o) => fetch(base + p, o),
    Headers, URLSearchParams, TextEncoder, TextDecoder, CustomEvent, Event,
    btoa: s => Buffer.from(s, "binary").toString("base64"),
    atob: s => Buffer.from(s, "base64").toString("binary"),
    setInterval, clearInterval, setTimeout, clearTimeout,
    document: {
      title: "탭",
      visibilityState: "visible",
      addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { search: "?s=" + store.id, pathname: "/play", origin: base, hash: "" };
  sandbox.history = { replaceState() {} };
  sandbox.dispatchEvent = () => true;
  Object.defineProperty(sandbox, "localStorage", { value: makeStorage(sharedLocal) });
  Object.defineProperty(sandbox, "sessionStorage", { value: makeStorage({}) });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(LIVE, "utf8"), sandbox, { filename: LIVE });
  return sandbox;
}

(async function () {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  console.log("검사 대상 : " + LIVE);

  /* ★ 탭 두 개가 같은 브라우저입니다 — localStorage 를 공유합니다 */
  const sharedLocal = {};
  const tab1 = openTab(base, sharedLocal);
  const tab2 = openTab(base, sharedLocal);

  const code1 = store.claims["1조"];
  const code2 = store.claims["2조"];

  step("1. 각 탭이 자기 코드로 자기 조에 들어가는가");
  let j1 = null, j2 = null;
  try { j1 = await tab1.DRBLive.joinWithCode(code1); } catch (e) { bad("1조 참가 실패 — " + e.message); }
  expect(j1 && j1.teamName === "1조", `1조 코드(${code1}) → ${j1 ? j1.teamName : "실패"}`);

  try { j2 = await tab2.DRBLive.joinWithCode(code2); } catch (e) { bad("2조 참가 실패 — " + e.message); }
  expect(j2 && j2.teamName === "2조", `2조 코드(${code2}) → ${j2 ? j2.teamName : "실패"}`);

  step("2. 나중에 들어온 2조가 1조 탭을 덮어쓰지 않는가");
  const c1 = tab1.DRBLive.credentials();
  const c2 = tab2.DRBLive.credentials();
  expect(c1 && c1.teamName === "1조", "1조 탭이 자기를 1조로 알고 있음 (" + (c1 && c1.teamName) + ")");
  expect(c2 && c2.teamName === "2조", "2조 탭이 자기를 2조로 알고 있음 (" + (c2 && c2.teamName) + ")");

  step("3. 두 조가 각자 결정을 보내면 서버에 따로 쌓이는가");
  const state = (name, cash) => ({
    activeTeam: name,
    teams: { [name]: { name, turnIndex: 1, history: [{ turn: 0, year: 1945, allocation: { tech: cash } }] } },
  });
  await tab1.DRBLive.publish(state("1조", 7), "1조");
  await tab2.DRBLive.publish(state("2조", 4), "2조");

  const snap = await (await fetch(base + "/api/session/" + store.id + "/snapshot")).json();
  const names = snap.teams.map(t => t.name);
  console.log("     서버가 들고 있는 조 : " + JSON.stringify(names));
  expect(names.length === 2 && names.includes("1조") && names.includes("2조"),
    "서버에 1조와 2조가 둘 다 있음 (" + names.join(", ") + ")");

  const got = n => (snap.teams.find(t => t.name === n) || {}).snapshot || {};
  expect((got("1조").history || []).length === 1, "1조 결정이 1조 자리에 들어감");
  expect((got("2조").history || []).length === 1, "2조 결정이 2조 자리에 들어감");
  expect((got("1조").history || [{}])[0].allocation?.tech === 7,
    "1조 값이 1조 것 (tech " + (got("1조").history || [{}])[0].allocation?.tech + ", 기대 7)");
  expect((got("2조").history || [{}])[0].allocation?.tech === 4,
    "2조 값이 2조 것 (tech " + (got("2조").history || [{}])[0].allocation?.tech + ", 기대 4)");

  step("4. 새로고침 — 같은 탭에서 같은 코드로 제자리에 돌아오는가");
  const tab2b = openTab(base, sharedLocal);       // 탭을 닫았다 다시 연 셈 (sessionStorage 비었음)
  let back = null;
  try { back = await tab2b.DRBLive.joinWithCode(code2); } catch (e) { bad("2조 복귀 실패 — " + e.message); }
  expect(back && back.teamName === "2조", "2조가 자기 코드로 2조에 다시 붙음 (" + (back && back.teamName) + ")");

  step("5. 남의 코드로는 남의 조가 되지 않는가");
  const tab3 = openTab(base, sharedLocal);
  let three = null, threeErr = "";
  try { three = await tab3.DRBLive.joinWithCode(store.claims["3조"]); }
  catch (e) { threeErr = e.message; }
  expect(three && three.teamName === "3조",
    "3조 코드는 3조로 들어감 (" + (three ? three.teamName : threeErr) + ")");

  /* 각 탭의 15초 heartbeat 를 끕니다. 안 끄면 node 가 안 끝납니다. */
  await Promise.all([tab1, tab2, tab2b, tab3].map(t => t.DRBLive.leave().catch(() => {})));
  server.close();

  console.log("\n" + "=".repeat(70));
  console.log(`두 탭 동시 참가 검사: ${pass}건 통과 / ${fail}건 실패`);
  console.log("=".repeat(70));
  process.exitCode = fail ? 1 : 0;
})();
