import { DurableObject } from "cloudflare:workers";

/* 조별 참가 코드 — 빔에서 읽고 바로 칠 수 있게 숫자 4자리입니다.
   1만 가지뿐이지만 join-fail 제한(IP당 15분에 10회)이 무차별 대입을 막습니다. */
const JOIN_CODE = /^\d{4}$/;
const SESSION_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const TEAM_NAME = /^([1-6])조$/u;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_JSON_BYTES = 96 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const CONTROL_STAGES = new Set([
  "lobby",
  "briefing",
  "decisions",
  "event",
  "actual",
  "debrief",
  "map",
  "complete",
]);

class ApiError extends Error {
  constructor(status, message, code = "BAD_REQUEST", headers = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(data, status = 200, extraHeaders = undefined) {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers });
}

function apiErrorResponse(error) {
  if (error instanceof ApiError) {
    return json({ error: { code: error.code, message: error.message } }, error.status, error.headers);
  }
  console.error("Unhandled API error", error);
  return json(
    { error: { code: "INTERNAL_ERROR", message: "서버에서 요청을 처리하지 못했습니다." } },
    500,
  );
}

function methodNotAllowed(allowed) {
  throw new ApiError(405, "허용되지 않은 요청 방식입니다.", "METHOD_NOT_ALLOWED", {
    allow: allowed.join(", "),
  });
}

function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let requestOrigin;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new ApiError(400, "잘못된 요청 주소입니다.", "INVALID_URL");
  }
  if (origin !== requestOrigin) {
    throw new ApiError(403, "동일 출처 요청만 허용됩니다.", "CROSS_ORIGIN_DENIED");
  }
}

function assertBrowserSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new ApiError(403, "Same-origin browser required.", "ORIGIN_REQUIRED");
  assertSameOrigin(request);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") {
    throw new ApiError(403, "Same-origin requests only.", "CROSS_ORIGIN_DENIED");
  }
}

function corsHeaders(request) {
  // Public mutations separately require an explicit same-origin browser Origin.
  const headers = new Headers({
    vary: "Origin",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
  });
  const origin = request.headers.get("origin");
  if (origin && origin === new URL(request.url).origin) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

async function readJson(request, limit = MAX_JSON_BYTES) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new ApiError(415, "Content-Type은 application/json이어야 합니다.", "UNSUPPORTED_MEDIA_TYPE");
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new ApiError(413, "요청 데이터가 너무 큽니다.", "PAYLOAD_TOO_LARGE");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limit) {
    throw new ApiError(413, "요청 데이터가 너무 큽니다.", "PAYLOAD_TOO_LARGE");
  }
  if (!bytes.byteLength) {
    throw new ApiError(400, "JSON 요청 본문이 필요합니다.", "BODY_REQUIRED");
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch {
    throw new ApiError(400, "올바른 JSON 객체를 보내주세요.", "INVALID_JSON");
  }
}

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{24,128})$/.exec(request.headers.get("authorization") || "");
  if (!match) throw new ApiError(401, "인증 정보가 필요합니다.", "AUTH_REQUIRED");
  return match[1];
}

function randomString(length, alphabet = CODE_ALPHABET) {
  const output = [];
  const ceiling = Math.floor(256 / alphabet.length) * alphabet.length;
  while (output.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.max(16, length * 2)));
    for (const byte of bytes) {
      if (byte >= ceiling) continue;
      output.push(alphabet[byte % alphabet.length]);
      if (output.length === length) break;
    }
  }
  return output.join("");
}

function randomPin() {
  const bytes = new Uint16Array(1);
  do crypto.getRandomValues(bytes); while (bytes[0] >= 63000);
  return String(1000 + (bytes[0] % 9000));
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientAddress(request) {
  const cloudflareAddress = cleanText(request.headers.get("cf-connecting-ip"), 64);
  if (cloudflareAddress) return cloudflareAddress;
  const forwarded = cleanText((request.headers.get("x-forwarded-for") || "").split(",")[0], 64);
  return forwarded || "local-development";
}

function cleanText(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanId(value, maxLength = 48) {
  const text = cleanText(value, maxLength);
  return /^[\w.:-]+$/u.test(text) ? text : "";
}

function boundedInteger(value, min, max, fallback = 0) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function sanitizeScalar(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(-100000, Math.min(100000, value));
  if (typeof value === "string") return cleanText(value, 180);
  return null;
}

function sanitizeMap(value, maxEntries = 20) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, maxEntries)) {
    const key = cleanId(rawKey, 48);
    const scalar = sanitizeScalar(rawValue);
    if (key && scalar !== null) output[key] = scalar;
  }
  return output;
}

