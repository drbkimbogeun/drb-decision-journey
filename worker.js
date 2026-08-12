import { DurableObject } from "cloudflare:workers";

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

export class GameSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
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
    `);
  }

  first(query, ...bindings) {
    return [...this.sql.exec(query, ...bindings)][0] || null;
  }

  session() {
    return this.first("SELECT * FROM session WHERE singleton = 1");
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
        if (!SESSION_CODE.test(body.sessionId) || !/^\d{4}$/.test(body.pin) ||
            typeof body.facilitatorSecret !== "string" || body.facilitatorSecret.length < 24 ||
            !Number.isInteger(body.teamCount) || body.teamCount < 1 || body.teamCount > 6) {
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
        return json({ session: { id: body.sessionId, teamCount: body.teamCount, createdAt: now }, control }, 201);
      }

      if (!session) throw new ApiError(404, "세션을 찾을 수 없습니다.", "SESSION_NOT_FOUND");

      if (action === "join") {
        if (request.method !== "POST") methodNotAllowed(["POST"]);
        const body = await readJson(request, 16 * 1024);
        const teamMatch = TEAM_NAME.exec(cleanText(body.teamName, 8));
        if (!/^\d{4}$/.test(String(body.pin || "")) || !teamMatch || Number(teamMatch[1]) > session.team_count) {
          throw new ApiError(400, "PIN 또는 팀 이름 형식이 올바르지 않습니다.", "INVALID_JOIN");
        }
        if (await sha256(String(body.pin)) !== session.pin_hash) {
          throw new ApiError(403, "세션 PIN이 올바르지 않습니다.", "INVALID_PIN");
        }
        const teamName = `${teamMatch[1]}조`;
        const token = randomSecret();
        const now = Date.now();
        const existing = this.first("SELECT name FROM teams WHERE name = ?", teamName);
        if (existing) {
          this.sql.exec("UPDATE teams SET token_hash = ?, last_seen = ? WHERE name = ?", await sha256(token), now, teamName);
        } else {
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

      if (action === "delete") {
        if (request.method !== "DELETE") methodNotAllowed(["DELETE"]);
        await this.requireFacilitator(request, session);
        this.sql.exec("DELETE FROM teams; DELETE FROM session;");
        return json({ ok: true });
      }

      throw new ApiError(404, "API 경로를 찾을 수 없습니다.", "NOT_FOUND");
    } catch (error) {
      return apiErrorResponse(error);
    }
  }
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
  if (url.pathname === "/api/session") {
    if (request.method !== "POST") methodNotAllowed(["POST"]);
    const body = await readJson(request, 16 * 1024);
    const teamCount = body.teamCount ?? 6;
    if (!Number.isInteger(teamCount) || teamCount < 1 || teamCount > 6 || Object.keys(body).some((key) => key !== "teamCount")) {
      throw new ApiError(400, "teamCount는 1~6 정수여야 합니다.", "INVALID_TEAM_COUNT");
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = randomString(6);
      const pin = randomPin();
      const facilitatorSecret = randomSecret();
      const internal = await forwardToSession(env, sessionId, "create", request, {
        sessionId,
        pin,
        facilitatorSecret,
        teamCount,
      });
      if (internal.status === 409) continue;
      if (!internal.ok) return internal;
      const result = await internal.json();
      return json({ ...result, pin, facilitatorSecret }, 201, corsHeaders(request));
    }
    throw new ApiError(503, "세션 코드를 만들지 못했습니다. 잠시 후 다시 시도해주세요.", "SESSION_CODE_UNAVAILABLE");
  }

  const match = /^\/api\/session\/([A-HJ-NP-Z2-9]{6})\/(join|team|snapshot|control)$/.exec(url.pathname);
  if (match) {
    const [, sessionId, action] = match;
    const response = await forwardToSession(env, sessionId, action, request);
    const headers = new Headers(response.headers);
    for (const [key, value] of corsHeaders(request)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const deleteMatch = /^\/api\/session\/([A-HJ-NP-Z2-9]{6})$/.exec(url.pathname);
  if (deleteMatch) {
    if (request.method !== "DELETE") methodNotAllowed(["DELETE"]);
    const response = await forwardToSession(env, deleteMatch[1], "delete", request);
    const headers = new Headers(response.headers);
    for (const [key, value] of corsHeaders(request)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  throw new ApiError(404, "API 경로를 찾을 수 없습니다.", "NOT_FOUND");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
