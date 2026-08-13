/* ============================================================
   audio.js — 효과음과 배경음악

   ◆ 효과음은 파일이 없습니다. 브라우저가 그 자리에서 소리를 만듭니다.
     저작권 문제가 없고, 인터넷이 없어도, 어느 PC에서나 똑같이 납니다.

   ◆ 배경음악과 돌발 알람만 파일이 필요합니다.
     어느 파일을 쓸지는 `data/config.js` 의 audio 에서 정합니다.
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
     배경음악

     ⚠ 회사 보안정책이 공유폴더에 .mp3 쓰기를 막아서, 음악 파일은
       .m4a 라는 이름으로 들어 있습니다. 안의 내용은 mp3 일 수 있습니다.
       그래서 확장자를 믿지 않고 앞부분 몇 바이트를 직접 읽어
       무슨 형식인지 알아낸 뒤 브라우저에 알려줍니다.

     파일이 없거나 읽지 못하면 조용히 넘어갑니다. 게임은 그대로 돌아갑니다.
     ============================================================ */
  var cfg = (window.DRB_CONFIG && window.DRB_CONFIG.audio) || {};
  var tracks = {};

  /* 파일 앞머리를 보고 형식을 알아냅니다 */
  function sniff(bytes) {
    if (bytes.length > 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";      // ID3
    if (bytes.length > 1 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return "audio/mpeg";                   // MPEG frame
    if (bytes.length > 11 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return "audio/mp4";                                                                                          // ftyp
    }
    if (bytes.length > 3 && bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67) return "audio/ogg";        // OggS
    if (bytes.length > 3 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46) return "audio/wav";        // RIFF
    return "audio/mpeg";
  }

  function loadTrack(src, loop) {
    var el = new Audio();
    el.loop = !!loop;
    el.volume = 0;
    el.preload = "auto";

    /* 먼저 그냥 틀어봅니다. 서버가 형식을 제대로 알려주면 이걸로 끝입니다. */
    el.src = src;

    /* 못 읽으면 파일을 직접 받아 형식을 붙여 다시 넘깁니다.
       (file:// 로 열었을 때는 fetch 가 막히므로 여기서 조용히 포기합니다) */
    el.addEventListener("error", function () {
      if (el.dataset.retried) { el.dataset.missing = "1"; return; }
      el.dataset.retried = "1";
      if (!window.fetch) { el.dataset.missing = "1"; return; }
      fetch(src).then(function (r) {
        if (!r.ok) throw new Error("no file");
        return r.arrayBuffer();
      }).then(function (buf) {
        var head = new Uint8Array(buf.slice(0, 16));
        el.src = URL.createObjectURL(new Blob([buf], { type: sniff(head) }));
      }).catch(function () { el.dataset.missing = "1"; });
    });

    return el;
  }

  function ensureTracks() {
    if (tracks.ready) return;
    tracks.ready = true;
    if (cfg.bgm)   tracks.bgm   = loadTrack(cfg.bgm, true);
    if (cfg.tense) tracks.tense = loadTrack(cfg.tense, true);
    if (cfg.shock) tracks.shock = loadTrack(cfg.shock, false);
    bgm = tracks.bgm;
    tense = tracks.tense;
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

  /* 돌발상황이 뜨는 순간 한 번 — 배경음악과 겹쳐서 납니다 */
  function alarm() {
    ensureTracks();
    var el = tracks.shock;
    if (muted || !el || el.dataset.missing) return;
    try {
      el.currentTime = 0;
      el.volume = cfg.shockVolume === undefined ? 0.55 : cfg.shockVolume;
      var p = el.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* 소리는 실패해도 게임을 막지 않습니다 */ }
  }

  /* mood: "calm" 평상시 · "tense" 돌발상황 · "off" 끔 */
  function music(mood) {
    ensureTracks();
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
      fade(tense, cfg.tenseVolume === undefined ? 0.42 : cfg.tenseVolume, 300);
    } else {
      fade(tense, 0, 500);
      fade(bgm, cfg.bgmVolume === undefined ? 0.22 : cfg.bgmVolume, 900);
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

  return { play: play, music: music, alarm: alarm, toggle: toggle, setMuted: setMuted, isMuted: isMuted };
})();
