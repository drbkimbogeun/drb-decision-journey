/* ============================================================
   getmusic.js — 배경음악 자동으로 받아오기

   실행 :  node tools/getmusic.js
   결과 :  assets/audio/bgm.mp3 · assets/audio/tense.mp3

   Openverse(openverse.org) 에서 CC0 음악만 골라 받습니다.
   CC0 = 저작권을 완전히 포기한 것. 출처 표시도 필요 없습니다.

   ⚠ 인터넷이 되는 PC에서 실행하세요. 한 번만 하면 됩니다.
   ⚠ 받은 뒤에는 반드시 직접 들어보세요. 자동으로 고른 것이라
     교육장에 어울리지 않을 수 있습니다.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const https = require("https");

const OUT = path.join(__dirname, "..", "assets", "audio");
const API = "https://api.openverse.org/v1/audio/";

/* 무엇을 찾을지 — 마음에 안 들면 이 검색어만 바꾸세요 */
const WANTED = [
  {
    file: "bgm.mp3",
    label: "평상시 배경음악",
    query: "calm ambient piano loop",
    maxSeconds: 300
  },
  {
    file: "tense.mp3",
    label: "돌발상황 음악",
    query: "tense suspense drums loop",
    maxSeconds: 180
  }
];

function get(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("리다이렉트가 너무 많습니다"));
    https.get(url, { headers: { "User-Agent": "DRB-Onboarding-Game/1.0" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode + " — " + url));
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

async function search(item) {
  const url = API + "?" + new URLSearchParams({
    q: item.query,
    license: "cc0",
    category: "music",
    page_size: "20"
  });
  const raw = await get(url);
  const data = JSON.parse(raw.toString("utf8"));
  const results = data.results || [];

  /* 너무 긴 곡·받을 수 없는 곡은 거릅니다 */
  return results.filter(r => {
    if (!r.url) return false;
    const sec = (r.duration || 0) / 1000;
    return sec === 0 || sec <= item.maxSeconds;
  });
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  console.log("=".repeat(66));
  console.log("배경음악 받아오기 — Openverse · CC0 만");
  console.log("=".repeat(66));

  for (const item of WANTED) {
    const dest = path.join(OUT, item.file);
    if (fs.existsSync(dest)) {
      console.log(`건너뜀  ${item.file} — 이미 있습니다 (지우고 다시 실행하면 새로 받습니다)`);
      continue;
    }

    process.stdout.write(`찾는 중  ${item.label} … `);
    let candidates;
    try {
      candidates = await search(item);
    } catch (err) {
      console.log("실패");
      console.log("        " + err.message);
      console.log("        인터넷 연결 또는 사내 방화벽을 확인하세요.");
      console.log("        직접 받으시려면 assets/audio/음악 넣는 곳.md 를 보세요.");
      continue;
    }

    if (!candidates.length) {
      console.log("결과 없음");
      console.log(`        검색어를 바꿔보세요 (tools/getmusic.js 의 query)`);
      continue;
    }
    console.log(`${candidates.length}곡 찾음`);

    let saved = false;
    for (const c of candidates.slice(0, 5)) {
      try {
        process.stdout.write(`받는 중  ${(c.title || "제목 없음").slice(0, 40)} … `);
        const buf = await get(c.url);
        if (buf.length < 20000) { console.log("너무 작음, 다음 곡"); continue; }
        fs.writeFileSync(dest, buf);
        console.log(`저장 (${Math.round(buf.length / 1024)}KB)`);
        console.log(`        출처 : ${c.foreign_landing_url || c.url}`);
        console.log(`        라이선스 : ${(c.license || "cc0").toUpperCase()}`);
        saved = true;
        break;
      } catch (err) {
        console.log("실패, 다음 곡");
      }
    }
    if (!saved) console.log(`        ${item.file} 을 받지 못했습니다. 직접 넣어주세요.`);
  }

  console.log("=".repeat(66));
  console.log("끝났습니다. 받은 파일을 한 번 들어보고 교육장에 맞는지 확인하세요.");
  console.log("마음에 안 들면 파일을 지우고 검색어를 바꿔 다시 실행하면 됩니다.");
  console.log("=".repeat(66));
}

main().catch(err => {
  console.error("오류:", err.message);
  process.exit(1);
});
