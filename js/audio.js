/* ============================================================
   audio.js — 효과음과 배경음악

   ◆ 효과음은 파일이 없습니다. 브라우저가 그 자리에서 소리를 만듭니다.
     저작권 문제가 없고, 인터넷이 없어도, 어느 PC에서나 똑같이 납니다.

   ◆ 배경음악만 파일이 필요합니다. `assets/audio/` 에 넣으세요.
       bgm.mp3    평상시
       tense.mp3  돌발상황
     파일이 없으면 조용히 넘어갑니다. 게임은 그대로 돌아갑니다.

   ◆ 브라우저 규칙상 사용자가 한 번 클릭하기 전에는 소리를 낼 수 없습니다.
     그래서 첫 클릭 때 깨웁니다.
   ============================================================ */

window.DRBAudio = (function () {
  "use strict";

  var STORAGE_KEY = "drb_sound";
  var ctx = null;
  var muted = false;
  var bgm = null;
  var tense = null;
  var current = null;

  try { muted = localStorage.getItem(STORAGE_KEY) === "off"; } catch (e) { muted = false; }

  /* ---------- 소리를 만들 준비 (첫 클릭 때 한 번) ---------- */
  function wake() {
    if (!ctx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try { ctx = new Ctx(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* ============================================================
     효과음 — 짧은 음 하나로 만듭니다.
     교육장에서 거슬리지 않도록 전부 짧고 작게.
     ============================================================ */
  function tone(opts) {
    if (muted) return;
    var c = wake();
    if (!c) return;

    var osc = c.createOscillator();
    var gain = c.createGain();
    var now = c.currentTime;
    var dur = opts.dur || 0.12;

    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(opts.from, now);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, now + dur);

    var peak = (opts.vol === undefined ? 0.12 : opts.vol);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /* 여러 음을 잇달아 */
  function seq(steps) {
    steps.forEach(function (s, i) {
      setTimeout(function () { tone(s); }, (s.at || i * 90));
    });
  }

  var SOUNDS = {
    /* 토큰을 한 칸 올림 — 짧고 맑게 */
    tokenUp:   function () { tone({ from: 620, to: 880, dur: 0.09, vol: 0.10 }); },
    /* 토큰을 내림 */
    tokenDown: function () { tone({ from: 480, to: 320, dur: 0.09, vol: 0.08 }); },
    /* 정책 등 하나를 고름 */
    pick:      function () { tone({ from: 740, to: 990, dur: 0.10, vol: 0.10 }); },
    /* 결정 확정 — 되돌릴 수 없다는 무게 */
    commit:    function () { seq([{ from: 440, to: 660, dur: 0.14, vol: 0.12 },
                                  { from: 660, to: 880, dur: 0.22, vol: 0.12, at: 120 }]); },
    /* 시간이 흐름 */
    lapse:     function () { tone({ type: "triangle", from: 300, to: 220, dur: 0.5, vol: 0.07 }); },
    /* 돌발상황 — 이것만 놀라게 만듭니다 */
    shock:     function () { seq([{ type: "square", from: 300, to: 180, dur: 0.22, vol: 0.14 },
                                  { type: "square", from: 260, to: 150, dur: 0.30, vol: 0.14, at: 240 }]); },
    /* 결과 공개 */
    result:    function () { seq([{ from: 520, dur: 0.10, vol: 0.10 },
                                  { from: 660, dur: 0.10, vol: 0.10, at: 90 },
                                  { from: 880, dur: 0.20, vol: 0.11, at: 180 }]); },
    /* 화면 넘김 */
    next:      function () { tone({ from: 560, to: 700, dur: 0.07, vol: 0.07 }); }
  };

  function play(name) {
    var fn = SOUNDS[name];
    if (fn) { try { fn(); } catch (e) { /* 소리는 실패해도 게임을 막지 않습니다 */ } }
  }

  /* ============================================================
     배경음악 — 파일이 있을 때만
     ============================================================ */
  function makeTrack(src) {
    var el = new Audio(src);
    el.loop = true;
    el.volume = 0;
    el.preload = "auto";
    el.addEventListener("error", function () { el.dataset.missing = "1"; });
    return el;
  }

  /* 소리는 어떤 경우에도 게임을 막지 않습니다.
     오래된 브라우저·테스트 환경에서는 play/pause 가 없을 수도 있습니다. */
  function fade(el, to, ms) {
    if (!el || el.dataset.missing) return;
    var from = el.volume;
    var start = null;
    function step(t) {
      if (start === null) start = t;
      var k = Math.min(1, (t - start) / ms);
      try { el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) { return; }
      if (k < 1) requestAnimationFrame(step);
      else if (to === 0) { try { el.pause(); } catch (e) {} }
    }
    if (to > 0 && el.paused) {
      try { var p = el.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { return; }
    }
    requestAnimationFrame(step);
  }

  /* mood: "calm" 평상시 · "tense" 돌발상황 · "off" 끔 */
  function music(mood) {
    if (!bgm) {
      bgm = makeTrack("assets/audio/bgm.mp3");
      tense = makeTrack("assets/audio/tense.mp3");
    }
    if (muted || mood === "off") {
      fade(bgm, 0, 400);
      fade(tense, 0, 400);
      current = null;
      return;
    }
    if (current === mood) return;
    current = mood;
    if (mood === "tense") {
      fade(bgm, 0, 300);
      fade(tense, 0.5, 300);
    } else {
      fade(tense, 0, 500);
      fade(bgm, 0.28, 900);
    }
  }

  /* ============================================================
     음소거
     ============================================================ */
  function setMuted(next) {
    muted = !!next;
    try { localStorage.setItem(STORAGE_KEY, muted ? "off" : "on"); } catch (e) {}
    if (muted) {
      fade(bgm, 0, 200);
      fade(tense, 0, 200);
      current = null;
    } else if (current === null) {
      music("calm");
    }
    return muted;
  }

  function toggle() { return setMuted(!muted); }
  function isMuted() { return muted; }

  /* 첫 클릭에 오디오를 깨웁니다 (브라우저 자동재생 정책) */
  document.addEventListener("pointerdown", function once() {
    wake();
    document.removeEventListener("pointerdown", once);
  }, { once: true });

  return { play: play, music: music, toggle: toggle, setMuted: setMuted, isMuted: isMuted };
})();
