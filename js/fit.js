/* ============================================================
   fit.js — 화면 크기에 맞춰 전체 배율을 정합니다

   노트북 1366 이든 빔 1920 이든 대형 모니터든, '설계 크기'에서 보이던
   비율 그대로 화면을 가득 채웁니다. CSS 는 전부 설계 크기 기준의 고정 px 로
   적혀 있고, 크고 작음은 여기서 정한 배율(--ui-scale)이 담당합니다.

   ★ 가로·세로 중 더 빡빡한 쪽을 따릅니다.
     그래서 16:9 · 16:10 · 4:3 어느 화면비에서도 잘리지 않습니다.
     (가로만 보면 세로가 짧은 빔에서 아래가 잘려 나갑니다. 실제로 그랬습니다)

   ★ 상한을 두지 않습니다. 화면이 크면 큰 만큼 같이 커집니다.

   설계 크기는 화면마다 다릅니다 — 참가자는 노트북, 진행자는 빔입니다.
   HTML 의 <html data-fit="가로x세로"> 로 알려줍니다.
   ============================================================ */
(function () {
  var root = document.documentElement;
  var spec = (root.getAttribute("data-fit") || "1440x900").split("x");
  var baseW = parseInt(spec[0], 10) || 1440;
  var baseH = parseInt(spec[1], 10) || 900;

  function fit() {
    var scale = Math.min(window.innerWidth / baseW, window.innerHeight / baseH);
    /* 소수점 세 자리면 충분합니다. 값이 미세하게 흔들리면 글자가 떨립니다. */
    root.style.setProperty("--ui-scale", Math.round(scale * 1000) / 1000);
  }

  fit();
  window.addEventListener("resize", fit);
})();