function sanitizeReaction(value) {
  if (typeof value === "string") return { text: cleanText(value, 240) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reaction = {
    id: cleanId(value.id),
    text: cleanText(value.text ?? value.label ?? value.body, 240),
    positive: typeof value.positive === "boolean" ? value.positive : null,
    effect: cleanText(value.effect ?? value.result, 240),
  };
  return Object.fromEntries(Object.entries(reaction).filter(([, item]) => item !== "" && item !== null));
}

function sanitizeEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reactionsSource = Array.isArray(value.reactions)
    ? value.reactions
    : value.reaction == null
      ? []
      : [value.reaction];
  return {
    id: cleanId(value.id),
    title: cleanText(value.title ?? value.name, 120),
    body: cleanText(value.body ?? value.description ?? value.message, 600),
    effect: cleanText(value.effect ?? value.result, 300),
    reactions: reactionsSource.slice(0, 8).map(sanitizeReaction).filter(Boolean),
  };
}

function sanitizeAllocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allocation = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 20)) {
    const key = cleanId(rawKey, 48);
    const amount = Number(rawValue);
    if (key && Number.isFinite(amount)) allocation[key] = Math.max(0, Math.min(20, Math.round(amount)));
  }
  return allocation;
}

function sanitizeChoices(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const choices = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 20)) {
    const key = cleanId(rawKey, 48);
    if (!key || !rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
    const where = cleanId(rawValue.where ?? rawValue.location ?? rawValue.country, 64);
    const how = cleanId(rawValue.how ?? rawValue.mode, 64);
    if (where || how) choices[key] = { where, how };
  }
  return choices;
}

function sanitizeSite(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scale = Number(value.scale);
  return {
    country: cleanId(value.country, 64),
    countryName: cleanText(value.countryName, 100),
    mode: cleanId(value.mode, 64),
    modeName: cleanText(value.modeName, 100),
    scale: Number.isFinite(scale) ? Math.max(0, Math.min(100000, scale)) : 0,
    stage: cleanId(value.stage, 32),
    dueTurn: boundedInteger(value.dueTurn, 0, 12, 0),
    since: boundedInteger(value.since, 0, 12, 0),
  };
}

function sanitizeState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    sites: (Array.isArray(source.sites) ? source.sites : []).slice(0, 24).map(sanitizeSite).filter(Boolean),
  };
}

function sanitizeHistoryEntry(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const eventsSource = Array.isArray(value.events)
    ? value.events
    : Array.isArray(value.report?.events)
      ? value.report.events
      : [];
  const rawKpi = value.kpi && typeof value.kpi === "object" && !Array.isArray(value.kpi)
    ? value.kpi
    : value.report?.kpi || {};
  const revenue = Number(rawKpi.revenue);
  const profit = Number(rawKpi.profit);
  const beforeCash = Number(value.beforeCash ?? value.before?.cash);
  const afterCash = Number(value.afterCash ?? value.after?.cash);
  return {
    turn: boundedInteger(value.turn ?? value.turnIndex, 0, 5, index),
    roundId: cleanId(value.roundId ?? value.eraId ?? value.round?.id, 48),
    subroundId: cleanId(value.subroundId ?? value.subId ?? value.subround?.id, 48),
    year: boundedInteger(value.year, 1900, 2100, 0),
    title: cleanText(value.title ?? value.subTitle, 160),
    allocation: sanitizeAllocation(value.allocation ?? value.allocations),
    policyId: cleanId(value.policyId, 64),
    choices: sanitizeChoices(value.choices),
    events: eventsSource.slice(0, 8).map(sanitizeEvent).filter(Boolean),
    kpi: {
      revenue: Number.isFinite(revenue) ? Math.max(-100000, Math.min(100000, revenue)) : 0,
      profit: Number.isFinite(profit) ? Math.max(-100000, Math.min(100000, profit)) : 0,
    },
    headline: cleanText(value.headline ?? value.report?.headline, 500),
    beforeCash: Number.isFinite(beforeCash) ? Math.max(-100000, Math.min(100000, beforeCash)) : 0,
    afterCash: Number.isFinite(afterCash) ? Math.max(-100000, Math.min(100000, afterCash)) : 0,
  };
}

