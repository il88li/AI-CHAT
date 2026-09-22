/* ═══════════════════════════════════════════════════════════
   خَيال — Sound Engine v1.1
   Web Audio API synthesizer · لا ملفات خارجية · لا تأخير
   إصلاح: AudioContext لا يُنشأ إلا بعد تفاعل مستخدم حقيقي
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'khayal.sounds';
  var VOLUME_KEY = 'khayal.volume';

  var state = {
    enabled: true,
    volume: 0.6,
    ctx: null,
    master: null
  };

  var unlocked = false;

  /* ─── Restore from localStorage ─── */
  try {
    var s = localStorage.getItem(STORAGE_KEY);
    if (s !== null) state.enabled = s === '1';
    var v = parseFloat(localStorage.getItem(VOLUME_KEY));
    if (!isNaN(v)) state.volume = Math.max(0, Math.min(1, v));
  } catch (e) { /* ignore */ }

  /* ─── Lazy AudioContext — يُنشأ فقط بعد تفاعل مستخدم حقيقي ─── */
  function ensureCtx() {
    if (!unlocked) return null;          // لا ننشئ أي شيء قبل أول gesture
    if (state.ctx) {
      if (state.ctx.state === 'suspended') {
        state.ctx.resume().catch(function () {});
      }
      return state.ctx;
    }
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      state.ctx = new AC();
      state.master = state.ctx.createGain();
      state.master.gain.value = state.enabled ? state.volume : 0;
      state.master.connect(state.ctx.destination);
      return state.ctx;
    } catch (e) {
      return null;
    }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensureCtx();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    document.removeEventListener('touchstart', unlock, true);
  }

  // نربط unlock بأول تفاعل حقيقي فقط
  document.addEventListener('pointerdown', unlock, { capture: true, once: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true, once: true, passive: true });
  document.addEventListener('touchstart', unlock, { capture: true, once: true, passive: true });

  /* ─── Core tone builder ─── */
  function tone(opts) {
    if (!state.enabled || state.volume <= 0) return;
    var ctx = ensureCtx();
    if (!ctx) return;

    var t0 = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq || 440, t0);

    if (opts.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(opts.freqEnd, 1),
        t0 + (opts.duration || 0.15)
      );
    }

    var peak = (opts.gain != null ? opts.gain : 0.28);
    var attack = opts.attack != null ? opts.attack : 0.006;
    var decay = opts.duration || 0.15;

    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);

    osc.connect(gain);
    gain.connect(state.master);

    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }

  /* ─── Noise burst (for whoosh / tick) ─── */
  function noise(opts) {
    if (!state.enabled || state.volume <= 0) return;
    var ctx = ensureCtx();
    if (!ctx) return;

    var t0 = ctx.currentTime + (opts.delay || 0);
    var dur = opts.duration || 0.08;
    var sampleRate = ctx.sampleRate;
    var frameCount = Math.max(1, Math.floor(sampleRate * dur));

    var buffer = ctx.createBuffer(1, frameCount, sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frameCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
    }

    var src = ctx.createBufferSource();
    src.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = opts.filterType || 'bandpass';
    filter.frequency.value = opts.freq || 2000;
    filter.Q.value = opts.q != null ? opts.q : 1.2;

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain != null ? opts.gain : 0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(state.master);

    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /* ═══════════════════════════════════════════════════════
     Sound catalogue
     ═══════════════════════════════════════════════════════ */
  var sounds = {

    /* Like — bright rising pop with a warm tail */
    like: function () {
      tone({ type: 'triangle', freq: 523.25, freqEnd: 880, duration: 0.09, gain: 0.26, attack: 0.004 });
      tone({ type: 'sine',     freq: 1046.5, duration: 0.18, gain: 0.14, delay: 0.03, attack: 0.004 });
      noise({ freq: 3200, duration: 0.05, gain: 0.06, delay: 0 });
    },

    /* Copy — short crisp tick */
    copy: function () {
      tone({ type: 'square', freq: 1760, duration: 0.035, gain: 0.14, attack: 0.001 });
      tone({ type: 'sine',   freq: 2637, duration: 0.06,  gain: 0.10, delay: 0.02, attack: 0.001 });
      noise({ freq: 5000, duration: 0.03, gain: 0.05, filterType: 'highpass', q: 0.7 });
    },

    /* Send — soft rising whoosh */
    send: function () {
      tone({ type: 'sine', freq: 330, freqEnd: 880, duration: 0.16, gain: 0.18, attack: 0.01 });
      noise({ freq: 1200, duration: 0.14, gain: 0.09, filterType: 'bandpass', q: 0.8 });
      tone({ type: 'triangle', freq: 660, duration: 0.10, gain: 0.10, delay: 0.08, attack: 0.004 });
    },

    /* Success — C5 → E5 chime */
    success: function () {
      tone({ type: 'sine', freq: 523.25, duration: 0.16, gain: 0.20, attack: 0.005 });
      tone({ type: 'sine', freq: 659.25, duration: 0.24, gain: 0.18, delay: 0.09, attack: 0.005 });
      tone({ type: 'sine', freq: 783.99, duration: 0.30, gain: 0.12, delay: 0.18, attack: 0.005 });
    },

    /* Error — low buzz double tap */
    error: function () {
      tone({ type: 'sawtooth', freq: 180, freqEnd: 120, duration: 0.10, gain: 0.14, attack: 0.004 });
      tone({ type: 'sawtooth', freq: 180, freqEnd: 120, duration: 0.10, gain: 0.14, delay: 0.13, attack: 0.004 });
    },

    /* Tab — subtle click for navigation */
    tab: function () {
      tone({ type: 'sine', freq: 880, duration: 0.04, gain: 0.08, attack: 0.002 });
      noise({ freq: 3500, duration: 0.02, gain: 0.03, filterType: 'highpass', q: 0.5 });
    },

    /* Toggle — soft snap */
    toggle: function () {
      tone({ type: 'triangle', freq: 660, freqEnd: 990, duration: 0.06, gain: 0.14, attack: 0.003 });
    },

    /* Open — a wider whoosh for view transitions */
    open: function () {
      noise({ freq: 900, duration: 0.18, gain: 0.08, filterType: 'bandpass', q: 0.6 });
      tone({ type: 'sine', freq: 440, freqEnd: 660, duration: 0.14, gain: 0.10, attack: 0.008 });
    },

    /* Close — reverse whoosh */
    close: function () {
      noise({ freq: 700, duration: 0.14, gain: 0.06, filterType: 'bandpass', q: 0.6 });
      tone({ type: 'sine', freq: 660, freqEnd: 330, duration: 0.12, gain: 0.09, attack: 0.006 });
    }
  };

  /* ═══════════════════════════════════════════════════════
     Public API
     ═══════════════════════════════════════════════════════ */
  var Sounds = {
    play: function (name) {
      if (!state.enabled) return;
      var fn = sounds[name];
      if (!fn) return;
      try {
        ensureCtx();  // unlock on first gesture
        fn();
      } catch (e) {
        /* silently ignore — sound must never break UI */
      }
    },

    setEnabled: function (on) {
      state.enabled = !!on;
      try { localStorage.setItem(STORAGE_KEY, state.enabled ? '1' : '0'); } catch (e) {}
      if (state.master) {
        state.master.gain.setTargetAtTime(
          state.enabled ? state.volume : 0,
          state.ctx.currentTime,
          0.02
        );
      }
      if (state.enabled) Sounds.play('toggle');
    },

    isEnabled: function () { return state.enabled; },

    setVolume: function (v) {
      state.volume = Math.max(0, Math.min(1, v));
      try { localStorage.setItem(VOLUME_KEY, String(state.volume)); } catch (e) {}
      if (state.master && state.ctx) {
        state.master.gain.setTargetAtTime(
          state.enabled ? state.volume : 0,
          state.ctx.currentTime,
          0.02
        );
      }
    },

    getVolume: function () { return state.volume; },

    /* For Safari — call from a click handler the first time */
    unlock: function () {
      unlocked = true;
      ensureCtx();
    }
  };

  global.Sounds = Sounds;

})(window);