/* ============================================================
   endingphotos.js — 엔딩에 쓸 회사 사진을 받아 넣습니다

   실행 :  node tools/endingphotos.js "C:\\Users\\...\\엔딩사진"
           (경로를 안 적으면 Downloads\\엔딩사진 을 봅니다)

   하는 일
     1) 폴더의 사진을 연도순으로 줄 세웁니다 (파일 이름에서 연도를 읽습니다)
     2) 가로 1920 으로 줄이고 .webp 로 바꿔 assets/img/ending/ 에 넣습니다
     3) data/endingphotos.js 를 새로 씁니다 — 연도와 설명은 여기서 고칩니다

   ⚠ 왜 .webp 인가
     회사 보안정책이 공유폴더에 .jpg / .png 쓰기를 막습니다.
     원본 93MB 를 그대로 둘 수도 없습니다 — 빔에서 넘길 때 끊깁니다.

   ★ 사진을 바꾸려면 원본 폴더에 넣고 이 도구를 다시 돌리면 됩니다.
     파일 이름 앞에 연도를 적어주세요 (예: 1973년.jpg, 2026 본관 드론샷.jpg).
   ============================================================ */

const fs = require("fs");
const path = require("path");
const os = require("os");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.log("playwright 가 없어 사진을 바꿀 수 없습니다.  설치 :  npm install playwright");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const SRC = process.argv[2] || path.join(os.homedir(), "Downloads", "엔딩사진");
const DEST_DIR = path.join(ROOT, "assets", "img", "ending");
const DATA_FILE = path.join(ROOT, "data", "endingphotos.js");

const MAX_WIDTH = 1920;
const QUALITY = 0.82;

/* 파일 이름에서 연도와 설명을 읽습니다.
   "1973년.jpg" → 1973 / 설명 없음
   "2026 본관 드론샷.jpg" → 2026 / "본관 드론샷"
   "1953년_2.jpg" → 1953 / 설명 없음 (같은 해 두 번째 장) */
function readName(file) {
  const base = path.basename(file, path.extname(file));
  const m = /(1[89]\d{2}|20\d{2})/.exec(base);
  if (!m) return null;
  const year = Number(m[1]);
  const caption = base
    .replace(m[1], "")
    .replace(/^\s*년?\s*/, "")
    .replace(/_\d+\s*$/, "")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .trim();
  return { year, caption };
}

(async function () {
  if (!fs.existsSync(SRC)) {
    console.log("사진 폴더를 찾지 못했습니다:\n  " + SRC);
    console.log("\n경로를 직접 적어주세요 :  node tools/endingphotos.js \"C:\\\\...\\\\엔딩사진\"");
    process.exit(1);
  }

  const files = fs.readdirSync(SRC)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .map(f => ({ file: path.join(SRC, f), name: f, ...(readName(f) || {}) }))
    .filter(x => x.year);

  if (!files.length) {
    console.log("연도를 읽을 수 있는 사진이 없습니다. 파일 이름 앞에 연도를 적어주세요.");
    process.exit(1);
  }

  /* 연도순 — 같은 해면 파일 이름 순 */
  files.sort((a, b) => (a.year - b.year) || a.name.localeCompare(b.name, "ko"));

  console.log(`사진 ${files.length}장  ·  ${SRC}\n`);

  let browser = null;
  for (const channel of ["msedge", "chrome", undefined]) {
    try { browser = await chromium.launch(channel ? { channel } : {}); break; } catch (e) { /* 다음 것 */ }
  }
  if (!browser) {
    console.log("브라우저를 찾지 못했습니다. Edge 나 Chrome 이 설치되어 있어야 합니다.");
    process.exit(1);
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });
  /* 예전 것을 지웁니다 — 사진이 줄었는데 옛 파일이 남으면 목록과 어긋납니다 */
  fs.readdirSync(DEST_DIR).filter(f => f.endsWith(".webp"))
    .forEach(f => fs.unlinkSync(path.join(DEST_DIR, f)));

  const page = await browser.newPage();
  const out = [];
  let before = 0, after = 0;

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const raw = fs.readFileSync(item.file);
    before += raw.length;

    const dataUrl = "data:image/" +
      (/\.png$/i.test(item.name) ? "png" : /\.webp$/i.test(item.name) ? "webp" : "jpeg") +
      ";base64," + raw.toString("base64");

    const encoded = await page.evaluate(async ([src, maxW, q]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return { url: c.toDataURL("image/webp", q), w: c.width, h: c.height };
    }, [dataUrl, MAX_WIDTH, QUALITY]);

    const buf = Buffer.from(encoded.url.split(",")[1], "base64");
    const outName = String(i + 1).padStart(2, "0") + "-" + item.year + ".webp";
    fs.writeFileSync(path.join(DEST_DIR, outName), buf);
    after += buf.length;

    out.push({ src: "assets/img/ending/" + outName, year: item.year, caption: item.caption });
    console.log(`  ${String(i + 1).padStart(2)}  ${String(item.year)}  ${item.name.padEnd(30)}` +
      ` ${(raw.length / 1048576).toFixed(1)}MB → ${(buf.length / 1048576).toFixed(2)}MB  ${encoded.w}×${encoded.h}` +
      (item.caption ? "  · " + item.caption : ""));
  }

  await browser.close();

  const body = out.map(p =>
    `  { src: "${p.src}", year: ${p.year}, caption: ${JSON.stringify(p.caption || "")} }`
  ).join(",\n");

  fs.writeFileSync(DATA_FILE, `/* ============================================================
   endingphotos.js — 맺음말 앞에 흐르는 회사 사진

   ★ 이 파일은 tools/endingphotos.js 가 만듭니다.
     사진을 바꾸려면 원본 폴더에 넣고 그 도구를 다시 돌리세요.
     설명(caption)만 손으로 고쳐도 됩니다 — 다시 돌리면 지워집니다.

   ★ 비어 있으면 그 챕터가 아예 뜨지 않습니다. 검은 화면이 뜨는 것보다 낫습니다.

   한 장이 머무는 시간은 data/config.js 의 closing.photoMs 입니다.
   ============================================================ */

window.DRB_ENDING_PHOTOS = [
${body}
];
`, "utf8");

  console.log(`\n${"=".repeat(66)}`);
  console.log(`${out.length}장  ${(before / 1048576).toFixed(0)}MB → ${(after / 1048576).toFixed(1)}MB`);
  console.log("사진  → assets/img/ending/");
  console.log("목록  → data/endingphotos.js   (연도·설명은 여기서 고칩니다)");
  console.log("=".repeat(66));
})();