function sanitizeSnapshot(value, expectedTeamName) {
  const historySource = Array.isArray(value.history) ? value.history : [];
  const snapshot = {
    version: 1,
    teamName: expectedTeamName,
    phase: cleanId(value.phase ?? value.screen, 32) || "connected",
    turnIndex: boundedInteger(value.turnIndex ?? value.turn, 0, 6, historySource.length),
    state: sanitizeState(value.state),
    history: historySource.slice(-6).map(sanitizeHistoryEntry).filter(Boolean),
  };
  const encoded = JSON.stringify(snapshot);
  if (new TextEncoder().encode(encoded).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new ApiError(413, "팀 진행 데이터가 너무 큽니다.", "SNAPSHOT_TOO_LARGE");
  }
  return snapshot;
}
function defaultControl() {
  return { currentTurn: 0, stage: "lobby", deadline: null, revealedActual: null };
}

function sanitizeControlPatch(value, current) {
  const next = { ...current };
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !["currentTurn", "stage", "deadline", "revealedActual"].includes(key))) {
    throw new ApiError(400, "허용된 진행 제어 항목만 보내주세요.", "INVALID_CONTROL");
  }
  if (Object.hasOwn(value, "currentTurn")) {
    if (!Number.isInteger(value.currentTurn) || value.currentTurn < 0 || value.currentTurn > 6) {
      throw new ApiError(400, "currentTurn은 0~6 정수여야 합니다.", "INVALID_CONTROL");
    }
    next.currentTurn = value.currentTurn;
  }
  if (Object.hasOwn(value, "stage")) {
    if (!CONTROL_STAGES.has(value.stage)) {
      throw new ApiError(400, "알 수 없는 진행 단계입니다.", "INVALID_CONTROL");
    }
    next.stage = value.stage;
  }
  if (Object.hasOwn(value, "deadline")) {
    if (value.deadline !== null && (!Number.isInteger(value.deadline) || value.deadline < 0 || value.deadline > 8640000000000000)) {
      throw new ApiError(400, "deadline은 epoch 밀리초 정수 또는 null이어야 합니다.", "INVALID_CONTROL");
    }
    next.deadline = value.deadline;
  }
  if (Object.hasOwn(value, "revealedActual")) {
    if (value.revealedActual !== null && !/^r[1-3]$/.test(value.revealedActual)) {
      throw new ApiError(400, "revealedActual은 r1~r3 또는 null이어야 합니다.", "INVALID_CONTROL");
    }
    next.revealedActual = value.revealedActual;
  }
  return next;
}

