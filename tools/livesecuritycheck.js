"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const worker = fs.readFileSync("worker.js", "utf8");
const live = fs.readFileSync("js/live.js", "utf8");
const facilitator = fs.readFileSync("js/facilitator.js", "utf8");
const config = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));

function has(source, pattern, message) {
  assert(pattern.test(source), message);
}

has(worker, /const SESSION_TTL_MS = 24 \* 60 \* 60 \* 1000;/, "session TTL must be 24 hours");
has(worker, /storage\.setAlarm\(now \+ SESSION_TTL_MS\)/, "session creation must schedule expiry alarm");
has(worker, /async alarm\(\)[\s\S]*DELETE FROM teams; DELETE FROM team_claims; DELETE FROM session;/, "alarm must delete all session data");
has(worker, /export class RequestGate extends DurableObject/, "central request gate must exist");
has(worker, /create:ip:\{ip\}[\s\S]*create:global/, "create must be IP and globally rate limited");
has(worker, /join-fail:ip:\{ip\}[\s\S]*join-fail:session:/, "failed joins must be IP and session rate limited");
has(worker, /CREATE TABLE IF NOT EXISTS team_claims[\s\S]*claim_hash TEXT NOT NULL/, "per-team claim hashes must be stored");
has(worker, /existing[\s\S]*token = bearerToken\(request\)[\s\S]*sha256\(token\) === existing\.token_hash[\s\S]*TEAM_ALREADY_JOINED/, "occupied team must require its prior bearer token");
const reconnectBranch = worker.slice(worker.indexOf("if (existing)"), worker.indexOf("} else {", worker.indexOf("if (existing)")));
assert(!/UPDATE teams SET token_hash/.test(reconnectBranch), "authenticated reconnect must not rotate the stored token hash");
has(reconnectBranch, /UPDATE teams SET last_seen/, "authenticated reconnect may only refresh presence");
has(worker, /claimSecret[\s\S]*SELECT claim_hash FROM team_claims[\s\S]*INVALID_JOIN_CREDENTIALS/, "empty team must require its per-team claim secret");
has(worker, /assertBrowserSameOrigin\(request\)[\s\S]*enforceRateLimits\(env, request/, "public mutations must require browser origin before rate-limited processing");
has(worker, /action === "team-reset"[\s\S]*requireFacilitator\(request, session\)[\s\S]*DELETE FROM teams WHERE name = \?/, "team reset must require facilitator auth and delete only that team row");
has(worker, /team-reset:ip:\{ip\}[\s\S]*team-reset:session:/, "team reset must be IP and session rate limited");

const snapshotSection = worker.slice(worker.indexOf("publicSnapshot(session)"), worker.indexOf("async fetch(request)", worker.indexOf("publicSnapshot(session)")));
assert(!/(pin_hash|facilitator_hash|token_hash|claim_hash|claimSecret|facilitatorSecret)/.test(snapshotSection), "facilitator snapshot must not expose authentication material");

assert.deepStrictEqual(
  config.durable_objects.bindings.map((item) => item.name).sort(),
  ["GAME_SESSION", "REQUEST_GATE"],
  "both Durable Object bindings must be configured",
);
for (const className of ["GameSession", "RequestGate"]) {
  assert.deepStrictEqual(config.exports[className], { type: "durable-object", storage: "sqlite" });
}
has(facilitator, /#pin=[\s\S]*&claim=/, "participant secrets must be placed in the URL fragment");
assert(!/target='_blank'[\s\S]*claim/.test(facilitator), "facilitator must not be able to open and accidentally claim a team link");
has(facilitator, /fac-team-link-copy[\s\S]*clipboard\.writeText/, "team assignment URLs must be copy-only");
has(facilitator, /teamResetConfirm[\s\S]*DRBLive\.resetTeam\(teamName\)/, "team reset must use a branded second confirmation action");
has(facilitator, /sessionRecovery[\s\S]*facilitatorRecoveryLink\(\)[\s\S]*clipboard\.writeText/, "facilitator recovery URL must be copy-only");
has(facilitator, /function boot\(\)[\s\S]*restoreFacilitatorFromUrl\(\)/, "facilitator boot must restore fragment credentials before polling");
has(facilitator, /sessionEndConfirm[\s\S]*leave\(\{ destroy: true \}\)/, "session deletion must use a branded second confirmation action");

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

async function checkClientJoinContract() {
  const requests = [];
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const claim = "A".repeat(43);
  const firstToken = "T".repeat(42) + "1";
  const location = {
    search: "?session=ABCDEF&team=" + encodeURIComponent("1조"),
    hash: "#pin=1234&claim=" + claim,
    pathname: "/",
  };
  const window = {
    localStorage,
    sessionStorage,
    location,
    history: {
      replaceState(_state, _title, url) {
        assert(!url.includes("claim="), "claim secret must be removed from the visible URL");
        location.hash = "";
      },
    },
    setInterval() { return 1; },
    clearInterval() {},
    dispatchEvent() {},
    addEventListener() {},
  };
  const document = { title: "test", visibilityState: "visible", addEventListener() {} };
  const context = {
    window,
    document,
    location,
    URLSearchParams,
    Headers,
    Response,
    CustomEvent: class CustomEvent {},
    fetch: async (path, options) => {
      requests.push({
        path,
        headers: Object.fromEntries(options.headers.entries()),
        body: JSON.parse(options.body),
      });
      var authorization = options.headers.get("authorization");
      var returnedToken = authorization ? authorization.replace(/^Bearer /, "") : firstToken;
      return new Response(JSON.stringify({
        session: { id: "ABCDEF", teamCount: 4 },
        teamName: "1조",
        teamToken: returnedToken,
        control: { currentTurn: 0, stage: "lobby", deadline: null, revealedActual: null },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  vm.createContext(context);
  vm.runInContext(live, context, { filename: "js/live.js" });

  await window.DRBLive.joinFromUrl();
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].headers.authorization, undefined, "first claim must not pretend to own the team");
  assert.deepStrictEqual(requests[0].body, { teamName: "1조", pin: "1234", claimSecret: claim });
  assert.strictEqual(location.hash, "", "first join must clear fragment secrets");

  await window.DRBLive.joinFromUrl();
  assert.strictEqual(requests.length, 2);
  assert(/^Bearer T{42}1$/.test(requests[1].headers.authorization), "reconnect must prove prior team token");
  assert.deepStrictEqual(requests[1].body, { teamName: "1조" }, "reconnect must not resend PIN or claim secret");
  await window.DRBLive.joinFromUrl();
  assert.strictEqual(requests[2].headers.authorization, requests[1].headers.authorization, "reconnect response must preserve the same token for retry safety");

  location.search = "?session=ABCDEF&team=" + encodeURIComponent("2조");
  const before = requests.length;
  assert.strictEqual(await window.DRBLive.joinFromUrl(), null, "another empty team cannot be claimed without its link secret");
  assert.strictEqual(requests.length, before);
}

async function checkFacilitatorRecoveryContract() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const location = { origin: "https://training.example", pathname: "/facilitator", search: "", hash: "" };
  const window = {
    localStorage,
    sessionStorage,
    location,
    history: {
      replaceState(_state, _title, url) {
        assert(!url.includes("recover="), "facilitator recovery secret must be removed from the visible URL");
        location.hash = "";
      },
    },
    setInterval() { return 1; },
    clearInterval() {},
    dispatchEvent() {},
    addEventListener() {},
  };
  const document = { title: "test", visibilityState: "visible", addEventListener() {} };
  const context = {
    window,
    document,
    location,
    URLSearchParams,
    Headers,
    Response,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    CustomEvent: class CustomEvent {},
    fetch: async (path, options) => {
      assert.strictEqual(path, "/api/session/ABCDEF/team-reset");
      assert.strictEqual(options.method, "PUT");
      assert(/^Bearer F{43}$/.test(options.headers.get("authorization")));
      assert.deepStrictEqual(JSON.parse(options.body), { teamName: "1조" });
      return new Response(JSON.stringify({ ok: true, teamName: "1조" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  vm.createContext(context);
  vm.runInContext(live, context, { filename: "js/live.js" });

  const credentials = {
    sessionId: "ABCDEF",
    facilitatorSecret: "F".repeat(43),
    pin: "1234",
    teamClaims: { "1조": "A".repeat(43), "2조": "B".repeat(43) },
    teamCount: 2,
  };
  sessionStorage.setItem("drb.live.facilitator.v1", JSON.stringify(credentials));
  const recoveryUrl = window.DRBLive.facilitatorRecoveryLink();
  assert(recoveryUrl.startsWith("https://training.example/facilitator#recover="));
  assert(!recoveryUrl.includes(credentials.facilitatorSecret), "facilitator secret must be encoded inside the fragment");

  sessionStorage.removeItem("drb.live.facilitator.v1");
  location.hash = recoveryUrl.slice(recoveryUrl.indexOf("#"));
  const restored = window.DRBLive.restoreFacilitatorFromUrl();
  assert.deepStrictEqual({ sessionId: restored.sessionId, teamCount: restored.teamCount }, { sessionId: "ABCDEF", teamCount: 2 });
  assert.deepStrictEqual(JSON.parse(sessionStorage.getItem("drb.live.facilitator.v1")), credentials, "recovery must restore every team claim and facilitator credential to sessionStorage");
  assert.strictEqual(location.hash, "", "recovery fragment must be erased immediately");
  assert.strictEqual(localStorage.getItem("drb.live.facilitator.v1"), null, "facilitator secrets must never be persisted in localStorage");
  await window.DRBLive.resetTeam("1조");
}

Promise.all([checkClientJoinContract(), checkFacilitatorRecoveryContract()]).then(() => {
  console.log("live security contract: PASS");
}).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
