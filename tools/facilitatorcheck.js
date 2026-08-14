/* ============================================================
   facilitatorcheck.js — 진행자 화면과 연결 데이터 계약 검사

   실행: node tools/facilitatorcheck.js

   외부 패키지 없이 다음을 검사합니다.
     - 3개 ERA / 6개 국면의 ID·연도·상황 데이터
     - 시대가 흘러갈수록 커지는 선택과 정보량
     - 고정 / 조건부 돌발상황의 연결 규칙
     - 실제 DRB 비교 데이터와 Git index의 AI 이미지 blob
     - 진행자 화면의 자동 검증용 data-testid 계약
   ============================================================ */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let passCount = 0;
let failCount = 0;

function section(title) {
  console.log("\n" + "=".repeat(78));
  console.log(title);
  console.log("=".repeat(78));
}

function pass(message) {
  passCount += 1;
  console.log("OK   " + message);
}

function fail(message) {
  failCount += 1;
  console.error("실패 " + message);
}

function expect(condition, message) {
  if (condition) pass(message);
  else fail(message);
  return !!condition;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function functionSource(source, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("\\b(?:async\\s+)?function\\s+" + escaped + "\\s*\\(");
  const match = pattern.exec(source);
  if (!match) return "";
  const tail = source.slice(match.index + match[0].length);
  const next = /\n\s{2}(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

function sameList(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function loadData() {
  const sandbox = { window: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);

  [
    "data/config.js",
    "data/eras.js",
    "data/investments.js",
    "data/policies.js",
    "data/events.js",
    "data/rounds.js",
    "data/actual_drb.js",
    "data/competitors.js",
    "data/whatif.js",
    "data/global.js",
    "data/rivals.js",
    "js/engine.js"
  ].forEach(function (relativePath) {
    vm.runInContext(read(relativePath), sandbox, { filename: relativePath });
  });

  return sandbox.window;
}

function isGitIndexBlob(relativePath) {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "--stage", "--", relativePath],
      { cwd: ROOT, encoding: "utf8", windowsHide: true }
    ).trim();

    const entry = output.split(/\r?\n/).map(function (line) {
      const match = line.match(/^(\d{6}) ([0-9a-f]{40,64}) (\d)\t(.+)$/);
      if (!match) return null;
      return { mode: match[1], oid: match[2], stage: match[3], file: match[4] };
    }).filter(Boolean).filter(function (item) {
      return item.stage === "0" && item.file.replace(/\\/g, "/") === relativePath;
    })[0];

    if (!entry) return false;
    const type = execFileSync(
      "git",
      ["cat-file", "-t", entry.oid],
      { cwd: ROOT, encoding: "utf8", windowsHide: true }
    ).trim();
    return type === "blob";
  } catch (error) {
    return false;
  }
}

function briefingCount(briefing, eraId) {
  let count = 0;
  ["domestic", "global", "risk"].forEach(function (key) {
    const list = briefing && briefing[key];
    expect(Array.isArray(list) && list.length > 0,
      eraId + " briefing." + key + "가 비어 있지 않음");
    if (Array.isArray(list)) count += list.length;
  });
  return count;
}

function validCondition(condition, label, allInvestmentIds, stateKeys) {
  if (!condition || typeof condition !== "object") {
    fail(label + ": 조건 객체가 없음");
    return;
  }

  const allowedOps = [">=", ">", "<=", "<", "==", "!="];
  expect(isNonEmptyString(condition.field), label + ": field가 있음");
  expect(allowedOps.indexOf(condition.op) >= 0,
    label + ": 연산자 " + String(condition.op) + "가 유효함");
  expect(Object.prototype.hasOwnProperty.call(condition, "value"),
    label + ": 비교 value가 있음");

  if (!isNonEmptyString(condition.field)) return;
  const field = condition.field;
  if (field.indexOf("invest.") === 0 || field.indexOf("total.") === 0) {
    const investmentId = field.slice(field.indexOf(".") + 1);
    expect(allInvestmentIds.has(investmentId),
      label + ": 투자 참조 " + investmentId + "가 존재함");
    return;
  }

  const special = ["policy", "idleRate", "sites"];
  expect(special.indexOf(field) >= 0 || stateKeys.has(field),
    label + ": 상태 참조 " + field + "가 존재함");
}

function checkStructure(W) {
  section("1. ERA / 국면 구조");

  const eras = W.DRB_ERAS;
  const rounds = W.DRB_ROUNDS;
  const investments = W.DRB_INVESTMENTS;

  if (!expect(eras && typeof eras === "object", "DRB_ERAS가 정의됨")) return [];
  if (!expect(Array.isArray(rounds), "DRB_ROUNDS가 배열로 정의됨")) return [];
  if (!expect(investments && typeof investments === "object", "DRB_INVESTMENTS가 정의됨")) return [];

  expect(Object.keys(eras).length === 3, "ERA가 정확히 3개임");
  expect(rounds.length === 3, "라운드가 정확히 3개임");

  const timeline = [];
  const roundIds = new Set();
  const subroundIds = new Set();
  const usedEraIds = new Set();

  rounds.forEach(function (round, roundIndex) {
    const expectedRoundId = "r" + (roundIndex + 1);
    expect(round.id === expectedRoundId,
      "라운드 " + (roundIndex + 1) + " ID가 " + expectedRoundId + "임");
    expect(round.no === roundIndex + 1,
      round.id + " no가 순서와 일치함");
    expect(!roundIds.has(round.id), round.id + " ID가 중복되지 않음");
    roundIds.add(round.id);

    const era = eras[round.era];
    expect(!!era, round.id + "의 ERA " + round.era + "가 존재함");
    if (era) {
      expect(era.id === round.era, round.id + "의 ERA key/id가 일치함");
      usedEraIds.add(round.era);
    }

    expect(Array.isArray(round.subrounds) && round.subrounds.length === 2,
      round.id + "에 국면이 정확히 2개 있음");

    (round.subrounds || []).forEach(function (subround, subIndex) {
      const expectedSubroundId = round.id + "s" + (subIndex + 1);
      expect(subround.id === expectedSubroundId,
        round.id + " 국면 " + (subIndex + 1) + " ID가 " + expectedSubroundId + "임");
      expect(!subroundIds.has(subround.id), subround.id + " ID가 중복되지 않음");
      subroundIds.add(subround.id);

      expect(Number.isFinite(subround.year), subround.id + "의 year가 숫자임");
      expect(isNonEmptyString(subround.title), subround.id + "의 title이 있음");
      expect(subround.situation && typeof subround.situation === "object",
        subround.id + "의 situation이 있음");
      if (subround.situation) {
        expect(isNonEmptyString(subround.situation.title),
          subround.id + " situation.title이 있음");
        expect(isNonEmptyString(subround.situation.body),
          subround.id + " situation.body가 있음");
        expect(isNonEmptyString(subround.situation.image),
          subround.id + " situation.image가 있음");
        expect(isNonEmptyString(subround.situation.imageAlt),
          subround.id + " situation.imageAlt가 있음");
      }

      timeline.push({ round: round, era: era, subround: subround });
    });
  });

  expect(usedEraIds.size === 3, "3개 ERA가 라운드에 각각 연결됨");
  expect(timeline.length === 6, "전체 국면이 정확히 6개임");
  expect(timeline.slice(1).every(function (item, index) {
    return item.subround.year > timeline[index].subround.year;
  }), "6개 국면의 연도가 엄격히 증가함");

  section("2. 시대별 선택 복잡도");

  const investmentCounts = [];
  const briefingCounts = [];
  const visibilityValues = [];

  rounds.forEach(function (round) {
    const era = eras[round.era];
    if (!era) return;

    const set = investments[era.investSet];
    expect(Array.isArray(set), era.id + "의 투자 세트 " + era.investSet + "가 존재함");
    investmentCounts.push(Array.isArray(set) ? set.length : 0);

    if (Array.isArray(set)) {
      const ids = new Set();
      set.forEach(function (item) {
        expect(isNonEmptyString(item.id), era.id + " 투자 항목에 ID가 있음");
        expect(!ids.has(item.id), era.id + " 투자 ID " + item.id + "가 중복되지 않음");
        ids.add(item.id);
      });
      expect(set.filter(function (item) { return item.keepCash; }).length === 1,
        era.id + "에 현금 보유 항목이 하나임");
    }

    briefingCounts.push(briefingCount(era.briefing, era.id));
    expect(Number.isFinite(era.visibility), era.id + " visibility가 숫자임");
    visibilityValues.push(era.visibility);
  });

  expect(investmentCounts.length === 3 &&
    investmentCounts[0] === 6 && investmentCounts[1] === 8 && investmentCounts[2] === 10,
    "투자 항목 수가 6 < 8 < 10임");
  expect(briefingCounts.length === 3 && briefingCounts.slice(1).every(function (count, index) {
    return count > briefingCounts[index];
  }), "브리핑 정보량이 ERA마다 엄격히 증가함 (" + briefingCounts.join(" < ") + ")");
  expect(visibilityValues.length === 3 && visibilityValues.slice(1).every(function (value, index) {
    return value < visibilityValues[index];
  }), "전망 선명도가 ERA마다 엄격히 감소함 (" + visibilityValues.join(" > ") + ")");

  return timeline;
}

function checkEvents(W, timeline) {
  section("3. 고정 / 조건부 돌발상황");

  const events = W.DRB_EVENTS;
  const investments = W.DRB_INVESTMENTS;
  if (!expect(events && typeof events === "object", "DRB_EVENTS가 정의됨")) return;

  const allInvestmentIds = new Set();
  Object.keys(investments || {}).forEach(function (setId) {
    (investments[setId] || []).forEach(function (item) { allInvestmentIds.add(item.id); });
  });
  const stateKeys = new Set(Object.keys(W.DRBEngine.createState()));

  const referenced = new Map();
  timeline.forEach(function (item) {
    const eventId = item.subround.event;
    if (!eventId) return;
    referenced.set(eventId, (referenced.get(eventId) || 0) + 1);
    const event = events[eventId];
    expect(!!event, item.subround.id + "의 event " + eventId + "가 존재함");
    if (event) {
      expect(event.conditional !== true,
        item.subround.id + "가 참조한 " + eventId + "는 고정 event임");
    }
  });

  const eventIds = Object.keys(events);
  const conditionalIds = [];
  const fixedIds = [];

  eventIds.forEach(function (key) {
    const event = events[key];
    expect(event && event.id === key, "event key/id " + key + "가 일치함");
    if (!event) return;

    expect(isNonEmptyString(event.title), key + " title이 있음");
    expect(isNonEmptyString(event.headline), key + " headline이 있음");
    expect(isNonEmptyString(event.body), key + " body가 있음");
    expect(event.base && typeof event.base === "object", key + " base 충격이 있음");
    expect(Array.isArray(event.reactions), key + " reactions가 배열임");

    if (event.conditional === true) {
      conditionalIds.push(key);
      expect(!referenced.has(key), key + " 조건부 event가 국면에 고정 참조되지 않음");
      validCondition(event.trigger, key + ".trigger", allInvestmentIds, stateKeys);
    } else {
      fixedIds.push(key);
      expect(!event.trigger, key + " 고정 event에 trigger가 없음");
      expect(referenced.get(key) === 1, key + " 고정 event가 하나의 국면에 정확히 연결됨");
    }

    (event.reactions || []).forEach(function (reaction, index) {
      const label = key + ".reactions[" + index + "]";
      expect(isNonEmptyString(reaction.text), label + " text가 있음");
      expect(reaction.mod && typeof reaction.mod === "object", label + " mod가 있음");
      validCondition(reaction.when, label + ".when", allInvestmentIds, stateKeys);
    });
  });

  expect(fixedIds.length > 0, "고정 event가 적어도 하나 있음");
  expect(conditionalIds.length > 0, "조건부 event가 적어도 하나 있음");
}

function checkActualAndImages(W, timeline) {
  section("4. DRB 비교 / AI 이미지 Git index");

  const actuals = W.DRB_ACTUAL;
  if (!expect(actuals && typeof actuals === "object", "DRB_ACTUAL이 정의됨")) return;
  expect(Object.keys(actuals).length === 3, "DRB 비교 데이터가 ERA별로 3개임");

  const seenActualIds = new Set();
  const imagePaths = new Set();

  timeline.forEach(function (item) {
    if (item.subround.situation && isNonEmptyString(item.subround.situation.image)) {
      imagePaths.add(item.subround.situation.image.replace(/\\/g, "/"));
    }
  });

  W.DRB_ROUNDS.forEach(function (round) {
    expect(isNonEmptyString(round.actualId), round.id + " actualId가 있음");
    expect(!seenActualIds.has(round.actualId), round.actualId + "가 다른 ERA와 중복 연결되지 않음");
    seenActualIds.add(round.actualId);

    const actual = actuals[round.actualId];
    expect(!!actual, round.id + " actualId " + round.actualId + "가 존재함");
    if (!actual) return;

    expect(actual.id === round.actualId, round.id + " actual key/id가 일치함");
    expect(actual.roundId === round.id, round.id + "가 actual.roundId와 일치함");
    expect(actual.filled === true, round.id + " DRB 비교 데이터가 완성 상태임");
    ["year", "choice", "result", "note", "image", "imageAlt"].forEach(function (field) {
      expect(isNonEmptyString(actual[field]), round.id + " actual." + field + "가 있음");
    });
    if (isNonEmptyString(actual.image)) imagePaths.add(actual.image.replace(/\\/g, "/"));
  });

  Object.keys(actuals).forEach(function (actualId) {
    expect(seenActualIds.has(actualId), actualId + "가 어느 ERA에든 연결됨");
  });

  imagePaths.forEach(function (imagePath) {
    const normalized = path.posix.normalize(imagePath);
    const safePath = normalized === imagePath &&
      normalized.indexOf("assets/img/") === 0 &&
      !normalized.includes("..") &&
      /\.(?:png|jpe?g|webp)$/i.test(normalized);
    expect(safePath, imagePath + "가 assets/img 아래의 이미지 경로임");
    if (safePath) {
      expect(isGitIndexBlob(normalized), normalized + "가 Git index에 blob으로 존재함");
    }
  });
}

function checkFacilitatorMarkers() {
  section("5. 진행자 화면 자동 검증 마커");

  const htmlDocument = read("facilitator.html");
  const html = htmlDocument + "\n" + read("js/facilitator.js");
  expect(/<script\b[^>]*\bsrc\s*=\s*[\"']js\/facilitator\.js[\"'][^>]*>/i.test(htmlDocument),
    "facilitator.html loads js/facilitator.js");
  const requiredTestIds = [
    "fac-common-context",
    "fac-team-decision",
    "fac-event",
    "fac-event-reaction",
    "fac-actual-compare",
    "fac-spoiler-lock"
  ];

  requiredTestIds.forEach(function (testId) {
    const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("\\bdata-testid\\s*=\\s*[\\\"']" + escaped + "[\\\"']");
    expect(pattern.test(html), "facilitator.html에 data-testid=\"" + testId + "\"가 있음");
  });

  expect(/\bminTurns\b/.test(html),
    "facilitator.html에 가장 느린 조 기준 스포일러 잠금(minTurns)이 있음");
}

function checkResultCodeV3() {
  section("6. Result-code v3 export / facilitator import contract");

  const stateSource = functionSource(read("js/state.js"), "exportTeamCode");
  const facilitatorSource = functionSource(read("js/facilitator.js"), "normalizeHistory");

  expect(isNonEmptyString(stateSource), "js/state.js defines exportTeamCode");
  expect(/\bv\s*:\s*3\b/.test(stateSource), "result-code payload version is v: 3");
  expect(/\by\s*:\s*h\.year\b/.test(stateSource), "result-code history exports y");
  expect(/\bch\s*:\s*h\.choices\b/.test(stateSource), "result-code history exports ch");
  expect(/\bev\s*:\s*\(h\.report\.events\s*\|\|\s*\[\]\)\.map\b/.test(stateSource),
    "result-code history exports ev");

  expect(isNonEmptyString(facilitatorSource), "js/facilitator.js defines normalizeHistory");
  expect(/\bh\.y\b/.test(facilitatorSource), "facilitator consumes remote history h.y");
  expect(/\bh\.ch\b/.test(facilitatorSource), "facilitator consumes remote history h.ch");
  expect(/\bh\.ev\b/.test(facilitatorSource), "facilitator consumes remote history h.ev");
}

function checkParticipantAvailability(W, timeline) {
  section("7. Participant available investments by turn");

  const expectedCounts = [4, 6, 7, 8, 8, 10];
  const actualCounts = timeline.map(function (item) {
    const subroundIndex = item.round.subrounds.indexOf(item.subround);
    const items = W.DRB_INVESTMENTS[item.era.investSet] || [];
    return items.filter(function (investment) {
      return (Number(investment.unlockSubround) || 0) <= subroundIndex;
    }).length;
  });

  expect(sameList(actualCounts, expectedCounts),
    "availableInvestments counts are 4 -> 6 -> 7 -> 8 -> 8 -> 10 (actual " + actualCounts.join(" -> ") + ")");

  const stateSource = read("js/state.js");
  const availableSource = functionSource(stateSource, "availableInvestments");
  const uiSource = read("js/ui.js");
  expect(isNonEmptyString(availableSource), "js/state.js defines availableInvestments");
  expect(/\bunlockSubround\b/.test(availableSource) && /\.filter\s*\(/.test(availableSource),
    "availableInvestments filters by unlockSubround");
  expect(/\bavailableInvestments\s*:\s*availableInvestments\b/.test(stateSource),
    "DRBState exposes availableInvestments");
  expect(/S\.availableInvestments\s*\?\s*S\.availableInvestments\(\)/.test(uiSource),
    "participant investment UI uses availableInvestments");
}

function checkFacilitatorStages() {
  section("8. Facilitator stages / Worker CONTROL_STAGES");

  /* 참가자에게 공개되는 6단계. Worker 가 검증하는 목록과 정확히 같아야 합니다. */
  const expectedStages = ["briefing", "decisions", "event", "actual", "debrief", "map"];
  /* 시상은 진행자 화면에만 있는 7번째 탭입니다. 순위가 들어 있어
     참가자에게 절대 내보내지 않으므로 Worker 목록에는 없어야 합니다. */
  const facilitatorOnlyStages = ["intro", "howto", "phase", "standings", "award", "closing"];
  /* 탭 순서는 실제 진행 순서입니다 (진행자 전용 화면이 사이사이 끼어 있습니다) */
  const allTabStages = ["intro", "howto", "briefing", "decisions", "event", "phase",
                        "actual", "debrief", "map", "standings", "award", "closing"];
  const html = read("facilitator.html");
  const worker = read("worker.js");
  const tabStages = Array.from(html.matchAll(/\bdata-stage=[\"']([^\"']+)[\"']/g), function (match) {
    return match[1];
  });
  const panelStages = Array.from(html.matchAll(/\bdata-stage-panel=[\"']([^\"']+)[\"']/g), function (match) {
    return match[1];
  });
  const controlBlock = /const\s+CONTROL_STAGES\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/.exec(worker);
  const workerStages = controlBlock
    ? Array.from(controlBlock[1].matchAll(/[\"']([^\"']+)[\"']/g), function (match) { return match[1]; })
    : [];
  const workerFacilitatorStages = workerStages.filter(function (stage) {
    return stage !== "lobby" && stage !== "complete";
  });

  expect(sameList(tabStages, allTabStages), "facilitator tabs have the expected stages in order");
  expect(sameList(panelStages, allTabStages), "facilitator panels match the tabs in order");
  expect(!!controlBlock, "worker.js defines CONTROL_STAGES");
  expect(facilitatorOnlyStages.every(function (stage) { return workerStages.indexOf(stage) < 0; }),
    "facilitator-only stages are never accepted by the Worker (rankings must not reach participants)");
  expect(/LOCAL_STAGES\.indexOf\(stage\)\s*<\s*0/.test(read("js/facilitator.js")),
    "facilitator never publishes facilitator-only stages to participants");
  expect(sameList(workerFacilitatorStages, expectedStages),
    "Worker facilitator CONTROL_STAGES match the HTML stages");
  expect(workerStages[0] === "lobby" && workerStages[workerStages.length - 1] === "complete",
    "Worker CONTROL_STAGES begin with lobby and end with complete");
}

function checkLiveApi() {
  section("9. DRBLive API / snapshot schema contract");

  const live = read("js/live.js");
  const worker = read("worker.js");
  const createSource = functionSource(live, "create");
  const snapshotSource = functionSource(live, "snapshotFromState");
  const historySource = functionSource(live, "historyEntry");
  const stateViewSource = functionSource(live, "stateView");
  const apiBlock = /window\.DRBLive\s*=\s*Object\.freeze\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(live);

  expect(isNonEmptyString(createSource), "DRBLive defines create");
  ["sessionId", "pin", "facilitatorSecret", "teamCount", "raw"].forEach(function (field) {
    expect(new RegExp("\\b" + field + "\\s*:").test(createSource),
      "DRBLive.create return shape includes " + field);
  });

  expect(!!apiBlock, "window.DRBLive public API object exists");
  const apiSource = apiBlock ? apiBlock[1] : "";
  ["create", "snapshot", "snapshotFromState", "hasFacilitatorSession", "currentControl"].forEach(function (name) {
    expect(new RegExp("\\b" + name + "\\s*:\\s*" + name + "\\b").test(apiSource),
      "DRBLive API exposes " + name);
  });
  expect(/function\s+hasFacilitatorSession\s*\([^)]*\)\s*\{\s*return\s+!!facilitatorCredentials\(\)/.test(live),
    "hasFacilitatorSession returns facilitator credential presence");
  expect(/function\s+currentControl\s*\([^)]*\)\s*\{\s*return\s+latestControl\b/.test(live),
    "currentControl returns latestControl");

  expect(isNonEmptyString(snapshotSource), "DRBLive defines snapshotFromState");
  ["version", "teamName", "phase", "turnIndex", "state", "history"].forEach(function (field) {
    expect(new RegExp("\\b" + field + "\\s*:").test(snapshotSource),
      "live snapshot top level includes " + field);
  });
  expect(/\bstate\s*:\s*stateView\s*\(/.test(snapshotSource), "live snapshot state uses stateView");
  expect(/\bhistory\s*:[\s\S]*?\.map\s*\(\s*historyEntry\s*\)/.test(snapshotSource),
    "live snapshot history uses historyEntry");
  expect(/\bsites\s*:/.test(stateViewSource), "live snapshot state includes sites");

  const historyFields = [
    "turn", "roundId", "subroundId", "year", "title", "allocation", "policyId",
    "choices", "events", "kpi", "headline", "beforeCash", "afterCash"
  ];
  historyFields.forEach(function (field) {
    expect(new RegExp("\\b" + field + "\\s*:").test(historySource),
      "live snapshot history includes " + field);
  });
  expect(/\brevenue\s*:/.test(historySource) && /\bprofit\s*:/.test(historySource),
    "live snapshot history.kpi includes revenue and profit");

  const workerSnapshot = functionSource(worker, "sanitizeSnapshot");
  const workerHistory = functionSource(worker, "sanitizeHistoryEntry");
  ["version", "teamName", "phase", "turnIndex", "state", "history"].forEach(function (field) {
    expect(new RegExp("\\b" + field + "\\s*:").test(workerSnapshot),
      "Worker snapshot includes " + field);
  });
  historyFields.forEach(function (field) {
    expect(new RegExp("\\b" + field + "\\s*:").test(workerHistory),
      "Worker history includes " + field);
  });
}

function checkLiveIntegration() {
  section("10. Live integration wiring");

  const live = read("js/live.js");
  const mainSource = read("js/main.js");
  const participant = mainSource + "\n" + read("js/state.js");
  const facilitator = read("js/facilitator.js");
  const createSource = functionSource(live, "create");
  const publishSource = functionSource(mainSource, "publishLiveState");
  const commitSource = functionSource(mainSource, "commit");
  const afterResultSource = functionSource(mainSource, "afterResult");
  const afterActualSource = functionSource(mainSource, "afterActual");
  const bindSource = functionSource(facilitator, "bind");
  const normalizeSource = functionSource(facilitator, "normalizeHistory");

  expect(/DRBLive\.publishHook\s*\(/.test(publishSource) &&
    /\bS\.commitSubround\s*\([\s\S]*?\bpublishLiveState\s*\(\s*\)/.test(commitSource),
    "participant publishes state through DRBLive.publishHook");
  expect(/addEventListener\s*\(\s*[\"']drb-live-control[\"']/.test(participant),
    "participant listens for drb-live-control");
  expect(/\brevealedActual\b/.test(participant),
    "participant consumes facilitator revealedActual control");
  expect(/function\s+liveNextBriefingOpen\s*\(/.test(mainSource) &&
    /control\.stage\s*!==\s*["']lobby["']/.test(mainSource),
    "participant gates the next briefing against quoted lobby stage");
  expect(/liveNextBriefingOpen\s*\(\s*\)/.test(afterResultSource) &&
    /waitingBriefing\s*=\s*true/.test(afterResultSource),
    "afterResult waits before advancing to the next subround briefing");
  expect(/liveNextBriefingOpen\s*\(\s*\)/.test(afterActualSource) &&
    /waitingBriefing\s*=\s*true/.test(afterActualSource),
    "afterActual waits before advancing to the next era briefing");
  expect(/waitingBriefing\s*&&\s*liveNextBriefingOpen\s*\(\s*\)[\s\S]*?waitingBriefing\s*=\s*false[\s\S]*?S\.advance\s*\(\s*\)/.test(mainSource),
    "live control wake advances a waiting participant after briefing opens");
  expect(!/showScreen\s*\(\s*timelapse\s*\)/.test(mainSource) &&
    !/renderLiveWait\s*\(\s*briefing\s*\)/.test(mainSource),
    "live waiting calls do not contain bare identifiers");
  expect(/el\s*\(\s*["']btnNext["']\s*\)[\s\S]*?currentStage\s*=\s*["']briefing["'][\s\S]*?showStage\s*\(\s*["']briefing["']\s*,\s*true\s*\)/.test(bindSource),
    "facilitator next-turn action publishes the common briefing stage");

  expect(/\bh\.ev\b/.test(normalizeSource) && /\bh\.events\b/.test(normalizeSource),
    "facilitator normalizeHistory accepts result-code h.ev and live h.events");
  expect(/\bkpi\s*:\s*h\.kpi\b/.test(normalizeSource),
    "facilitator normalizeHistory wraps live top-level kpi into report.kpi");
  expect(/\bevents\s*:\s*events\b/.test(normalizeSource),
    "facilitator normalizeHistory wraps live events into report.events");

  expect(/\bpin\s*:\s*payload\.pin\b/.test(createSource.slice(0, createSource.indexOf("setStore"))),
    "DRBLive.create persists pin in facilitator credentials before storage");
}

function checkEraLearningCheckpoint() {
  section("11. ERA learning checkpoint input / button lock contract");

  const html = read("index.html");
  const mainSource = read("js/main.js");
  const uiSource = read("js/ui.js");
  const updateSource = functionSource(mainSource, "updateEraCheckpoint");
  const renderSource = functionSource(uiSource, "renderActual");
  const expectedInputs = ["acKept", "acTradeoff", "acLesson"];

  expect(/\bid=["']acCheckpoint["']/.test(html),
    "participant actual screen has ERA learning checkpoint marker");
  expectedInputs.forEach(function (id) {
    const tagMatch = new RegExp("<input\\b(?=[^>]*\\bid=[\\\"']" + id + "[\\\"'])[^>]*>", "i").exec(html);
    const tag = tagMatch ? tagMatch[0] : "";
    expect(isNonEmptyString(tag), "ERA checkpoint has input #" + id);
    expect(/\bmaxlength=["']80["']/.test(tag), "ERA checkpoint #" + id + " has an 80-character limit");
  });
  const checkpointInputMarkers = Array.from(html.matchAll(
    /<input\b(?=[^>]*\bid=["']ac(?:Kept|Tradeoff|Lesson)["'])[^>]*>/gi
  ));
  expect(checkpointInputMarkers.length === 3,
    "ERA checkpoint exposes exactly three required input markers");
  expect(/\bid=["']acCheckpointStatus["']/.test(html),
    "ERA checkpoint has completion status marker");
  expect(/<button\b(?=[^>]*\bid=["']btnActualGo["'])[^>]*>/.test(html),
    "ERA checkpoint has gated next-ERA button marker");

  expect(isNonEmptyString(updateSource), "participant defines updateEraCheckpoint");
  expectedInputs.forEach(function (id) {
    expect(new RegExp("el\\([\\\"']" + id + "[\\\"']\\)\\.value\\.trim\\(\\)").test(updateSource),
      "checkpoint update trims input #" + id);
  });
  expect(/t\.reflections\s*=\s*t\.reflections\s*\|\|\s*\{\}/.test(updateSource) &&
    /t\.reflections\s*\[\s*r\.id\s*\]\s*=\s*reflection/.test(updateSource),
    "checkpoint saves reflection by ERA id");
  expect(/reflection\.kept\s*&&\s*reflection\.tradeoff\s*&&\s*reflection\.lesson/.test(updateSource),
    "checkpoint completion requires all three inputs");
  expect(/el\(["']btnActualGo["']\)\.disabled\s*=\s*!ready/.test(updateSource),
    "checkpoint input update locks next-ERA button until complete");
  expect(/\bS\.save\s*\(\s*\)/.test(updateSource),
    "checkpoint input update persists the current ERA reflection");
  expect(/\[[^\]]*["']acKept["'][^\]]*["']acTradeoff["'][^\]]*["']acLesson["'][^\]]*\][\s\S]*?addEventListener\s*\(\s*["']input["']\s*,\s*updateEraCheckpoint\s*\)/.test(mainSource),
    "all three checkpoint inputs update the ERA lock on input");

  expect(isNonEmptyString(renderSource), "participant actual renderer restores ERA checkpoint state");
  expect(/t\.reflections\s*&&\s*t\.reflections\s*\[\s*r\.id\s*\]/.test(renderSource),
    "participant restores reflection for the current ERA id");
  expectedInputs.forEach(function (id) {
    expect(new RegExp("[\\\"']" + id + "[\\\"']").test(renderSource),
      "actual renderer restores checkpoint input #" + id);
  });
  expect(/reflection\.kept\s*&&\s*reflection\.tradeoff\s*&&\s*reflection\.lesson/.test(renderSource) &&
    /el\(["']btnActualGo["']\)\.disabled\s*=\s*!checkpointReady/.test(renderSource),
    "actual renderer reapplies the three-input next-ERA lock");
}

/* 조별 참가 코드는 "만드는 쪽"과 "받는 쪽"이 같은 모양을 써야 합니다.
   한쪽만 4자리 숫자로 바꿨더니 세션 생성이 전부 400 으로 떨어졌습니다.
   같은 일이 다시 생기지 않게 여기서 붙잡습니다. */
function checkJoinCodeShape() {
  section("12. 조별 참가 코드 — 만드는 쪽과 받는 쪽이 같은가");

  const worker = read("worker.js");
  const createSource = functionSource(worker, "handleApi") || worker;

  expect(/const\s+JOIN_CODE\s*=\s*\/\^\\d\{4\}\$\//.test(worker),
    "worker가 참가 코드를 4자리 숫자로 정의함 (JOIN_CODE)");
  expect(/claimSecret:\s*code/.test(worker) && /code\s*=\s*randomPin\(\)/.test(worker),
    "코드를 만들 때 randomPin() 4자리를 씁니다");
  expect(!/\[A-Za-z0-9_-\]\{43\}/.test(worker),
    "43자 옛 비밀키 검사가 남아 있지 않음 (남으면 세션 생성이 전부 400)");

  const doCreate = /if \(action === "create"\)([\s\S]*?)const now = Date\.now\(\);/.exec(worker);
  expect(!!doCreate && /JOIN_CODE\.test\(claim\.claimSecret\)/.test(doCreate[1]),
    "세션을 만들 때도 JOIN_CODE 로 검사함");
  expect(!!doCreate && /codes\.size === claims\.length/.test(doCreate[1]),
    "한 세션 안에서 조별 코드가 겹치지 않는지 검사함");
  expect(/JOIN_CODE\.test\(body\.claimSecret\)/.test(worker),
    "조가 들어올 때도 같은 JOIN_CODE 로 검사함");

  const live = read("js/live.js");
  expect(/\/\^\\d\{4\}\$\/\.test\(String\(claimSecret/.test(live),
    "참가자 화면도 4자리 숫자로 검사함");

  /* 글자만 맞춰보는 게 아니라 실제로 만들어서 실제 검사식에 넣어봅니다.
     worker.js 의 진짜 소스를 꺼내 돌리므로 한쪽만 바뀌면 여기서 터집니다. */
  const sandbox = { crypto: require("crypto").webcrypto, btoa: (s) => Buffer.from(s, "binary").toString("base64") };
  vm.createContext(sandbox);
  ["CODE_ALPHABET", "SESSION_CODE", "JOIN_CODE"].forEach((name) => {
    const line = new RegExp("^const " + name + " = .*$", "m").exec(worker);
    if (line) vm.runInContext(line[0], sandbox);
  });
  /* worker.js 의 함수는 최상위(들여쓰기 0)라 functionSource 로는 끝을 못 찾습니다.
     중괄호를 세어 그 함수만 잘라냅니다. */
  function topLevelFunction(source, name) {
    const start = new RegExp("^function\\s+" + name + "\\s*\\(", "m").exec(source);
    if (!start) return "";
    let i = source.indexOf("{", start.index);
    let depth = 0;
    for (let j = i; j < source.length; j += 1) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") { depth -= 1; if (depth === 0) return source.slice(start.index, j + 1); }
    }
    return "";
  }
  ["randomString", "randomPin", "randomSecret"].forEach((name) => {
    const src = topLevelFunction(worker, name);
    expect(!!src, "worker.js 에서 " + name + " 를 찾음");
    if (src) vm.runInContext(src, sandbox);
  });

  const made = vm.runInContext(`(() => {
    const teamCount = 4;
    const used = new Set();
    const teamClaims = Array.from({ length: teamCount }, (_, index) => {
      let code; do { code = randomPin(); } while (used.has(code)); used.add(code);
      return { teamName: (index + 1) + "조", claimSecret: code };
    });
    return { sessionId: randomString(6), pin: randomPin(), facilitatorSecret: randomSecret(), teamCount, teamClaims };
  })()`, sandbox);

  /* ★ 검사식을 여기 베껴 쓰면 의미가 없습니다 (베낀 쪽만 맞고 worker 는 틀릴 수 있음).
       worker.js 의 검사 코드를 그대로 잘라내 돌립니다. throw 만 깃발로 바꿉니다. */
  const guard = /const claims = Array\.isArray\(body\.teamClaims\)[\s\S]*?(?=const now = Date\.now\(\);)/.exec(worker);
  if (!expect(!!guard, "worker.js 의 세션 생성 검사 코드를 찾음")) return;
  const runnable = guard[0].replace(/throw new ApiError\([\s\S]*?\);/, "__rejected = true;");

  sandbox.body = made;
  sandbox.__rejected = false;
  try {
    vm.runInContext("(function(){ " + runnable + " })()", sandbox);
  } catch (error) {
    sandbox.__rejected = "오류: " + error.message;
  }

  expect(sandbox.__rejected === false,
    "실제로 만든 세션 정보가 worker.js 의 진짜 검사식을 통과함 (400 INVALID_SESSION 재발 방지)" +
    (sandbox.__rejected === false ? "" : " — " + sandbox.__rejected));
  expect(made.teamClaims.every((c) => /^\d{4}$/.test(c.claimSecret)),
    "만들어진 조별 코드가 전부 4자리 숫자임 — " + made.teamClaims.map((c) => c.claimSecret).join(" "));
}

function main() {
  const W = loadData();
  const timeline = checkStructure(W);
  checkEvents(W, timeline);
  checkActualAndImages(W, timeline);
  checkFacilitatorMarkers();
  checkResultCodeV3();
  checkParticipantAvailability(W, timeline);
  checkFacilitatorStages();
  checkLiveApi();
  checkLiveIntegration();
  checkEraLearningCheckpoint();
  checkJoinCodeShape();

  console.log("\n" + "=".repeat(78));
  console.log("facilitatorcheck: " + passCount + "건 통과 / " + failCount + "건 실패");
  console.log("=".repeat(78));

  if (failCount > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  fail("검사기 실행 오류: " + (error && error.stack ? error.stack : String(error)));
  process.exitCode = 1;
}
