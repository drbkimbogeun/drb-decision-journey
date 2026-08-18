/* ============================================================
   audio.js — 효과음과 배경음악

   ◆ 효과음은 파일이 없습니다. 브라우저가 그 자리에서 소리를 만듭니다.
     저작권 문제가 없고, 인터넷이 없어도, 어느 PC에서나 똑같이 납니다.

   ◆ 배경음악은 세 곡뿐입니다. 시대가 아니라 '무엇을 하는 중인가' 로 갈립니다.
       평상시   국면 시작 ~ 선택이 끝날 때까지 (6개 국면 모두 같은 곡)
       시대흐름 선택이 끝나고 연도가 넘어가는 구간
       엔딩     2026 이후
     어느 화면에서 어느 곡을 트는지는 `data/config.js` 의 audio 에서 정합니다.
     세 곡 다 무한 반복입니다. 2분짜리라도 5분 국면 내내 끊기지 않습니다.
     파일이 없으면 조용히 넘어갑니다. 게임은 그대로 돌아갑니다.

   ◆ 브라우저 규칙상 사용자가 한 번 클릭하기 전에는 소리를 낼 수 없습니다.
     그래서 첫 클릭 때 깨웁니다.
   ============================================================ */

window.DRBAudio = (function () {
  "use strict";

  var STORAGE_KEY = "drb_sound";
  var ctx = null;
  var muted = false;

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
  var tracks = {};         // { normal, lapse, ending }
  var shockTrack = null;
  var playing = null;      // 지금 울리고 있는 곡
  var playingName = "";    // 그 곡의 이름 (음소거를 풀 때 되돌아갑니다)
  var ducked = false;

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

  function loadTrack(src, loop, eager) {
    var el = new Audio();
    el.loop = !!loop;
    el.volume = 0;
    /* ★ 곡 하나가 7MB 쯤 됩니다. 조가 여섯이면 교육장 와이파이로 40MB 를 동시에
         당기게 됩니다. 그래서 처음엔 지금 쓸 곡만 받고, 나머지는 첫 곡이 다 들어온
         뒤에 조용히 뒤에서 받습니다 (첫 국면이 몇 분이라 충분합니다). */
    el.preload = eager ? "auto" : "metadata";
    el.src = src;

    /* ★ 곡이 2분이고 국면이 5분입니다. 끝까지 가면 처음으로 되감아 다시 겁니다.
         el.loop 만으로는 브라우저·형식에 따라 한 번 돌고 멈추는 경우가 있어
         ended 를 직접 받아 되감습니다. 이중 안전장치입니다. */
    if (loop) {
      el.addEventListener("ended", function () {
        try {
          el.currentTime = 0;
          var p = el.play();
          if (p && p.catch) p.catch(function () {});
        } catch (e) { /* 소리는 실패해도 게임을 막지 않습니다 */ }
      });
    }

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
        el.src = URL.createObjectURL(new Blob([buf], { type: sniff(new Uint8Array(buf.slice(0, 16))) }));
        /* src 를 바꾸면 loop 는 유지되지만, 재생 중이었다면 다시 걸어줘야 합니다 */
        if (playing === el && !muted) fade(el, baseVolume(), 600);
      }).catch(function () { el.dataset.missing = "1"; });
    });

    return el;
  }

  function ensureTracks() {
    if (tracks.normal || shockTrack) return;
    var files = cfg.music || {};
    Object.keys(files).forEach(function (name) {
      tracks[name] = loadTrack(files[name], true, name === "normal");
    });
    /* 알람은 작고(0.2MB) 언제 터질지 모르므로 미리 받아둡니다 */
    if (cfg.shock) shockTrack = loadTrack(cfg.shock, false, true);

    /* 평상시 곡이 다 들어오면 나머지를 뒤에서 받습니다 */
    var first = tracks.normal;
    if (!first) { warmRest(); return; }
    first.addEventListener("canplaythrough", warmRest, { once: true });
    setTimeout(warmRest, 20000);   // 못 받아도 언젠가는 시작합니다
  }

  var warmed = false;
  function warmRest() {
    if (warmed) return;
    warmed = true;
    Object.keys(tracks).forEach(function (name) {
      var el = tracks[name];
      /* load() 는 재생을 처음으로 되돌립니다. 지금 울리는 곡은 건드리지 않습니다. */
      if (name === "normal" || el === playing) return;
      try { el.preload = "auto"; el.load(); } catch (e) {}
    });
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

  function baseVolume() {
    var v = cfg.volume === undefined ? 0.22 : cfg.volume;
    if (!ducked) return v;
    return cfg.duckVolume === undefined ? 0.07 : cfg.duckVolume;
  }

  /* ============================================================
     화면이 바뀌면 그 화면에 맞는 곡으로 넘어갑니다.

     screen 을 주면 config 의 musicByScreen 표에서 곡을 찾고,
     곡 이름(normal / lapse / ending)을 바로 줘도 됩니다.
     ============================================================ */
  /* ★ 배경음악은 교육장에서 한 곳에서만 나와야 합니다 — 진행자 빔입니다.
       조마다 노트북에서 같은 곡이 같이 흘러나오면 시작 시각이 조금씩 달라
       방 전체가 울리고, 조별 토론 목소리를 덮습니다.
       그래서 음악을 틀 화면만 <html data-music="on"> 을 답니다.
       효과음(버튼 소리)은 그 화면에서 눌린 사람에게만 필요하므로 계속 납니다. */
  function musicAllowed() {
    return document.documentElement.getAttribute("data-music") === "on";
  }

  function scene(screen) {
    if (!musicAllowed()) return;
    var map = cfg.musicByScreen || {};
    var name = tracks[screen] ? screen : (map[screen] || "normal");

    ensureTracks();
    if (muted) { playingName = name; stopAll(); return; }

    var next = tracks[name];
    if (!next) return;

    var changed = playingName !== name;
    playingName = name;
    if (next === playing) { fade(playing, baseVolume(), 400); return; }

    if (playing) fade(playing, 0, 900);      // 앞 곡은 천천히 사라지고
    playing = next;
    /* 곡이 바뀌었을 때만 처음부터. 음소거를 풀 때는 멈춘 자리에서 이어집니다. */
    if (changed) { try { next.currentTime = 0; } catch (e) {} }
    fade(playing, baseVolume(), 1400);       // 새 곡은 천천히 올라옵니다
  }

  /* 돌발상황 동안 배경음악을 낮춥니다 */
  function duck(on) {
    ducked = !!on;
    if (!muted && playing) fade(playing, baseVolume(), 350);
  }

  /* 돌발상황이 뜨는 순간 한 번 — 배경음악 위로 겹칩니다 */
  function alarm() {
    if (!musicAllowed()) return;
    ensureTracks();
    if (muted || !shockTrack || shockTrack.dataset.missing) return;
    try {
      shockTrack.currentTime = 0;
      shockTrack.volume = cfg.shockVolume === undefined ? 0.55 : cfg.shockVolume;
      var p = shockTrack.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* 소리는 실패해도 게임을 막지 않습니다 */ }
  }

  function stopAll() {
    Object.keys(tracks).forEach(function (name) { fade(tracks[name], 0, 300); });
    playing = null;
  }

  /* ============================================================
     음소거
     ============================================================ */
  function setMuted(next) {
    muted = !!next;
    try { localStorage.setItem(STORAGE_KEY, muted ? "off" : "on"); } catch (e) {}
    if (muted) {
      stopAll();
      try { if (shockTrack) shockTrack.pause(); } catch (e) {}
    } else if (playingName) {
      scene(playingName);
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

  /* 지금 무슨 곡이 어떤 상태로 걸려 있는지 — tools/audiocheck.js 가 이걸로 검사합니다 */
  function nowPlaying() {
    if (!playing) return { name: playingName, playing: false };
    return {
      name: playingName,
      playing: !playing.paused,
      loop: !!playing.loop,
      duration: playing.duration,
      readyState: playing.readyState,
      missing: playing.dataset.missing === "1",
      volume: playing.volume
    };
  }

  return { play: play, scene: scene, duck: duck, alarm: alarm, stopAll: stopAll,
           toggle: toggle, setMuted: setMuted, isMuted: isMuted, nowPlaying: nowPlaying };
})();