export class RequestGate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_buckets (
        bucket_key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS live_sessions (
        code TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  first(query, ...bindings) {
    return [...this.sql.exec(query, ...bindings)][0] || null;
  }

  async fetch(request) {
    try {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      const url = new URL(request.url);
      const body = await readJson(request, 16 * 1024);
      const now = Date.now();
      this.sql.exec("DELETE FROM rate_buckets WHERE expires_at <= ?", now);
      this.sql.exec("DELETE FROM live_sessions WHERE expires_at <= ?", now);

      if (url.pathname === "/consume") {
        const rules = Array.isArray(body.rules) ? body.rules : [];
        if (!rules.length || rules.length > 6) throw new ApiError(400, "Invalid rate rules.", "INVALID_RATE_RULES");
        const checked = rules.map((rule) => {
          const key = cleanId(rule && rule.key, 160);
          const limit = boundedInteger(rule && rule.limit, 1, 10000, 0);
          const windowMs = boundedInteger(rule && rule.windowMs, 60000, 24 * 60 * 60 * 1000, 0);
          if (!key || !limit || !windowMs) throw new ApiError(400, "Invalid rate rule.", "INVALID_RATE_RULE");
          const windowStart = Math.floor(now / windowMs) * windowMs;
          const row = this.first("SELECT window_start, count FROM rate_buckets WHERE bucket_key = ?", key);
          const count = row && row.window_start === windowStart ? row.count : 0;
          return { key, limit, windowMs, windowStart, count };
        });
        const denied = checked.filter((item) => item.count >= item.limit);
        if (denied.length) {
          const retryAfter = Math.max(...denied.map((item) => Math.ceil((item.windowStart + item.windowMs - now) / 1000)));
          return json({ allowed: false, retryAfter });
        }
        checked.forEach((item) => {
          this.sql.exec(
            "INSERT INTO rate_buckets (bucket_key, window_start, count, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count, expires_at = excluded.expires_at",
            item.key,
            item.windowStart,
            item.count + 1,
            item.windowStart + item.windowMs,
          );
        });
        return json({ allowed: true });
      }

      if (url.pathname === "/register") {
        if (!SESSION_CODE.test(body.sessionId) || !Number.isInteger(body.expiresAt) || body.expiresAt <= now) {
          throw new ApiError(400, "Invalid session registration.", "INVALID_REGISTRATION");
        }
        this.sql.exec("INSERT OR REPLACE INTO live_sessions (code, expires_at) VALUES (?, ?)", body.sessionId, body.expiresAt);
        return json({ ok: true });
      }

      if (url.pathname === "/exists") {
        if (!SESSION_CODE.test(body.sessionId)) throw new ApiError(400, "Invalid session code.", "INVALID_SESSION_CODE");
        return json({ exists: !!this.first("SELECT code FROM live_sessions WHERE code = ? AND expires_at > ?", body.sessionId, now) });
      }

      /* 지금 열려 있는 세션이 딱 하나면 알려줍니다.
         교육은 한 번에 한 세션만 도는 것이 보통이라, 참가자가 맨 주소로 들어와도
         조 코드만으로 들어올 수 있게 하는 장치입니다.
         두 개 이상이면 알려주지 않습니다 — 엉뚱한 교육에 들어가면 안 되니까요. */
      if (url.pathname === "/current") {
        const rows = [...this.sql.exec("SELECT code FROM live_sessions WHERE expires_at > ? LIMIT 2", now)];
        return json({ sessionId: rows.length === 1 ? rows[0].code : null, count: rows.length });
      }

      if (url.pathname === "/remove") {
        if (!SESSION_CODE.test(body.sessionId)) throw new ApiError(400, "Invalid session code.", "INVALID_SESSION_CODE");
        this.sql.exec("DELETE FROM live_sessions WHERE code = ?", body.sessionId);
        return json({ ok: true });
      }

      throw new ApiError(404, "Gate action not found.", "NOT_FOUND");
    } catch (error) {
      return apiErrorResponse(error);
    }
  }
}

export class GameSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS session (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        code TEXT NOT NULL UNIQUE,
        pin_hash TEXT NOT NULL,
        facilitator_hash TEXT NOT NULL,
        team_count INTEGER NOT NULL CHECK (team_count BETWEEN 1 AND 6),
        control_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams (
        name TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS team_claims (
        name TEXT PRIMARY KEY,
        claim_hash TEXT NOT NULL
      );
    `);
  }

  first(query, ...bindings) {
    return [...this.sql.exec(query, ...bindings)][0] || null;
  }

  session() {
    const session = this.first("SELECT * FROM session WHERE singleton = 1");
    if (session && session.created_at + SESSION_TTL_MS <= Date.now()) {
      this.sql.exec("DELETE FROM teams; DELETE FROM team_claims; DELETE FROM session;");
      return null;
    }
    return session;
  }

  async alarm() {
    this.sql.exec("DELETE FROM teams; DELETE FROM team_claims; DELETE FROM session;");
  }

  async requireFacilitator(request, session) {
    const supplied = await sha256(bearerToken(request));
    if (supplied !== session.facilitator_hash) {
      throw new ApiError(403, "진행자 인증 정보가 올바르지 않습니다.", "FORBIDDEN");
    }
  }

  async requireTeam(request) {
    const supplied = await sha256(bearerToken(request));
    const team = this.first("SELECT * FROM teams WHERE token_hash = ?", supplied);
    if (!team) throw new ApiError(403, "팀 인증 정보가 올바르지 않습니다.", "FORBIDDEN");
    return team;
  }

  publicControl(session) {
    try {
      return sanitizeControlPatch(JSON.parse(session.control_json), defaultControl());
    } catch {
      return defaultControl();
    }
  }

  publicSnapshot(session) {
    const teams = [...this.sql.exec(
      "SELECT name, snapshot_json, joined_at, last_seen FROM teams ORDER BY CAST(REPLACE(name, '조', '') AS INTEGER)",
    )].map((row) => {
      let snapshot;
      try {
        snapshot = sanitizeSnapshot(JSON.parse(row.snapshot_json), row.name);
      } catch {
        snapshot = sanitizeSnapshot({}, row.name);
      }
      return {
        name: row.name,
        joinedAt: row.joined_at,
        lastSeen: row.last_seen,
        snapshot,
      };
    });
    return {
      session: {
        id: session.code,
        teamCount: session.team_count,
        createdAt: session.created_at,
        expiresAt: session.created_at + SESSION_TTL_MS,
        updatedAt: session.updated_at,
      },
      control: this.publicControl(session),
      teams,
    };
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const action = url.pathname.split("/").filter(Boolean).at(-1);
      const session = this.session();

      if (action === "create") {
        if (request.method !== "POST") methodNotAllowed(["POST"]);
        if (session) throw new ApiError(409, "이미 사용 중인 세션 코드입니다.", "SESSION_EXISTS");
        const body = await readJson(request, 16 * 1024);
        /* 조별 참가 코드는 4자리 숫자입니다 (JOIN_CODE).
           ★ 한 세션 안에서 겹치면 안 됩니다 — 겹치면 그 코드로 남의 조에 들어갑니다.
             코드를 뽑는 쪽에서 이미 막고 있지만, 진짜 관문은 여기입니다. */
        const claims = Array.isArray(body.teamClaims) ? body.teamClaims : [];
        const codes = new Set(claims.map((claim) => claim && claim.claimSecret));
        const validClaims = claims.length === body.teamCount &&
          codes.size === claims.length &&
          claims.every((claim, index) =>
            claim && claim.teamName === `${index + 1}조` &&
            typeof claim.claimSecret === "string" && JOIN_CODE.test(claim.claimSecret)
          );
        if (!SESSION_CODE.test(body.sessionId) || !/^\d{4}$/.test(body.pin) ||
            typeof body.facilitatorSecret !== "string" || body.facilitatorSecret.length < 24 ||
            !Number.isInteger(body.teamCount) || body.teamCount < 1 || body.teamCount > 6 || !validClaims) {
          throw new ApiError(400, "세션 생성 정보가 올바르지 않습니다.", "INVALID_SESSION");
        }
        const now = Date.now();
        const control = defaultControl();
        this.sql.exec(
          "INSERT INTO session (singleton, code, pin_hash, facilitator_hash, team_count, control_json, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
          body.sessionId,
          await sha256(body.pin),
          await sha256(body.facilitatorSecret),
          body.teamCount,
          JSON.stringify(control),
          now,
          now,
        );
        for (const claim of claims) {
          this.sql.exec(
            "INSERT INTO team_claims (name, claim_hash) VALUES (?, ?)",
            claim.teamName,
            await sha256(claim.claimSecret),
          );
        }
        await this.ctx.storage.setAlarm(now + SESSION_TTL_MS);
        return json({ session: { id: body.sessionId, teamCount: body.teamCount, createdAt: now, expiresAt: now + SESSION_TTL_MS }, control }, 201);
      }

      if (!session) throw new ApiError(404, "세션을 찾을 수 없습니다.", "SESSION_NOT_FOUND");

      if (action === "join") {
        if (request.method !== "POST") methodNotAllowed(["POST"]);
        const body = await readJson(request, 16 * 1024);

        /* 코드 참가 — 조 이름을 보내지 않습니다. 코드가 곧 조입니다.
           맞는 조를 찾지 못하면 어느 조가 있는지도 알려주지 않습니다. */
        if (Object.keys(body).length === 1 && typeof body.joinCode === "string") {
          const given = await sha256(body.joinCode.trim().toUpperCase());
          const rows = [...this.sql.exec("SELECT name, claim_hash FROM team_claims")];
          const hit = rows.filter((row) => row.claim_hash === given)[0];
          if (!hit) {
            throw new ApiError(403, "Session credentials are invalid.", "INVALID_JOIN_CREDENTIALS");
          }
          const already = this.first("SELECT name FROM teams WHERE name = ?", hit.name);
          if (already) {
            throw new ApiError(409, "This team is already joined on another browser.", "TEAM_ALREADY_JOINED");
          }
          const issued = randomSecret();
          const at = Date.now();
          this.sql.exec(
            "INSERT INTO teams (name, token_hash, snapshot_json, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)",
            hit.name,
            await sha256(issued),
            JSON.stringify(sanitizeSnapshot({}, hit.name)),
            at,
            at,
          );
          return json({
            session: { id: session.code, teamCount: session.team_count },
            teamName: hit.name,
            teamToken: issued,
            control: this.publicControl(session),
          });
        }

        const teamMatch = TEAM_NAME.exec(cleanText(body.teamName, 8));
        const allowedJoinKeys = new Set(["teamName", "pin", "claimSecret"]);
        if (!teamMatch || Number(teamMatch[1]) > session.team_count || Object.keys(body).some((key) => !allowedJoinKeys.has(key))) {
          throw new ApiError(400, "Team name is invalid.", "INVALID_JOIN");
        }
        const teamName = `${teamMatch[1]}조`;
        let token;
        const now = Date.now();
        const existing = this.first("SELECT name, token_hash FROM teams WHERE name = ?", teamName);
        if (existing) {
          if (Object.keys(body).some((key) => key !== "teamName")) {
            throw new ApiError(400, "Reconnect only accepts the team name.", "INVALID_JOIN");
          }
          let ownsTeam = false;
          try {
            token = bearerToken(request);
            ownsTeam = await sha256(token) === existing.token_hash;
          } catch {
            ownsTeam = false;
          }
          if (!ownsTeam) {
            throw new ApiError(409, "This team is already joined on another browser.", "TEAM_ALREADY_JOINED");
          }
          this.sql.exec("UPDATE teams SET last_seen = ? WHERE name = ?", now, teamName);
        } else {
          if (Object.keys(body).length !== 3) {
            throw new ApiError(403, "Session credentials are invalid.", "INVALID_JOIN_CREDENTIALS");
          }
          if (!/^\d{4}$/.test(String(body.pin || "")) || await sha256(String(body.pin)) !== session.pin_hash) {
            throw new ApiError(403, "Session credentials are invalid.", "INVALID_JOIN_CREDENTIALS");
          }
          if (typeof body.claimSecret !== "string" || !JOIN_CODE.test(body.claimSecret)) {
            throw new ApiError(403, "Session credentials are invalid.", "INVALID_JOIN_CREDENTIALS");
          }
          const claim = this.first("SELECT claim_hash FROM team_claims WHERE name = ?", teamName);
          if (!claim || await sha256(body.claimSecret) !== claim.claim_hash) {
            throw new ApiError(403, "Session credentials are invalid.", "INVALID_JOIN_CREDENTIALS");
          }
          token = randomSecret();
          this.sql.exec(
            "INSERT INTO teams (name, token_hash, snapshot_json, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)",
            teamName,
            await sha256(token),
            JSON.stringify(sanitizeSnapshot({}, teamName)),
            now,
            now,
          );
        }
        return json({ session: { id: session.code, teamCount: session.team_count }, teamName, teamToken: token, control: this.publicControl(session) });
      }

      if (action === "team") {
        if (request.method !== "PUT") methodNotAllowed(["PUT"]);
        const team = await this.requireTeam(request);
        const body = await readJson(request, MAX_JSON_BYTES);
        const now = Date.now();
        if (body.heartbeat === true && Object.keys(body).length === 1) {
          this.sql.exec("UPDATE teams SET last_seen = ? WHERE name = ?", now, team.name);
          return json({ ok: true, heartbeat: true, receivedAt: now, control: this.publicControl(session) });
        }
        const snapshot = sanitizeSnapshot(body, team.name);
        this.sql.exec("UPDATE teams SET snapshot_json = ?, last_seen = ? WHERE name = ?", JSON.stringify(snapshot), now, team.name);
        this.sql.exec("UPDATE session SET updated_at = ? WHERE singleton = 1", now);
        return json({ ok: true, receivedAt: now, control: this.publicControl(session) });
      }

      if (action === "snapshot") {
        if (request.method !== "GET") methodNotAllowed(["GET"]);
        await this.requireFacilitator(request, session);
        return json(this.publicSnapshot(session));
      }

      if (action === "control") {
        if (request.method !== "PUT") methodNotAllowed(["PUT"]);
        await this.requireFacilitator(request, session);
        const patch = await readJson(request, 16 * 1024);
        const control = sanitizeControlPatch(patch, this.publicControl(session));
        const now = Date.now();
        this.sql.exec("UPDATE session SET control_json = ?, updated_at = ? WHERE singleton = 1", JSON.stringify(control), now);
        return json({ control, updatedAt: now });
      }

      if (action === "team-reset") {
        if (request.method !== "PUT") methodNotAllowed(["PUT"]);
        await this.requireFacilitator(request, session);
        const body = await readJson(request, 16 * 1024);
        const teamMatch = TEAM_NAME.exec(cleanText(body.teamName, 8));
        if (!teamMatch || Number(teamMatch[1]) > session.team_count || Object.keys(body).length !== 1) {
          throw new ApiError(400, "Team name is invalid.", "INVALID_TEAM_RESET");
        }
        const teamName = `${teamMatch[1]}조`;
        this.sql.exec("DELETE FROM teams WHERE name = ?", teamName);
        this.sql.exec("UPDATE session SET updated_at = ? WHERE singleton = 1", Date.now());
        return json({ ok: true, teamName });
      }

      if (action === "delete") {
        if (request.method !== "DELETE") methodNotAllowed(["DELETE"]);
        await this.requireFacilitator(request, session);
        this.sql.exec("DELETE FROM teams; DELETE FROM team_claims; DELETE FROM session;");
        await this.ctx.storage.deleteAlarm();
        return json({ ok: true });
      }

      throw new ApiError(404, "API 경로를 찾을 수 없습니다.", "NOT_FOUND");
    } catch (error) {
      return apiErrorResponse(error);
    }
  }
}

async function gateAction(env, action, body) {
  const id = env.REQUEST_GATE.idFromName("global-live-session-gate");
  const response = await env.REQUEST_GATE.get(id).fetch(new Request(`https://gate.internal/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  if (!response.ok) throw new ApiError(503, "Live-session protection is temporarily unavailable.", "GATE_UNAVAILABLE");
  return response.json();
}

async function enforceRateLimits(env, request, rules) {
  const addressHash = (await sha256(clientAddress(request))).slice(0, 32);
  const payload = await gateAction(env, "consume", {
    rules: rules.map((rule) => ({
      key: rule.key.replace("{ip}", addressHash),
      limit: rule.limit,
      windowMs: rule.windowMs,
    })),
  });
  if (!payload.allowed) {
    throw new ApiError(429, "Too many requests. Please wait and try again.", "RATE_LIMITED", {
      "retry-after": String(payload.retryAfter || 60),
    });
  }
}

async function registerSession(env, sessionId, expiresAt) {
  await gateAction(env, "register", { sessionId, expiresAt });
}

async function sessionIsRegistered(env, sessionId) {
  const payload = await gateAction(env, "exists", { sessionId });
  return payload.exists === true;
}

async function unregisterSession(env, sessionId) {
  await gateAction(env, "remove", { sessionId });
}

async function forwardToSession(env, sessionId, action, request, body = undefined) {
  const id = env.GAME_SESSION.idFromName(sessionId);
  const stub = env.GAME_SESSION.get(id);
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");
  if (authorization) headers.set("authorization", authorization);
  if (body !== undefined || contentType) headers.set("content-type", "application/json");
  const init = { method: request.method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return stub.fetch(new Request(`https://session.internal/${action}`, init));
}

async function handleApi(request, env) {
  assertSameOrigin(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  const url = new URL(request.url);
  /* 진행 중인 세션이 하나뿐이면 그 코드를 알려줍니다.
     세션 코드를 알아도 조 코드가 없으면 못 들어옵니다 (join-fail 제한이 지킵니다). */
  if (url.pathname === "/api/session/current") {
    if (request.method !== "GET") methodNotAllowed(["GET"]);
    await enforceRateLimits(env, request, [
      { key: "current:ip:{ip}", limit: 60, windowMs: RATE_WINDOW_MS },
      { key: "current:global", limit: 3000, windowMs: RATE_WINDOW_MS },
    ]);
    const gate = env.REQUEST_GATE.get(env.REQUEST_GATE.idFromName("gate"));
    const res = await gate.fetch("https://gate/current", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const payload = await res.json();
    return json({ sessionId: payload.sessionId }, 200, corsHeaders(request));
  }

  if (url.pathname === "/api/session") {
    if (request.method !== "POST") methodNotAllowed(["POST"]);
    assertBrowserSameOrigin(request);
    await enforceRateLimits(env, request, [
      { key: "create:ip:{ip}", limit: 6, windowMs: 60 * 60 * 1000 },
      { key: "create:global", limit: 300, windowMs: 60 * 60 * 1000 },
    ]);
    const body = await readJson(request, 16 * 1024);
    const teamCount = body.teamCount ?? 6;
    if (!Number.isInteger(teamCount) || teamCount < 1 || teamCount > 6 || Object.keys(body).some((key) => key !== "teamCount")) {
      throw new ApiError(400, "teamCount는 1~6 정수여야 합니다.", "INVALID_TEAM_COUNT");
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = randomString(6);
      const pin = randomPin();
      const facilitatorSecret = randomSecret();
      /* 조마다 다른 4자리 숫자 코드. 진행자가 빔에 띄우고 각 조가 자기 것을 칩니다.
         링크는 하나뿐이고, 이 코드가 "그 조가 맞다"는 증명입니다.
         한 세션 안에서는 절대 겹치지 않게 뽑습니다. */
      const used = new Set();
      const teamClaims = Array.from({ length: teamCount }, (_, index) => {
        let code;
        do { code = randomPin(); } while (used.has(code));
        used.add(code);
        return { teamName: `${index + 1}조`, claimSecret: code };
      });
      const internal = await forwardToSession(env, sessionId, "create", request, {
        sessionId,
        pin,
        facilitatorSecret,
        teamCount,
        teamClaims,
      });
      if (internal.status === 409) continue;
      if (!internal.ok) return internal;
      const result = await internal.json();
      await registerSession(env, sessionId, result.session.expiresAt || Date.now() + SESSION_TTL_MS);
      return json({
        ...result,
        pin,
        facilitatorSecret,
        teamClaims: Object.fromEntries(teamClaims.map((claim) => [claim.teamName, claim.claimSecret])),
      }, 201, corsHeaders(request));
    }
    throw new ApiError(503, "세션 코드를 만들지 못했습니다. 잠시 후 다시 시도해주세요.", "SESSION_CODE_UNAVAILABLE");
  }

  const match = /^\/api\/session\/([A-HJ-NP-Z2-9]{6})\/(join|team|snapshot|control|team-reset)$/.exec(url.pathname);
  if (match) {
    const [, sessionId, action] = match;
    const allowedMethods = { join: "POST", team: "PUT", snapshot: "GET", control: "PUT", "team-reset": "PUT" };
    if (request.method !== allowedMethods[action]) methodNotAllowed([allowedMethods[action]]);
    if (action === "join") {
      assertBrowserSameOrigin(request);
      await enforceRateLimits(env, request, [
        { key: `join:ip:{ip}:${sessionId}`, limit: 60, windowMs: RATE_WINDOW_MS },
        { key: `join:session:${sessionId}`, limit: 600, windowMs: RATE_WINDOW_MS },
        { key: "join:global", limit: 3000, windowMs: RATE_WINDOW_MS },
      ]);
    }
    if (action === "team-reset") {
      await enforceRateLimits(env, request, [
        { key: `team-reset:ip:{ip}:${sessionId}`, limit: 20, windowMs: 60 * 60 * 1000 },
        { key: `team-reset:session:${sessionId}`, limit: 40, windowMs: 60 * 60 * 1000 },
      ]);
    }
    if (!await sessionIsRegistered(env, sessionId)) {
      throw new ApiError(404, "Session not found.", "SESSION_NOT_FOUND");
    }
    const response = await forwardToSession(env, sessionId, action, request);
    if (action === "join" && !response.ok) {
      try {
        await enforceRateLimits(env, request, [
          { key: `join-fail:ip:{ip}:${sessionId}`, limit: 10, windowMs: RATE_WINDOW_MS },
          { key: `join-fail:session:${sessionId}`, limit: 60, windowMs: RATE_WINDOW_MS },
        ]);
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          await response.body?.cancel();
          throw error;
        }
        console.error("Failed-join rate accounting unavailable", error);
      }
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of corsHeaders(request)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const deleteMatch = /^\/api\/session\/([A-HJ-NP-Z2-9]{6})$/.exec(url.pathname);
  if (deleteMatch) {
    if (request.method !== "DELETE") methodNotAllowed(["DELETE"]);
    const sessionId = deleteMatch[1];
    if (!await sessionIsRegistered(env, sessionId)) throw new ApiError(404, "Session not found.", "SESSION_NOT_FOUND");
    const response = await forwardToSession(env, sessionId, "delete", request);
    if (response.ok) await unregisterSession(env, sessionId);
    const headers = new Headers(response.headers);
    for (const [key, value] of corsHeaders(request)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  throw new ApiError(404, "API 경로를 찾을 수 없습니다.", "NOT_FOUND");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    /* 맨 주소는 진행자 화면입니다. 진행자가 먼저 여는 곳이기 때문입니다.
       참가 조는 진행자가 알려주는 /play 로 들어옵니다. */
    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/facilitator.html", url), request));
    }
    if (url.pathname === "/play" || url.pathname === "/play/") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        const response = apiErrorResponse(error);
        const headers = new Headers(response.headers);
        for (const [key, value] of corsHeaders(request)) headers.set(key, value);
        return new Response(response.body, { status: response.status, headers });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
