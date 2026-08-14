(function () {
  "use strict";

  var VERSION = 1;
  var HEARTBEAT_MS = 15000;
  var TEAM_KEY = "drb.live.team.v1";
  var FACILITATOR_KEY = "drb.live.facilitator.v1";
  var META_KEY = "drb.live.last-session.v1";
  var heartbeatTimer = null;
  var publishInFlight = null;
  var latestSnapshot = null;
  var latestControl = null;

  function getStore(store, key) {
    try {
      var value = store.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function setStore(store, key, value) {
    try {
      if (value == null) store.removeItem(key);
      else store.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Storage may be unavailable in hardened/private browser contexts.
    }
  }

  function base64UrlEncode(value) {
    var bytes = new TextEncoder().encode(value);
    var binary = "";
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    var normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    var binary = atob(normalized);
    var bytes = Uint8Array.from(binary, function (ch) { return ch.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }

  function validFacilitatorCredentials(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(value.sessionId || "") ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.facilitatorSecret || "") ||
        !/^\d{4}$/.test(String(value.pin || "")) ||
        !Number.isInteger(value.teamCount) || value.teamCount < 1 || value.teamCount > 6 ||
        !value.teamClaims || typeof value.teamClaims !== "object" || Array.isArray(value.teamClaims)) return false;
    /* 조별 참가 코드 — 숫자 4자리 */
    for (var index = 1; index <= value.teamCount; index += 1) {
      if (!/^\d{4}$/.test(value.teamClaims[index + "조"] || "")) return false;
    }
    return true;
  }

  function cleanText(value, limit) {
    return typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
      : "";
  }

  function cleanId(value, limit) {
    var text = cleanText(value, limit || 48);
    return /^[\w.:-]+$/u.test(text) ? text : "";
  }

  function integer(value, min, max, fallback) {
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }

  function cleanMap(value, limit) {
    var result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.keys(value).slice(0, limit || 20).forEach(function (rawKey) {
      var key = cleanId(rawKey, 48);
      var item = value[rawKey];
      if (!key) return;
      if (typeof item === "number" && Number.isFinite(item)) result[key] = Math.max(-100000, Math.min(100000, item));
      else if (typeof item === "boolean") result[key] = item;
      else if (typeof item === "string") result[key] = cleanText(item, 180);
    });
    return result;
  }

  function reaction(value) {
    if (typeof value === "string") return { text: cleanText(value, 240) };
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var output = {
      id: cleanId(value.id, 48),
      text: cleanText(value.text || value.label || value.body, 240),
      effect: cleanText(value.effect || value.result, 240),
    };
    if (typeof value.positive === "boolean") output.positive = value.positive;
    return output;
  }

  function eventEntry(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var source = Array.isArray(value.reactions)
      ? value.reactions
      : value.reaction == null
        ? []
        : [value.reaction];
    return {
      id: cleanId(value.id, 48),
      title: cleanText(value.title || value.name, 120),
      body: cleanText(value.body || value.description || value.message, 600),
      effect: cleanText(value.effect || value.result, 300),
      reactions: source.slice(0, 8).map(reaction).filter(Boolean),
    };
  }

  function allocationMap(value) {
    var result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.keys(value).slice(0, 20).forEach(function (rawKey) {
      var key = cleanId(rawKey, 48);
      var amount = Number(value[rawKey]);
      if (key && Number.isFinite(amount)) result[key] = Math.max(0, Math.min(20, Math.round(amount)));
    });
    return result;
  }

  function decisionChoices(value) {
    var result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.keys(value).slice(0, 20).forEach(function (rawKey) {
      var key = cleanId(rawKey, 48);
      var raw = value[rawKey];
      if (!key || !raw || typeof raw !== "object" || Array.isArray(raw)) return;
      var where = cleanId(raw.where || raw.location || raw.country, 64);
      var how = cleanId(raw.how || raw.mode, 64);
      if (where || how) result[key] = { where: where, how: how };
    });
    return result;
  }

  function siteEntry(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      country: cleanId(value.country, 64),
      countryName: cleanText(value.countryName, 100),
      mode: cleanId(value.mode, 64),
      modeName: cleanText(value.modeName, 100),
      scale: Number.isFinite(Number(value.scale)) ? Math.max(0, Math.min(100000, Number(value.scale))) : 0,
      stage: cleanId(value.stage, 32),
      dueTurn: integer(value.dueTurn, 0, 12, 0),
      since: integer(value.since, 0, 12, 0),
    };
  }

  function stateView(value) {
    var source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return { sites: (Array.isArray(source.sites) ? source.sites : []).slice(0, 24).map(siteEntry).filter(Boolean) };
  }

  function historyEntry(value, index) {
    value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    var report = value.report && typeof value.report === "object" ? value.report : {};
    var eventSource = Array.isArray(value.events)
      ? value.events
      : Array.isArray(report.events)
        ? report.events
        : [];
    var rawKpi = value.kpi && typeof value.kpi === "object" ? value.kpi : (report.kpi || {});
    var revenue = Number(rawKpi.revenue);
    var profit = Number(rawKpi.profit);
    var beforeCash = Number(value.beforeCash == null ? value.before && value.before.cash : value.beforeCash);
    var afterCash = Number(value.afterCash == null ? value.after && value.after.cash : value.afterCash);
    return {
      turn: integer(value.turn == null ? value.turnIndex : value.turn, 0, 5, index),
      roundId: cleanId(value.roundId || value.eraId || (value.round && value.round.id), 48),
      subroundId: cleanId(value.subroundId || value.subId || (value.subround && value.subround.id), 48),
      year: integer(value.year, 1900, 2100, 0),
      title: cleanText(value.title || value.subTitle, 160),
      allocation: allocationMap(value.allocation || value.allocations),
      policyId: cleanId(value.policyId, 64),
      choices: decisionChoices(value.choices),
      events: eventSource.slice(0, 8).map(eventEntry).filter(Boolean),
      kpi: {
        revenue: Number.isFinite(revenue) ? Math.max(-100000, Math.min(100000, revenue)) : 0,
        profit: Number.isFinite(profit) ? Math.max(-100000, Math.min(100000, profit)) : 0,
      },
      headline: cleanText(value.headline || report.headline, 500),
      beforeCash: Number.isFinite(beforeCash) ? Math.max(-100000, Math.min(100000, beforeCash)) : 0,
      afterCash: Number.isFinite(afterCash) ? Math.max(-100000, Math.min(100000, afterCash)) : 0,
    };
  }

  function teamCredentials() {
    return getStore(window.localStorage, TEAM_KEY);
  }

  function facilitatorCredentials() {
    return getStore(window.sessionStorage, FACILITATOR_KEY);
  }

  function snapshotFromState(data, teamName) {
    data = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    var stored = teamCredentials();
    var resolvedTeam = cleanText(teamName || (stored && stored.teamName) || data.activeTeam || data.teamName || data.name, 8);
    var team = data;
    if (data.teams && typeof data.teams === "object" && !Array.isArray(data.teams)) {
      team = data.teams[resolvedTeam] || data.teams[data.activeTeam] || {};
      resolvedTeam = cleanText(resolvedTeam || team.name || data.activeTeam, 8);
    }
    var historySource = Array.isArray(team.history) ? team.history : [];
    return {
      version: VERSION,
      teamName: resolvedTeam,
      phase: cleanId(team.phase || data.phase || data.screen || data.currentScreen, 32) || "connected",
      turnIndex: integer(team.turnIndex == null ? data.turnIndex : team.turnIndex, 0, 6, historySource.length),
      state: stateView(team.state || data.state),
      history: historySource.slice(-6).map(historyEntry),
      /* 저장본은 finalReflection, 스냅샷은 reflection 입니다. 둘 다 받아서
         스냅샷을 한 번 더 통과시켜도 값이 살아남게 합니다. */
      reflection: reflectionView(team.finalReflection || team.reflection),
    };
  }

  /* 마지막에 조가 한 번 적는 회고. 진행자 빔에서 조별로 나란히 띄웁니다.
     picks 는 "다시 한다면 바꾸겠다" 고 고른 결정 id 들이고 comment 만 자유 입력입니다.
     여기서 자르지만 진짜 관문은 Worker 입니다 — 같은 규칙으로 다시 자릅니다. */
  function reflectionView(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var picks = [];
    (Array.isArray(value.picks) ? value.picks.slice(0, 24) : []).forEach(function (raw) {
      var id = cleanId(raw, 48);
      if (id && picks.indexOf(id) < 0 && picks.length < 12) picks.push(id);
    });
    var comment = cleanText(value.comment, 200);
    return (picks.length || comment) ? { picks: picks, comment: comment } : null;
  }
  function emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (_) {
      // IE-style fallback is intentionally omitted; supported training browsers expose CustomEvent.
    }
  }

  async function api(path, options) {
    options = options || {};
    var headers = new Headers(options.headers || {});
    headers.set("accept", "application/json");
    if (options.body != null) headers.set("content-type", "application/json");
    var response = await fetch(path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
    var payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    if (!response.ok) {
      var message = payload && payload.error && payload.error.message
        ? payload.error.message
        : "실시간 세션 요청에 실패했습니다.";
      var error = new Error(message);
      error.status = response.status;
      error.code = payload && payload.error ? payload.error.code : "REQUEST_FAILED";
      throw error;
    }
    return payload;
  }

  function authHeader(token) {
    return { authorization: "Bearer " + token };
  }

  function normalizeSessionId(value) {
    var sessionId = cleanText(value, 6).toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(sessionId)) throw new Error("세션 코드는 6자리입니다.");
    return sessionId;
  }

  function stopHeartbeat() {
    if (heartbeatTimer != null) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (!teamCredentials()) return;
    heartbeatTimer = window.setInterval(function () {
      var credentials = teamCredentials();
      if (!credentials || document.visibilityState === "hidden") return;
      api("/api/session/" + credentials.sessionId + "/team", {
        method: "PUT",
        headers: authHeader(credentials.teamToken),
        body: { heartbeat: true },
      }).then(function (payload) {
        latestControl = payload.control || latestControl;
        emit("drb-live-control", payload.control);
        emit("drb-live-status", { connected: true, role: "team", receivedAt: payload.receivedAt });
      }).catch(function (error) {
        emit("drb-live-status", { connected: false, error: error });
      });
    }, HEARTBEAT_MS);
  }

  async function create(options) {
    var teamCount = typeof options === "number" ? options : options && options.teamCount;
    if (teamCount == null) teamCount = 6;
    /* 경쟁사 수는 조마다 같아야 합니다 — 다르면 같은 결정에도 매출이 갈립니다.
       그래서 세션에 실어 보내고, 각 조는 참가할 때 그 값을 받아 씁니다. */
    var rivalCount = options && options.rivalCount != null ? options.rivalCount : 3;
    var payload = await api("/api/session", {
      method: "POST",
      body: { teamCount: teamCount, rivalCount: rivalCount },
    });
    var credentials = {
      sessionId: payload.session.id,
      facilitatorSecret: payload.facilitatorSecret,
      pin: payload.pin,
      teamClaims: payload.teamClaims || {},
      teamCount: payload.session.teamCount,
      rivalCount: payload.session.rivalCount,
    };
    setStore(window.sessionStorage, FACILITATOR_KEY, credentials);
    setStore(window.localStorage, META_KEY, { sessionId: credentials.sessionId, role: "facilitator" });
    emit("drb-live-status", { connected: true, role: "facilitator", sessionId: credentials.sessionId });
    return {
      sessionId: credentials.sessionId,
      pin: payload.pin,
      facilitatorSecret: credentials.facilitatorSecret,
      teamClaims: credentials.teamClaims,
      teamCount: credentials.teamCount,
      rivalCount: credentials.rivalCount,
      raw: payload,
    };
  }

  async function join(sessionId, pin, teamName, claimSecret) {
    if (sessionId && typeof sessionId === "object") {
      claimSecret = sessionId.claimSecret;
      teamName = sessionId.teamName;
      pin = sessionId.pin;
      sessionId = sessionId.sessionId;
    }
    sessionId = normalizeSessionId(sessionId);
    teamName = cleanText(teamName, 8);
    if (!/^[1-6]조$/u.test(teamName)) throw new Error("팀 이름은 1조~6조 형식이어야 합니다.");
    var prior = teamCredentials();
    var reconnecting = prior && prior.sessionId === sessionId && prior.teamName === teamName && prior.teamToken;
    if (!reconnecting && !/^\d{4}$/.test(String(pin || ""))) throw new Error("PIN은 4자리 숫자입니다.");
    if (!reconnecting && !/^\d{4}$/.test(String(claimSecret || ""))) throw new Error("이 조의 참가 코드가 필요합니다.");
    var joinHeaders = reconnecting
      ? authHeader(prior.teamToken)
      : {};
    var joinBody = { teamName: teamName };
    if (!reconnecting) {
      joinBody.pin = String(pin);
      joinBody.claimSecret = String(claimSecret);
    }
    var payload = await api("/api/session/" + sessionId + "/join", {
      method: "POST",
      headers: joinHeaders,
      body: joinBody,
    });
    var credentials = { sessionId: sessionId, teamName: payload.teamName, teamToken: payload.teamToken };
    setStore(window.localStorage, TEAM_KEY, credentials);
    setStore(window.localStorage, META_KEY, { sessionId: sessionId, role: "team", teamName: payload.teamName });
    latestSnapshot = snapshotFromState({}, payload.teamName);
    startHeartbeat();
    latestControl = payload.control || latestControl;
    emit("drb-live-control", payload.control);
    emit("drb-live-status", { connected: true, role: "team", sessionId: sessionId, teamName: payload.teamName });
    payload.teamCount = payload.session && payload.session.teamCount;
    payload.rivalCount = payload.session && payload.session.rivalCount;
    return payload;
  }


  /* ============================================================
     참가 코드로 들어가기

     진행자는 링크 하나(?s=세션코드)와 조별 코드표만 알려줍니다.
     각 조가 자기 코드를 넣으면 그 조로 들어갑니다.
     ============================================================ */
  async function joinWithCode(code) {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get("s") || params.get("session");

    /* 주소에 세션이 없으면(맨 주소로 들어온 경우) 지금 열려 있는 교육을 찾습니다.
       진행 중인 세션이 하나뿐일 때만 알려줍니다. */
    if (!sessionId) {
      var found = await api("/api/session/current", { method: "GET" });
      sessionId = found && found.sessionId;
      if (!sessionId) {
        throw new Error("진행 중인 교육을 찾지 못했습니다. 진행자가 세션을 만들었는지 확인해주세요.");
      }
    }

    sessionId = normalizeSessionId(sessionId);
    code = String(code || "").trim();
    if (!/^\d{4}$/.test(code)) {
      throw new Error("코드는 숫자 4자리입니다. 진행자 화면의 우리 조 코드를 확인하세요.");
    }

    /* 새로고침으로 돌아온 경우에는 갖고 있던 토큰으로 다시 붙습니다 */
    var prior = teamCredentials();
    if (prior && prior.sessionId === sessionId && prior.teamToken) {
      try {
        var back = await api("/api/session/" + sessionId + "/join", {
          method: "POST",
          headers: authHeader(prior.teamToken),
          body: { teamName: prior.teamName },
        });
        return afterJoin(sessionId, back);
      } catch (e) { /* 안 되면 아래에서 코드로 새로 들어갑니다 */ }
    }

    var payload = await api("/api/session/" + sessionId + "/join", {
      method: "POST",
      body: { joinCode: code },
    });
    return afterJoin(sessionId, payload);
  }

  function afterJoin(sessionId, payload) {
    var credentials = { sessionId: sessionId, teamName: payload.teamName, teamToken: payload.teamToken };
    setStore(window.localStorage, TEAM_KEY, credentials);
    setStore(window.localStorage, META_KEY, { sessionId: sessionId, role: "team", teamName: payload.teamName });
    latestSnapshot = snapshotFromState({}, payload.teamName);
    startHeartbeat();
    latestControl = payload.control || latestControl;
    emit("drb-live-control", payload.control);
    emit("drb-live-status", { connected: true, role: "team", sessionId: sessionId, teamName: payload.teamName });
    payload.teamCount = payload.session && payload.session.teamCount;
    payload.rivalCount = payload.session && payload.session.rivalCount;
    return payload;
  }

  async function joinFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var secrets = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    var sessionId = params.get("session");
    var pin = secrets.get("pin") || params.get("pin");
    var teamName = params.get("team");
    var claimSecret = secrets.get("claim") || params.get("claim");
    var prior = teamCredentials();
    if (!sessionId || !teamName) return null;
    var reconnecting = prior && prior.sessionId === normalizeSessionId(sessionId) && prior.teamName === cleanText(teamName, 8);
    if (!reconnecting && (!pin || !claimSecret)) return null;
    var joined = await join(sessionId, pin, teamName, claimSecret);
    if (window.location.hash && window.history && window.history.replaceState) {
      window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
    }
    return joined;
  }

  async function publish(data, teamName) {
    var credentials = teamCredentials();
    if (!credentials) throw new Error("먼저 실시간 세션에 팀으로 참가해주세요.");
    var prepared = data && data.version === VERSION && Array.isArray(data.history)
      ? snapshotFromState(data, teamName || credentials.teamName)
      : snapshotFromState(data || {}, teamName || credentials.teamName);
    latestSnapshot = prepared;
    if (publishInFlight) return publishInFlight;
    publishInFlight = api("/api/session/" + credentials.sessionId + "/team", {
      method: "PUT",
      headers: authHeader(credentials.teamToken),
      body: prepared,
    }).then(function (payload) {
      latestControl = payload.control || latestControl;
      emit("drb-live-control", payload.control);
      emit("drb-live-status", { connected: true, role: "team", receivedAt: payload.receivedAt });
      return payload;
    }).finally(function () {
      publishInFlight = null;
    });
    return publishInFlight;
  }

  function publishHook(data, teamName) {
    latestSnapshot = snapshotFromState(data || {}, teamName);
    if (!teamCredentials()) return Promise.resolve({ queued: true, connected: false });
    /* ★ 만들어둔 스냅샷이 아니라 원본 상태를 넘깁니다.
       스냅샷을 다시 snapshotFromState 에 넣으면 이름이 바뀌는 필드가 사라집니다
       (finalReflection → reflection). 실제로 회고가 그렇게 통째로 없어졌습니다. */
    return publish(data, teamName);
  }

  async function snapshot() {
    var credentials = facilitatorCredentials();
    if (!credentials) throw new Error("이 브라우저에 진행자 세션 인증 정보가 없습니다.");
    var payload = await api("/api/session/" + credentials.sessionId + "/snapshot", {
      headers: authHeader(credentials.facilitatorSecret),
    });
    emit("drb-live-snapshot", payload);
    return payload;
  }

  async function control(patch) {
    var credentials = facilitatorCredentials();
    if (!credentials) throw new Error("이 브라우저에 진행자 세션 인증 정보가 없습니다.");
    var payload = await api("/api/session/" + credentials.sessionId + "/control", {
      method: "PUT",
      headers: authHeader(credentials.facilitatorSecret),
      body: patch,
    });
    latestControl = payload.control || latestControl;
    emit("drb-live-control", payload.control);
    return payload;
  }

  async function resetTeam(teamName) {
    var credentials = facilitatorCredentials();
    if (!credentials) throw new Error("이 브라우저에 진행자 세션 인증 정보가 없습니다.");
    teamName = cleanText(teamName, 8);
    if (!/^[1-6]조$/u.test(teamName)) throw new Error("초기화할 조 이름이 올바르지 않습니다.");
    return api("/api/session/" + credentials.sessionId + "/team-reset", {
      method: "PUT",
      headers: authHeader(credentials.facilitatorSecret),
      body: { teamName: teamName },
    });
  }

  function facilitatorRecoveryLink() {
    var credentials = facilitatorCredentials();
    if (!validFacilitatorCredentials(credentials)) throw new Error("진행자 복구 정보를 만들 수 없습니다.");
    var base = window.location.origin + window.location.pathname;
    return base + "#recover=" + base64UrlEncode(JSON.stringify(credentials));
  }

  function restoreFacilitatorFromUrl() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    var encoded = params.get("recover");
    if (!encoded) return null;
    try {
      if (!/^[A-Za-z0-9_-]{80,4096}$/.test(encoded)) throw new Error("format");
      var credentials = JSON.parse(base64UrlDecode(encoded));
      if (!validFacilitatorCredentials(credentials)) throw new Error("credentials");
      setStore(window.sessionStorage, FACILITATOR_KEY, credentials);
      setStore(window.localStorage, META_KEY, { sessionId: credentials.sessionId, role: "facilitator" });
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
      }
      emit("drb-live-status", { connected: true, role: "facilitator", sessionId: credentials.sessionId, recovered: true });
      return { sessionId: credentials.sessionId, teamCount: credentials.teamCount };
    } catch (_) {
      throw new Error("진행자 복구 링크가 올바르지 않습니다.");
    }
  }

  async function leave(options) {
    options = options || {};
    var facilitator = facilitatorCredentials();
    if (options.destroy === true && facilitator) {
      await api("/api/session/" + facilitator.sessionId, {
        method: "DELETE",
        headers: authHeader(facilitator.facilitatorSecret),
      });
    }
    stopHeartbeat();
    latestSnapshot = null;
    publishInFlight = null;
    setStore(window.localStorage, TEAM_KEY, null);
    setStore(window.sessionStorage, FACILITATOR_KEY, null);
    setStore(window.localStorage, META_KEY, null);
    emit("drb-live-status", { connected: false });
    return { ok: true };
  }

  function hasFacilitatorSession() { return !!facilitatorCredentials(); }
  function currentControl() { return latestControl; }

  function credentials() {
    var facilitator = facilitatorCredentials();
    var team = teamCredentials();
    if (facilitator) return { role: "facilitator", sessionId: facilitator.sessionId, teamCount: facilitator.teamCount };
    if (team) return { role: "team", sessionId: team.sessionId, teamName: team.teamName };
    return null;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && teamCredentials()) {
      startHeartbeat();
      if (latestSnapshot) publish(latestSnapshot).catch(function () {});
    }
  });

  /* 기존 인증 정보만으로는 네트워크 요청을 시작하지 않습니다. 새 링크로 명시적으로 참가했을 때 join()이 heartbeat를 시작합니다. */

  window.DRBLive = Object.freeze({
    create: create,
    join: join,
    joinFromUrl: joinFromUrl,
    joinWithCode: joinWithCode,
    publish: publish,
    publishHook: publishHook,
    snapshot: snapshot,
    control: control,
    resetTeam: resetTeam,
    facilitatorRecoveryLink: facilitatorRecoveryLink,
    restoreFacilitatorFromUrl: restoreFacilitatorFromUrl,
    leave: leave,
    snapshotFromState: snapshotFromState,
    facilitatorCredentials: facilitatorCredentials,
    hasFacilitatorSession: hasFacilitatorSession,
    currentControl: currentControl,
    credentials: credentials,
  });
}());
