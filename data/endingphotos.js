/* ============================================================
   endingphotos.js — 맺음말 앞에 흐르는 회사 사진

   ★ 이 파일은 tools/endingphotos.js 가 만듭니다.
     사진을 바꾸려면 원본 폴더에 넣고 그 도구를 다시 돌리세요.
     caption 과 focus 는 손으로 고쳐도 됩니다 — 다시 돌려도 그대로 남습니다.

   ★ focus — 사진의 어디를 보여줄 것인가
     화면이 사진보다 가로로 넓어서 위아래가 잘립니다. 기본은 가운데인데,
     사람이 위쪽에 서 있는 사진은 그러면 얼굴이 날아갑니다.
       "top"    위를 맞춥니다 (인물 사진)
       "bottom" 아래를 맞춥니다
       없으면   가운데

   ★ 비어 있으면 그 챕터가 아예 뜨지 않습니다. 검은 화면이 뜨는 것보다 낫습니다.

   한 장이 머무는 시간은 data/config.js 의 closing.photoMs 입니다.
   연도는 화면에 뜨지 않습니다 — 사진 순서를 정하는 데만 씁니다.
   ============================================================ */

window.DRB_ENDING_PHOTOS = [
  { src: "assets/img/ending/01-1953.webp", year: 1953, caption: "" },
  { src: "assets/img/ending/02-1953.webp", year: 1953, caption: "", focus: "top" },
  { src: "assets/img/ending/03-1953.webp", year: 1953, caption: "" },
  { src: "assets/img/ending/04-1960.webp", year: 1960, caption: "" },
  { src: "assets/img/ending/05-1970.webp", year: 1970, caption: "" },
  { src: "assets/img/ending/06-1972.webp", year: 1972, caption: "" },
  { src: "assets/img/ending/07-1973.webp", year: 1973, caption: "" },
  { src: "assets/img/ending/08-1979.webp", year: 1979, caption: "" },
  { src: "assets/img/ending/09-1980.webp", year: 1980, caption: "" },
  { src: "assets/img/ending/10-1981.webp", year: 1981, caption: "" },
  { src: "assets/img/ending/11-1987.webp", year: 1987, caption: "" },
  { src: "assets/img/ending/12-2003.webp", year: 2003, caption: "" },
  { src: "assets/img/ending/13-2025.webp", year: 2025, caption: "벨트사업부문 워크숍" },
  { src: "assets/img/ending/14-2025.webp", year: 2025, caption: "" },
  { src: "assets/img/ending/15-2026.webp", year: 2026, caption: "본관 드론샷" }
];
