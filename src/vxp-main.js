/*!
 * Voxalike+ — неофициальная клиентская модификация для https://voxalike.com
 * https://github.com/BeshkekArt/voxalike-plus · MIT License · © 2026 BeshkekArt
 * Не связан с разработчиками Voxalike. Предоставляется «как есть», без гарантий.
 *
 * Работает на оригинальных серверах: ничего не подменяет на сервере,
 * только улучшает интерфейс и логику клиента.
 *
 *  • Сцена озвучки: 2 дорожки (оригинал / моя запись), сдвиг моей дорожки,
 *    автоподгонка, прослушивание «вместе», волна в реальном времени.
 *  • Обработка: питч, громкость дорожки, срез низов (неразрушающая).
 *  • Запись: усиление микрофона, мониторинг, «слушать оригинал»,
 *    отсчёт 3-2-1, буфер после реплики (~5 с).
 *  • Сетевая игра «Совместно»: запиши все свои реплики заранее — мод
 *    отправит каждую мгновенно, когда подойдёт твоя очередь.
 *  • Chrome / Edge / Яндекс / Opera / Firefox.
 */
(() => {
  'use strict';
  if (window.__VXP__) return;
  const VERSION = '1.1.1';
  const VXP = (window.__VXP__ = { version: VERSION });
  const IS_FF = /firefox/i.test(navigator.userAgent);

  /* ================================================================== */
  /*  Утилиты                                                            */
  /* ================================================================== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dbToLin = (db) => Math.pow(10, db / 20);
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  const fmtMs = (ms) => { const r = Math.round(ms); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r) + ' мс'; };
  const fmtSigned = (v, unit) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' ' + unit;
  const isTyping = (t) =>
    t && (t.isContentEditable || /^(textarea|select)$/i.test(t.tagName) ||
      (t.tagName === 'INPUT' && !/^(range|checkbox|button)$/i.test(t.type)));

  /* ================================================================== */
  /*  Настройки                                                          */
  /* ================================================================== */
  const SKEY = 'vxp:settings:v1';
  const DEF_FX = { pitch: 0, gain: 0, lowcut: false };
  const settings = Object.assign(
    {
      gainDb: 0, monitorSelf: false, monitorVol: 0.8, rawMic: true,
      studioGuide: true, guideVol: 0.55,
      countdown: 3, countBeep: true, tailSec: 5,
      autoSubmit: true, notifyTurn: true, hotkeys: true,
      fx: { ...DEF_FX },
      collapsed: {},
    },
    (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } })()
  );
  settings.fx = Object.assign({ ...DEF_FX }, settings.fx || {});
  const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} };
  VXP.settings = settings;

  const bus = new EventTarget();
  const emit = (n, d) => bus.dispatchEvent(new CustomEvent(n, { detail: d }));
  const onBus = (n, f) => bus.addEventListener(n, (e) => f(e.detail));

  /* ================================================================== */
  /*  DSP                                                                */
  /* ================================================================== */
  function encodeWav(samples, sr) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) { const x = clamp(samples[i], -1, 1); v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }
  /** Чтение с шагом step (step>1 — быстрее/выше). */
  function resampleStep(x, step, outLen) {
    const n = outLen ?? Math.max(1, Math.floor(x.length / step)), out = new Float32Array(n), last = x.length - 1;
    for (let i = 0; i < n; i++) {
      const p = i * step, a = Math.floor(p);
      if (a >= last) { out[i] = a === last ? x[last] : 0; continue; }
      const f = p - a; out[i] = x[a] * (1 - f) + x[a + 1] * f;
    }
    return out;
  }
  const resample = (x, from, to) => (from === to ? x : resampleStep(x, from / to, Math.max(1, Math.round((x.length * to) / from))));
  function prepareUpload(samples, sr) {
    const maxSamples = Math.floor((2.5e6 - 44) / 2), dur = samples.length / sr;
    let rate = Math.min(sr, 32000);
    if (dur * rate > maxSamples) rate = Math.floor(maxSamples / dur);
    rate = [32000, 24000, 22050, 16000, 12000, 11025, 8000].find((r) => r <= rate) || Math.max(1, rate);
    return { samples: resample(samples, sr, rate), sampleRate: rate };
  }
  /** Сдвиг: положительный — позже. Результат длины outLen. */
  function shiftSamples(src, sr, offsetMs, outLen) {
    const out = new Float32Array(outLen ?? src.length);
    const shift = Math.round((offsetMs / 1000) * sr);
    for (let i = Math.max(0, shift), j = i - shift; i < out.length && j < src.length; i++, j++) out[i] = src[j];
    return out;
  }
  function envelope(samples, sr, frameMs = 10) {
    const fl = Math.max(1, Math.round((sr * frameMs) / 1000)), n = Math.floor(samples.length / fl), e = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i * fl, k = j + fl; j < k; j++) s += samples[j] * samples[j]; e[i] = Math.sqrt(s / fl); }
    return e;
  }
  function zNorm(x) {
    let m = 0; for (const v of x) m += v; m /= x.length || 1;
    let sd = 0; for (let i = 0; i < x.length; i++) { x[i] -= m; sd += x[i] * x[i]; }
    sd = Math.sqrt(sd) || 1; for (let i = 0; i < x.length; i++) x[i] /= sd;
    return x;
  }
  /** Лаг L (в кадрах), при котором a[i] ≈ b[i+L]. */
  function bestLag(a, b, minLag, maxLag) {
    let best = 0, bestS = -Infinity;
    for (let L = minLag; L <= maxLag; L++) {
      let s = 0;
      const i0 = Math.max(0, -L), i1 = Math.min(a.length, b.length - L);
      for (let i = i0; i < i1; i++) s += a[i] * b[i + L];
      if (s > bestS) { bestS = s; best = L; }
    }
    return best;
  }
  /** На сколько мс сдвинуть take (начинающийся в takeT0 сек), чтобы совпасть с ref (с 0). */
  function autoAlign(ref, refSr, take, takeSr, takeT0 = 0) {
    const a = zNorm(envelope(ref, refSr)), b = zNorm(envelope(take, takeSr));
    const L = bestLag(a, b, -Math.round(1.2 * 100), b.length - 1); // a[i] ≈ b[i+L]: take-кадр j=i+L на месте i
    // позиция take: кадр j совпадает с ref-кадром j-L → take начинается в −L*10 мс
    return -L * 10 - takeT0 * 1000;
  }
  /** Найти, где short лежит внутри long (в сэмплах long). expectSec — ожидаемое место (ограничивает поиск). */
  function locate(short, long, sr, expectSec = null, radiusSec = 0.4) {
    const a = zNorm(envelope(short, sr, 10)), b = zNorm(envelope(long, sr, 10));
    let lo = -50, hi = Math.max(-50, b.length - a.length + 50);
    if (expectSec != null && isFinite(expectSec)) {
      const e = Math.round(expectSec * 100), r = Math.round(radiusSec * 100);
      lo = Math.max(lo, e - r); hi = Math.min(hi, e + r);
      if (lo > hi) { lo = -50; hi = Math.max(-50, b.length - a.length + 50); }
    }
    const L10 = bestLag(a, b, lo, hi);
    const a1 = zNorm(envelope(short, sr, 1)), b1 = zNorm(envelope(long, sr, 1));
    const L1 = bestLag(a1, b1, L10 * 10 - 12, L10 * 10 + 12);
    return Math.round((L1 * sr) / 1000);
  }
  function rms(x, a = 0, b = x.length) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
  function peakOf(x) { let p = 0; for (const v of x) { const a = v < 0 ? -v : v; if (a > p) p = a; } return p; }
  function normalizeTake(samples) {
    const peak = peakOf(samples);
    if (peak < 0.01) return samples;
    const g = Math.min(dbToLin(12), 0.89 / peak);
    if (Math.abs(g - 1) < 0.02) return samples;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
    return out;
  }
  function mixToMono(buffer) {
    const n = buffer.length, out = new Float32Array(n), c = buffer.numberOfChannels;
    for (let ch = 0; ch < c; ch++) { const d = buffer.getChannelData(ch); for (let i = 0; i < n; i++) out[i] += d[i] / c; }
    return out;
  }
  function highpass(x, sr, f0 = 90, Q = 0.707) {
    const w0 = (2 * Math.PI * f0) / sr, c = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
    const a0 = 1 + al, b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  /** WSOLA: растянуть x во времени (factor>1 — длиннее), длина результата outLen. */
  function timeStretch(x, factor, outLen, sr) {
    const N = Math.max(256, Math.round(sr * 0.04) & ~1), Hs = N >> 1, Ha = Hs / factor, tol = Math.round(sr * 0.008);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const out = new Float32Array(outLen + N), norm = new Float32Array(outLen + N);
    const at = (i) => (i >= 0 && i < x.length ? x[i] : 0);
    let prev = 0;
    for (let k = 0, op = 0; op < outLen; k++, op += Hs) {
      let pos = Math.round(k * Ha);
      if (k > 0) {
        const nat = prev + Hs;
        let best = pos, bestC = -Infinity;
        for (let c = pos - tol; c <= pos + tol; c += 2) {
          if (c < 0) continue;
          let s = 0;
          for (let i = 0; i < N; i += 6) s += at(c + i) * at(nat + i);
          if (s > bestC) { bestC = s; best = c; }
        }
        pos = best;
      }
      for (let i = 0; i < N; i++) { out[op + i] += at(pos + i) * win[i]; norm[op + i] += win[i]; }
      prev = pos;
    }
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : out[i];
    return res;
  }
  function pitchShift(x, sr, semis) {
    if (!semis) return x;
    const p = Math.pow(2, semis / 12);
    const y = resampleStep(x, p);
    return timeStretch(y, p, x.length, sr);
  }

  /* ---------- модель дубля (неразрушающая обработка) ---------- */
  // model = { base:Float32Array, sr, t0 (сек, позиция base[0] относительно старта видео),
  //           outLen (сэмплов в окне для игры), params:{offset,pitch,gain,lowcut} }
  const defaultParams = () => ({ offset: 0, ...settings.fx });
  const isDefaultParams = (p) => !p.offset && !p.pitch && !p.gain && !p.lowcut;
  function processed(model) {
    const p = model.params, key = p.pitch + '|' + p.gain + '|' + (p.lowcut ? 1 : 0);
    if (model._ck === key && model._cp) return model._cp;
    let x = model.base;
    if (p.pitch) x = pitchShift(x, model.sr, p.pitch);
    if (p.lowcut) x = highpass(x, model.sr);
    if (p.gain) {
      const g = dbToLin(p.gain), y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
      x = y;
    }
    const pk = peakOf(x);
    if (pk > 0.98) { const y = x === model.base ? new Float32Array(x) : x; const k = 0.98 / pk; for (let i = 0; i < y.length; i++) y[i] *= k; x = y; }
    model._ck = key; model._cp = x;
    return x;
  }
  const renderModel = (model) => shiftSamples(processed(model), model.sr, model.t0 * 1000 + model.params.offset, model.outLen);
  const modelView = (model) => ({ samples: processed(model), sr: model.sr, t0: model.t0, winEnd: model.outLen / model.sr });
  VXP.dsp = { pitchShift, timeStretch, highpass, renderModel, autoAlign, locate };

  /* ================================================================== */
  /*  Перехват ввода микрофона: усиление, мониторинг, детект записи      */
  /* ================================================================== */
  const audioHook = { nodes: new Set(), last: null };
  VXP.audioHook = audioHook;
  function applyGainAll() {
    for (const n of audioHook.nodes) { try { n.gain.gain.setTargetAtTime(dbToLin(settings.gainDb), n.ctx.currentTime, 0.02); } catch {} }
  }
  function updateMonitor(n) {
    const want = settings.monitorSelf && n.recording && !n.src.__vxpNoMonitor;
    try {
      if (want && !n.monitor) {
        n.monitor = n.ctx.createGain(); n.monitor.gain.value = settings.monitorVol;
        n.gain.connect(n.monitor); n.monitor.connect(n.ctx.destination);
      } else if (!want && n.monitor) {
        n.monitor.disconnect(); try { n.gain.disconnect(n.monitor); } catch {}
        n.monitor = null;
      }
    } catch {}
  }
  const updateMonitorAll = () => audioHook.nodes.forEach(updateMonitor);
  (function patchAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !AC.prototype.createMediaStreamSource) return;
    const orig = AC.prototype.createMediaStreamSource;
    const origConnect = AudioNode.prototype.connect;
    const origDisconnect = AudioNode.prototype.disconnect;
    AC.prototype.createMediaStreamSource = function (stream) {
      const src = orig.call(this, stream);
      try {
        const ctx = this, gain = ctx.createGain();
        gain.gain.value = dbToLin(settings.gainDb);
        origConnect.call(src, gain);
        const node = { ctx, src, gain, monitor: null, recording: false, analyser: null };
        audioHook.nodes.add(node); audioHook.last = node;
        src.connect = function (dest, ...rest) {
          if (typeof AudioWorkletNode !== 'undefined' && dest instanceof AudioWorkletNode && !node.recording) {
            node.recording = true; updateMonitor(node);
            if (!src.__vxpOwn) { try { nativeRec.onStart(stream); } catch (e) { console.warn('[Voxalike+]', e); } }
          }
          return gain.connect(dest, ...rest);
        };
        src.disconnect = function (...args) {
          if (!args.length) {
            const was = node.recording;
            node.recording = false; updateMonitor(node);
            try { origDisconnect.call(gain); } catch {}
            audioHook.nodes.delete(node);
            if (audioHook.last === node) audioHook.last = null;
            if (was && !src.__vxpOwn) { try { nativeRec.onStop(); } catch (e) { console.warn('[Voxalike+]', e); } }
            return origDisconnect.call(src);
          }
          return gain.disconnect(...args);
        };
      } catch (e) { console.warn('[Voxalike+] mic hook', e); }
      return src;
    };
  })();
  /* ---------- «чистый микрофон»: без эхо/шумоподавления браузера ---------- */
  // Игра открывает микрофон с echoCancellation (и в режиме по умолчанию с noiseSuppression):
  // эти фильтры браузера приглушают голос, пока играет звук, и «съедают» слоги — отсюда провалы.
  const micTracks = new Set();
  const rawConstraints = (raw) => ({ echoCancellation: !raw, noiseSuppression: !raw, autoGainControl: false });
  (function patchGUM() {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = function (c) {
      try {
        if (settings.rawMic && c && c.audio) {
          const a = typeof c.audio === 'object' ? { ...c.audio } : {};
          Object.assign(a, rawConstraints(true));
          c = { ...c, audio: a };
        }
      } catch {}
      return orig(c).then((s) => {
        try { s.getAudioTracks().forEach((t) => { micTracks.add(t); t.addEventListener('ended', () => micTracks.delete(t)); }); } catch {}
        return s;
      });
    };
  })();
  function applyRawMic() {
    for (const t of micTracks) {
      if (t.readyState !== 'live') { micTracks.delete(t); continue; }
      try { t.applyConstraints(rawConstraints(settings.rawMic)).catch(() => {}); } catch {}
    }
  }
  function meterLevel() {
    const n = audioHook.last;
    if (!n || n.ctx.state === 'closed') return null;
    try {
      if (!n.analyser) { n.analyser = n.ctx.createAnalyser(); n.analyser.fftSize = 1024; n.gain.connect(n.analyser); n.buf = new Float32Array(1024); }
      n.analyser.getFloatTimeDomainData(n.buf);
      return peakOf(n.buf);
    } catch { return null; }
  }

  /* ================================================================== */
  /*  Подмена URL дубля после обработки                                  */
  /* ================================================================== */
  const urlRedirect = new Map();
  const resolveUrl = (u) => { let x = u, g = 0; while (urlRedirect.has(x) && g++ < 50) x = urlRedirect.get(x); return x; };
  (function patchMedia() {
    const P = HTMLMediaElement.prototype, op = P.play;
    P.play = function () {
      try { const s = this.currentSrc || this.src; if (s && urlRedirect.has(s)) { const t = this.currentTime; this.src = resolveUrl(s); try { this.currentTime = t; } catch {} } } catch {}
      return op.apply(this, arguments);
    };
  })();

  /* ================================================================== */
  /*  Состояние комнаты: fetch + WebSocket                               */
  /* ================================================================== */
  const room = { state: null, token: null, playerId: null, code: null };
  VXP.room = room;
  function ingestRoom(obj) {
    if (!obj || typeof obj !== 'object') return;
    const r = obj.room && obj.room.roomCode ? obj.room : obj;
    if (!r || !r.roomCode || !Array.isArray(r.players)) return;
    if (room.code && room.code !== r.roomCode && !r.playerToken) { room.token = null; room.playerId = null; }
    room.code = r.roomCode;
    if (r.playerToken) room.token = r.playerToken;
    if (r.playerId) room.playerId = r.playerId;
    room.state = r;
    emit('room', r);
  }
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    if (url.startsWith('blob:') && urlRedirect.has(url)) return origFetch.call(this, resolveUrl(url), init);
    const isRooms = url.includes('/api/rooms/');
    if (isRooms) {
      try {
        const b = init && init.body;
        let j = null;
        if (typeof b === 'string') j = JSON.parse(b);
        else if (typeof FormData !== 'undefined' && b instanceof FormData && b.get('metadata')) j = JSON.parse(b.get('metadata'));
        if (j && j.playerToken) { room.token = j.playerToken; if (j.roomCode) room.code = j.roomCode; }
      } catch {}
    }
    const res = await origFetch.apply(this, arguments);
    if (isRooms && res.ok && !url.includes('/public')) res.clone().json().then(ingestRoom).catch(() => {});
    return res;
  };
  (function patchWS() {
    const OWS = window.WebSocket;
    if (!OWS) return;
    class VxpWS extends OWS {
      constructor(...a) {
        super(...a);
        try {
          if (String(a[0]).includes('/api/rooms/socket')) {
            this.addEventListener('message', (e) => {
              if (typeof e.data !== 'string' || !e.data.includes('"room-state"')) return;
              try { const j = JSON.parse(e.data); if (j.type === 'room-state' && j.room) ingestRoom(j.room); } catch {}
            });
          }
        } catch {}
      }
    }
    window.WebSocket = VxpWS;
  })();

  /* ================================================================== */
  /*  Доступ к состоянию React-приложения (по форме данных)              */
  /* ================================================================== */
  function fiberOf(el) {
    if (!el) return null;
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  }
  function scanHooks(pred) {
    const start = qs('.single-stage-control-deck') || qs('main') || qs('#root > *');
    let f = fiberOf(start), d = 0;
    while (f && d < 90) {
      if (f.memoizedState && (f.tag === 0 || f.tag === 11 || f.tag === 15)) {
        let hk = f.memoizedState, i = 0;
        while (hk && i < 2000) {
          const v = hk.memoizedState;
          try { if (v && typeof v === 'object' && pred(v)) return v; } catch {}
          hk = hk.next; i++;
        }
      }
      f = f.return; d++;
    }
    return null;
  }
  const isTakeMap = (o) => o && typeof o === 'object' && !Array.isArray(o) &&
    Object.values(o).some((x) => x && x.playerAudio && x.playerAudio.samples instanceof Float32Array);
  const app = {
    takeMap: () => scanHooks((v) => 'current' in v && Object.keys(v).length === 1 && isTakeMap(v.current))?.current || null,
    session: () => scanHooks((v) => v.referenceAudio && v.referenceAudio.samples && v.data && v.data.clip),
    pack: () => scanHooks((v) => Array.isArray(v.clips) && v.clips.length && v.clips[0] && 'videoStartSeconds' in v.clips[0] && 'caption' in v.clips[0]),
    room: () => scanHooks((v) => v.roomCode && v.playerToken && Array.isArray(v.players)),
    mic: () => scanHooks((v) => 'selectedDeviceId' in v && 'devices' in v),
  };
  VXP.app = app;
  function syncRoomFromApp() {
    if (room.token && room.playerId && room.state) return;
    const r = app.room();
    if (r) { room.token = room.token || r.playerToken; room.playerId = room.playerId || r.playerId; if (!room.state || room.state.roomCode !== r.roomCode) ingestRoom(r); }
  }
  function currentClip() {
    const s = app.session(), p = app.pack();
    if (!s || !p) return null;
    return p.clips.find((c) => c.audioUrl && c.audioUrl === s.referenceAudioUrl) ||
      p.clips.find((c) => c.caption === s.data.clip.caption) || null;
  }
  function currentTake() {
    const map = app.takeMap();
    if (!map) return null;
    const clip = currentClip();
    const entries = Object.values(map).filter((e) => e && e.playerAudio);
    return (clip && entries.find((e) => e.clipId === clip.id)) || null;
  }

  /* ================================================================== */
  /*  Аудио-движок: контексты, захват, плеер                             */
  /* ================================================================== */
  let vctx = null;
  const getCtx = () => (vctx && vctx.state !== 'closed' ? vctx : (vctx = new (window.AudioContext || window.webkitAudioContext)()));
  const ctxByRate = new Map();
  function makeBuffer(samples, sr) {
    const ctx = getCtx(), b = ctx.createBuffer(1, Math.max(1, samples.length), sr);
    b.copyToChannel(samples, 0);
    return b;
  }
  const decodeCache = new WeakMap();
  async function decodeBlob(blobOrUrl) {
    let blob = blobOrUrl;
    if (typeof blobOrUrl === 'string') blob = await (await origFetch(blobOrUrl)).blob();
    if (decodeCache.has(blob)) return decodeCache.get(blob);
    const buf = await getCtx().decodeAudioData(await blob.arrayBuffer());
    const res = { samples: mixToMono(buf), sampleRate: buf.sampleRate, duration: buf.duration };
    decodeCache.set(blob, res);
    return res;
  }
  const worklets = new WeakMap();
  function ensureWorklet(ctx) {
    if (worklets.has(ctx)) return worklets.get(ctx);
    const code = `class VxpRec extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(1024);this.n=0;this.s=-1;this.port.onmessage=e=>{if(e.data==='flush'){if(this.n)this.port.postMessage({f:this.s,d:this.b.slice(0,this.n)});this.n=0;this.port.postMessage('done')}}}
process(inp){const x=inp[0];if(x&&x.length){const L=x[0].length;for(let i=0;i<L;i++){if(this.n===0)this.s=currentFrame+i;let v=0;for(let c=0;c<x.length;c++)v+=x[c][i];this.b[this.n++]=v/x.length;if(this.n===this.b.length){this.port.postMessage({f:this.s,d:this.b.slice()});this.n=0}}}return true}}
registerProcessor('vxp-rec',VxpRec);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const p = ctx.audioWorklet.addModule(url);
    worklets.set(ctx, p);
    return p;
  }
  /** Захват микрофона с живыми данными. */
  class Capture {
    static async open(track, { noMonitor = false } = {}) {
      const stream = new MediaStream([track]);
      const rate = (track.getSettings && track.getSettings().sampleRate) || 0;
      let ctx = getCtx(), src;
      const tryCtx = async (c) => { await c.resume().catch(() => {}); await ensureWorklet(c); return c.createMediaStreamSource(stream); };
      try {
        if (IS_FF && rate && rate !== ctx.sampleRate) throw new Error('rate');
        src = await tryCtx(ctx);
      } catch {
        const r = rate || 48000;
        ctx = ctxByRate.get(r) || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: r });
        ctxByRate.set(r, ctx);
        src = await tryCtx(ctx);
      }
      const cap = new Capture();
      Object.assign(cap, { ctx, track, src, sr: ctx.sampleRate, buf: new Float32Array(ctx.sampleRate * 12), len: 0, startFrame: null, onData: null, stopped: false, openedPerf: performance.now() });
      src.__vxpOwn = true; src.__vxpNoMonitor = noMonitor;
      cap.node = new AudioWorkletNode(ctx, 'vxp-rec');
      cap.zero = ctx.createGain(); cap.zero.gain.value = 0;
      cap.node.port.onmessage = (e) => {
        if (e.data === 'done') { cap._done && cap._done(); return; }
        if (cap.stopped) return;
        if (cap.startFrame == null) cap.startFrame = e.data.f;
        cap.push(e.data.d);
        cap.onData && cap.onData(cap);
      };
      src.connect(cap.node); cap.node.connect(cap.zero).connect(ctx.destination);
      return cap;
    }
    push(d) {
      if (this.len + d.length > this.buf.length) { const nb = new Float32Array(this.buf.length * 2); nb.set(this.buf.subarray(0, this.len)); this.buf = nb; }
      this.buf.set(d, this.len); this.len += d.length;
    }
    get startCtx() { return this.startFrame == null ? null : this.startFrame / this.sr; }
    perfToCtx(perf) {
      const ts = this.ctx.getOutputTimestamp ? this.ctx.getOutputTimestamp() : null;
      if (ts && ts.contextTime != null && ts.performanceTime) return ts.contextTime + (perf - ts.performanceTime) / 1000;
      return this.ctx.currentTime - (performance.now() - perf) / 1000;
    }
    get seconds() { return this.len / this.sr; }
    async stop() {
      if (this.stopped) return this.result;
      await new Promise((res) => { this._done = res; try { this.node.port.postMessage('flush'); } catch { res(); } setTimeout(res, 300); });
      this.stopped = true;
      try { this.src.disconnect(); this.node.disconnect(); this.zero.disconnect(); } catch {}
      try { this.track.stop(); } catch {}
      this.result = { samples: this.buf.slice(0, this.len), sr: this.sr, startCtx: this.startCtx };
      return this.result;
    }
    abort() { this.stopped = true; try { this.src.disconnect(); this.node.disconnect(); this.zero.disconnect(); } catch {} try { this.track.stop(); } catch {} }
  }

  /* ---------- плеер ---------- */
  const player = {
    nodes: [], els: [], t0: 0, dur: 0, playing: false, raf: 0, onTick: null, onEnd: null,
    stop() {
      this.nodes.forEach((n) => { try { n.stop(); } catch {} try { n.disconnect(); } catch {} });
      this.els.forEach((e) => { try { e.pause(); } catch {} });
      this.nodes = []; this.els = [];
      cancelAnimationFrame(this.raf);
      const was = this.playing; this.playing = false;
      const end = this.onEnd; this.onTick = this.onEnd = null;
      if (was && end) end();
    },
    async play({ tracks = [], media = [], dur, onTick, onEnd }) {
      this.stop();
      const ctx = getCtx(); await ctx.resume();
      for (const m of media) { try { m.el.currentTime = m.from || 0; m.el.muted = !!m.muted; if (m.vol != null) m.el.volume = m.vol; } catch {} }
      const at = ctx.currentTime + 0.12;
      for (const t of tracks) {
        if (!t || !t.samples) continue;
        const src = ctx.createBufferSource(); src.buffer = makeBuffer(t.samples, t.sr);
        const g = ctx.createGain(); g.gain.value = t.gain ?? 1;
        src.connect(g).connect(ctx.destination);
        if (t.startSec >= 0) src.start(at + t.startSec); else src.start(at, -t.startSec);
        this.nodes.push(src);
      }
      setTimeout(() => { media.forEach((m) => { this.els.push(m.el); m.el.play().catch(() => {}); }); }, 120);
      this.t0 = performance.now() + 120; this.dur = dur; this.playing = true; this.onTick = onTick; this.onEnd = onEnd;
      const loop = () => {
        const t = (performance.now() - this.t0) / 1000;
        if (this.onTick) this.onTick(Math.max(0, t));
        if (t >= this.dur) return this.stop();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    },
  };
  function beep(freq = 880, dur = 0.12, vol = 0.12) {
    try {
      const ctx = getCtx(); ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination);
      const t = ctx.currentTime; g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }

  /* ================================================================== */
  /*  Редактор двух дорожек                                             */
  /* ================================================================== */
  class TrackEditor {
    constructor({ onOffset, onPlay }) {
      this.ref = null; this.take = null; this.live = null; this.offset = 0; this.playhead = null;
      this.onOffset = onOffset; this.onPlay = onPlay;
      this.canvas = h('canvas', { class: 'vxp-tracks', title: 'Перетащите красную дорожку влево/вправо' });
      this.label = h('span', { class: 'vxp-offset' }, fmtMs(0));
      const nudge = (d) => this.setOffset(this.offset + d, true);
      this.btnPlay = h('button', { class: 'vxp-btn', type: 'button', title: 'Оригинал + моя запись вместе', onclick: () => this.onPlay && this.onPlay() }, '▶ Вместе');
      this.toolbar = h('div', { class: 'vxp-row vxp-editbar' },
        h('button', { class: 'vxp-btn icon', type: 'button', title: 'Сдвинуть влево (−10 мс, Shift −50)', onclick: (e) => nudge(e.shiftKey ? -50 : -10) }, '◀'),
        this.label,
        h('button', { class: 'vxp-btn icon', type: 'button', title: 'Сдвинуть вправо (+10 мс, Shift +50)', onclick: (e) => nudge(e.shiftKey ? 50 : 10) }, '▶'),
        h('button', { class: 'vxp-btn', type: 'button', title: 'Автоподгонка к оригиналу', onclick: () => this.auto() }, 'Авто'),
        h('button', { class: 'vxp-btn icon', type: 'button', title: 'Сбросить сдвиг', onclick: () => this.setOffset(0, true) }, '⟲'),
        this.btnPlay);
      this.root = h('div', { class: 'vxp-editor' }, this.canvas, this.toolbar);
      this.bindDrag();
      new ResizeObserver(() => this.draw()).observe(this.canvas);
      this._rafPending = false;
    }
    /** take = {samples, sr, t0, winEnd} */
    set(ref, take, offset) {
      this.ref = ref; this.take = take; this.offset = offset || 0;
      this.label.textContent = fmtMs(this.offset);
      this.draw();
    }
    /** live = {buf, len, sr, t0} или null */
    setLive(live) { this.live = live; this.requestDraw(); }
    requestDraw() { if (this._rafPending) return; this._rafPending = true; requestAnimationFrame(() => { this._rafPending = false; this.draw(); }); }
    setPlaying(p) { this.btnPlay.textContent = p ? '■ Стоп' : '▶ Вместе'; }
    setOffset(ms, commit) {
      this.offset = clamp(Math.round(ms), -9000, 9000);
      this.label.textContent = fmtMs(this.offset);
      this.draw();
      if (commit && this.onOffset) this.onOffset(this.offset);
    }
    auto() {
      if (!this.ref || !this.take) return toast('Нет записи для подгонки');
      const ms = autoAlign(this.ref.samples, this.ref.sr, this.take.samples, this.take.sr, this.take.t0);
      this.setOffset(ms, true);
      toast('Автоподгонка: ' + fmtMs(ms));
    }
    view() {
      const rd = this.ref ? this.ref.samples.length / this.ref.sr : 0;
      let start = -0.3, end = Math.max(rd, 1) + 0.3;
      const tk = this.live ? { t0: this.live.t0, dur: this.live.len / this.live.sr, winEnd: this.live.winEnd || 0 } : this.take ? { t0: this.take.t0 + this.offset / 1000, dur: this.take.samples.length / this.take.sr, winEnd: this.take.winEnd } : null;
      if (tk) {
        start = Math.min(start, Math.max(-4, tk.t0 - 0.1));
        end = Math.max(end, (tk.winEnd || 0) + 0.3, Math.min(tk.t0 + tk.dur + 0.1, 14));
      }
      return { start, end };
    }
    bindDrag() {
      let drag = null;
      this.canvas.addEventListener('pointerdown', (e) => {
        if (!this.take || this.live) return;
        const r = this.canvas.getBoundingClientRect(), v = this.view();
        drag = { x: e.clientX, w: r.width, o: this.offset, v };
        this.canvas.setPointerCapture(e.pointerId);
        this.canvas.classList.add('dragging');
      });
      this.canvas.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const secPerPx = (drag.v.end - drag.v.start) / drag.w;
        let ms = drag.o + (e.clientX - drag.x) * secPerPx * 1000;
        ms = e.altKey ? ms : Math.round(ms / 5) * 5;
        this.offset = clamp(Math.round(ms), -9000, 9000);
        this.label.textContent = fmtMs(this.offset);
        this.draw(drag.v);
      });
      const end = () => { if (!drag) return; drag = null; this.canvas.classList.remove('dragging'); this.draw(); if (this.onOffset) this.onOffset(this.offset); };
      this.canvas.addEventListener('pointerup', end);
      this.canvas.addEventListener('pointercancel', end);
    }
    draw(fixedView) {
      const c = this.canvas, dpr = window.devicePixelRatio || 1;
      const W = Math.max(50, c.clientWidth), H = Math.max(40, c.clientHeight);
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const v = fixedView || this.view(), span = v.end - v.start, x = (t) => ((t - v.start) / span) * W;
      const ruler = 14, laneH = (H - ruler - 6) / 2;
      g.font = '600 9px Nunito Variable, system-ui, sans-serif';
      const step = span > 10 ? 2 : span > 5 ? 1 : 0.5;
      for (let t = Math.ceil(v.start / step) * step; t <= v.end; t += step) {
        const X = Math.round(x(t)) + 0.5;
        g.fillStyle = 'rgba(247,247,255,.35)'; g.fillRect(X, ruler - 4, 1, 4);
        if (Math.abs(t - Math.round(t)) < 1e-6) g.fillText(Math.round(t) + 'с', X + 2, 9);
      }
      g.fillStyle = 'rgba(78,231,210,.4)'; g.fillRect(Math.round(x(0)), ruler, 1, H - ruler);
      const wave = (y0, s, len, sr, offSec, color) => {
        const mid = y0 + laneH / 2;
        g.fillStyle = color;
        const a0 = x(offSec), a1 = x(offSec + len / sr);
        for (let px = Math.max(0, Math.floor(a0)); px < Math.min(W, Math.ceil(a1)); px++) {
          const t0 = v.start + (px / W) * span - offSec, t1 = t0 + span / W;
          const i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(len, Math.ceil(t1 * sr));
          let mx = 0; const stp = Math.max(1, Math.floor((i1 - i0) / 48));
          for (let k = i0; k < i1; k += stp) { const a = s[k] < 0 ? -s[k] : s[k]; if (a > mx) mx = a; }
          const hh = Math.max(1, Math.min(1, Math.sqrt(mx) * 1.05) * (laneH / 2 - 2));
          g.fillRect(px, mid - hh, 1, hh * 2);
        }
        return [a0, a1];
      };
      const tag = (y0, name, color) => {
        g.font = '900 9px Nunito Variable, system-ui, sans-serif';
        g.fillStyle = 'rgba(5,8,14,.78)'; g.fillRect(3, y0 + 3, g.measureText(name).width + 10, 14);
        g.fillStyle = color; g.fillText(name, 8, y0 + 13);
      };
      // дорожка 1 — оригинал
      const y1 = ruler + 2;
      g.fillStyle = 'rgba(78,231,210,.05)'; g.fillRect(0, y1, W, laneH);
      if (this.ref) wave(y1, this.ref.samples, this.ref.samples.length, this.ref.sr, 0, '#4ee7d2');
      else { g.fillStyle = 'rgba(247,247,255,.28)'; g.font = '700 10px Nunito Variable, system-ui, sans-serif'; g.fillText('Нет оригинала', 8, y1 + laneH / 2 + 3); }
      tag(y1, 'ОРИГИНАЛ', '#4ee7d2');
      // дорожка 2 — моя
      const y2 = ruler + 4 + laneH;
      g.fillStyle = 'rgba(255,138,122,.06)'; g.fillRect(0, y2, W, laneH);
      let winEnd = null;
      if (this.live) {
        wave(y2, this.live.buf, this.live.len, this.live.sr, this.live.t0, '#ff6b6b');
        winEnd = this.live.winEnd;
        const xe = x(this.live.t0 + this.live.len / this.live.sr);
        g.fillStyle = '#ff6b6b'; g.fillRect(Math.round(xe), y2, 2, laneH);
        tag(y2, '● ЗАПИСЬ', '#ff6b6b');
      } else if (this.take) {
        const [a0, a1] = wave(y2, this.take.samples, this.take.samples.length, this.take.sr, this.take.t0 + this.offset / 1000, '#ff8a7a');
        g.strokeStyle = 'rgba(255,138,122,.75)'; g.lineWidth = 1; g.strokeRect(Math.round(a0) + 0.5, y2 + 0.5, Math.max(1, Math.round(a1 - a0)), laneH - 1);
        winEnd = this.take.winEnd;
        tag(y2, 'МОЯ ' + (this.offset ? fmtMs(this.offset) : ''), '#ff8a7a');
      } else {
        g.fillStyle = 'rgba(247,247,255,.28)'; g.font = '700 10px Nunito Variable, system-ui, sans-serif'; g.fillText('Нет записи', 8, y2 + laneH / 2 + 3);
        tag(y2, 'МОЯ', '#ff8a7a');
      }
      // окно, которое уходит в игру
      if (winEnd) {
        const xa = x(0), xb = x(winEnd);
        g.fillStyle = 'rgba(2,4,8,.62)';
        if (xa > 0) g.fillRect(0, y2, xa, laneH);
        if (xb < W) g.fillRect(xb, y2, W - xb, laneH);
        g.fillStyle = 'rgba(245,196,81,.8)'; g.fillRect(Math.round(xb), ruler, 1, H - ruler);
      }
      if (this.playhead != null) { g.fillStyle = '#f7f7ff'; g.fillRect(Math.round(x(this.playhead)), ruler, 1.5, H - ruler); }
    }
  }

  /* ================================================================== */
  /*  Тосты и стили                                                      */
  /* ================================================================== */
  let toastBox = null;
  function toast(msg, kind = '') {
    if (!document.body) return;
    if (!toastBox || !toastBox.isConnected) { toastBox = h('div', { class: 'vxp-toasts' }); document.body.append(toastBox); }
    const t = h('div', { class: 'vxp-toast ' + kind }, msg);
    toastBox.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }
  VXP.toast = toast;

  const CSS = `
.vxp-panel{display:grid;gap:8px;padding:10px;border:1px solid rgba(247,247,255,.12);border-radius:8px;background:rgba(5,9,16,.6);color:#f7f7ff;font-family:inherit;min-width:0}
.vxp-sec{display:grid;gap:7px;min-width:0}
.vxp-sec+.vxp-sec{padding-top:8px;border-top:1px solid rgba(247,247,255,.08)}
.vxp-title{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;font-weight:950;letter-spacing:.05em;text-transform:uppercase;color:#4ee7d2;cursor:pointer;user-select:none}
.vxp-title .vxp-caret{color:rgba(247,247,255,.45);font-size:10px;transition:transform .15s}
.vxp-sec.collapsed .vxp-caret{transform:rotate(-90deg)}
.vxp-sec.collapsed>:not(.vxp-title){display:none!important}
.vxp-badge{font-size:9px;font-weight:900;color:#04131a;background:#4ee7d2;border-radius:999px;padding:1px 6px;letter-spacing:.04em}
.vxp-badge.warn{background:#f5c451}
.vxp-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.vxp-btn{height:30px;min-height:0;min-width:0;padding:0 10px;border-radius:8px;border:1px solid rgba(247,247,255,.16);background:#111827;color:#f7f7ff;font-weight:800;font-size:12px;line-height:1;font-family:inherit;box-shadow:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;transition:border-color .12s,background .12s,transform .06s}
.vxp-btn:hover:not([disabled]){border-color:rgba(78,231,210,.65)}
.vxp-btn:active:not([disabled]){transform:translateY(1px)}
.vxp-btn.icon{width:30px;padding:0}
.vxp-btn.primary{background:linear-gradient(180deg,#63f2df,#2fc7b2);color:#03141a;border-color:transparent}
.vxp-btn.rec{background:linear-gradient(180deg,#ff6b6b,#d9363e);border-color:transparent}
.vxp-btn.wide{flex:1 1 auto}
.vxp-btn.small{height:24px;padding:0 8px;font-size:11px}
.vxp-btn[disabled]{opacity:.45;cursor:default}
.vxp-editor{display:grid;gap:6px;min-width:0}
canvas.vxp-tracks{width:100%;height:104px;display:block;border-radius:6px;background:#04070d;border:1px solid rgba(247,247,255,.08);cursor:grab;touch-action:none}
canvas.vxp-tracks.dragging{cursor:grabbing}
canvas.vxp-tracks.big{height:150px}
.vxp-editbar{justify-content:space-between}
.vxp-offset{min-width:62px;text-align:center;font-size:12px;font-weight:900;color:#ff8a7a;font-variant-numeric:tabular-nums}
.vxp-slider{display:grid;grid-template-columns:minmax(0,92px) 1fr 52px;gap:8px;align-items:center;font-size:12px;font-weight:800}
.vxp-slider>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vxp-slider input{width:100%;accent-color:#4ee7d2;min-width:0;min-height:0;height:18px;margin:0}
.vxp-slider output{text-align:right;font-variant-numeric:tabular-nums;color:#4ee7d2;font-weight:900;white-space:nowrap}
.vxp-meter{height:5px;border-radius:3px;background:#0b1220;overflow:hidden;position:relative}
.vxp-meter>i{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,#4ee7d2 0%,#4ee7d2 60%,#f5c451 82%,#ff5d5d 100%);background-size:var(--w,258px) 100%;transition:width .06s linear}
.vxp-meter.idle>i{width:0!important}
.vxp-check{display:flex;gap:8px;align-items:center;font-size:12px;font-weight:750;cursor:pointer;line-height:1.2}
.vxp-check input{accent-color:#4ee7d2;width:16px;height:16px;min-height:0;margin:0;flex:none}
.vxp-check.disabled{opacity:.45;cursor:default}
.vxp-select{height:26px;min-height:0;padding:0 6px;border-radius:6px;border:1px solid rgba(247,247,255,.16);background:#111827;color:#f7f7ff;font:inherit;font-size:12px;font-weight:800}
.vxp-inline{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:750}
.vxp-hint{font-size:11px;color:rgba(247,247,255,.5);line-height:1.3}
.vxp-hint.warn{color:#f5c451}
.vxp-lines{display:grid;gap:4px;max-height:200px;overflow:auto;padding-right:2px}
.vxp-line{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;background:#0c1321;border:1px solid transparent;font-size:12px;cursor:pointer;min-width:0}
.vxp-line:hover{border-color:rgba(78,231,210,.4)}
.vxp-line.active{border-color:#4ee7d2;background:#0f1d2b}
.vxp-line .n{font-weight:900;color:rgba(247,247,255,.5);font-variant-numeric:tabular-nums}
.vxp-line .c{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.vxp-chip{font-size:9px;font-weight:950;padding:2px 6px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
.vxp-chip.sent{background:rgba(78,231,210,.16);color:#4ee7d2}
.vxp-chip.ready{background:rgba(245,196,81,.16);color:#f5c451}
.vxp-chip.now{background:rgba(255,107,107,.18);color:#ff8a7a}
.vxp-chip.todo{background:rgba(247,247,255,.08);color:rgba(247,247,255,.55)}
.vxp-chip.sending{background:rgba(124,156,255,.18);color:#9fb4ff}
.vxp-status{font-size:12px;font-weight:750;color:rgba(247,247,255,.75);line-height:1.35}
.vxp-status b{color:#f7f7ff}
.vxp-toasts{position:fixed;right:16px;bottom:16px;display:grid;gap:8px;z-index:2147483646;pointer-events:none}
.vxp-toast{background:#0b1220;border:1px solid rgba(78,231,210,.45);color:#f7f7ff;padding:9px 12px;border-radius:8px;font:800 13px/1.3 "Nunito Variable",system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);transition:opacity .3s,transform .3s;max-width:340px}
.vxp-toast.err{border-color:rgba(255,93,93,.6)}
.vxp-toast.out{opacity:0;transform:translateY(6px)}
.vxp-count{position:fixed;z-index:2147483500;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:rgba(0,0,0,.42);border-radius:8px;cursor:pointer;font-family:"Nunito Variable",system-ui,sans-serif;color:#f7f7ff}
.vxp-count.in{position:absolute;inset:0}
.vxp-count b{font-size:clamp(64px,14vw,150px);line-height:1;font-weight:950;text-shadow:0 0 34px rgba(78,231,210,.85);animation:vxpPop .95s ease-out both}
.vxp-count small{font-size:12px;font-weight:800;color:rgba(247,247,255,.75)}
@keyframes vxpPop{0%{transform:scale(1.45);opacity:0}18%{opacity:1}100%{transform:scale(.92);opacity:.9}}
.vxp-studio{position:fixed;inset:0;z-index:2147483600;background:rgba(2,4,8,.78);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Nunito Variable","Arial Rounded MT Bold",system-ui,sans-serif;color:#f7f7ff}
.vxp-card{width:min(1080px,100%);max-height:calc(100vh - 32px);overflow:auto;background:rgba(10,15,25,.97);border:1px solid rgba(78,231,210,.35);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.6);display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;padding:14px}
.vxp-card-head{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:10px}
.vxp-card-head h3{margin:0;font-size:16px;font-weight:950}
.vxp-card-head small{display:block;color:#4ee7d2;font-size:11px;font-weight:950;letter-spacing:.06em;text-transform:uppercase}
.vxp-stagebox{display:grid;gap:10px;min-width:0}
.vxp-video{position:relative;border:2px solid rgba(78,231,210,.55);border-radius:8px;background:#000;aspect-ratio:16/9;overflow:hidden}
.vxp-video video{width:100%;height:100%;object-fit:contain;display:block}
.vxp-cue{position:absolute;left:10px;top:10px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:950;letter-spacing:.06em;background:rgba(0,0,0,.6);display:none;z-index:2}
.vxp-cue.on{display:block}.vxp-cue.ready{color:#f5c451}.vxp-cue.rec{color:#ff6b6b}.vxp-cue.tail{color:#f5c451}
.vxp-sub{border-top:1px solid rgba(78,231,210,.4);padding:8px 2px 0}
.vxp-sub span{display:block;color:#4ee7d2;font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.04em}
.vxp-sub p{margin:4px 0 0;font-size:17px;font-weight:900;line-height:1.3}
.vxp-side{display:grid;gap:10px;align-content:start;min-width:0}
.vxp-side .vxp-lines{max-height:260px}
@media (max-width:860px){.vxp-card{grid-template-columns:1fr}.vxp-side .vxp-lines{max-height:160px}}
`;
  function injectCss() {
    if (qs('#vxp-style')) return;
    (document.head || document.documentElement).append(h('style', { id: 'vxp-style' }, CSS));
  }

  /* ================================================================== */
  /*  Общие виджеты: микрофон, обработка, отсчёт/буфер                   */
  /* ================================================================== */
  const widgets = new Set(); // элементы с ._sync()
  function syncWidgets() { for (const w of widgets) { if (!w.isConnected) { widgets.delete(w); continue; } try { w._sync(); } catch {} } }
  function slider({ label, min, max, step = 1, get, set, fmt, title, onCommit }) {
    const out = h('output');
    const range = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), title });
    const show = (v) => { out.textContent = fmt(v); };
    range.addEventListener('input', () => { set(+range.value, false); show(+range.value); });
    range.addEventListener('change', () => { set(+range.value, true); onCommit && onCommit(+range.value); });
    range.addEventListener('dblclick', () => { range.value = '0'; set(0, true); show(0); onCommit && onCommit(0); });
    const el = h('label', { class: 'vxp-slider', title }, h('span', null, label), range, out);
    el._sync = () => { const v = get(); if (document.activeElement !== range) range.value = String(v); show(v); };
    el._sync(); widgets.add(el);
    return el;
  }
  function checkbox({ label, get, set, title }) {
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => { set(cb.checked); syncWidgets(); });
    const el = h('label', { class: 'vxp-check', title }, cb, label);
    el._sync = () => { cb.checked = !!get(); };
    el._sync(); widgets.add(el);
    return el;
  }
  function selectRow({ label, options, get, set, title }) {
    const sel = h('select', { class: 'vxp-select', title }, options.map(([v, t]) => h('option', { value: String(v) }, t)));
    sel.addEventListener('change', () => { set(+sel.value); saveSettings(); syncWidgets(); });
    const el = h('label', { class: 'vxp-inline', title }, h('span', null, label), sel);
    el._sync = () => { sel.value = String(get()); };
    el._sync(); widgets.add(el);
    return el;
  }
  function micControls() {
    const meter = h('div', { class: 'vxp-meter idle', title: 'Уровень микрофона (виден во время записи)' }, h('i'));
    meters.add(meter);
    return h('div', { style: 'display:grid;gap:7px' },
      slider({ label: '🎙 Микрофон', min: -12, max: 12, get: () => settings.gainDb, set: (v) => { settings.gainDb = v; applyGainAll(); saveSettings(); }, fmt: (v) => fmtSigned(v, 'дБ') || '0 дБ', title: 'Усиление микрофона — действует сразу, даже во время записи. Двойной клик — сброс' }),
      meter,
      checkbox({ label: 'Слушать себя при записи', get: () => settings.monitorSelf, set: (v) => { settings.monitorSelf = v; saveSettings(); updateMonitorAll(); }, title: 'Свой голос в наушниках во время записи' }),
      checkbox({ label: 'Чистый микрофон (без провалов)', get: () => settings.rawMic, set: (v) => { settings.rawMic = v; saveSettings(); applyRawMic(); }, title: 'Отключает эхо- и шумоподавление браузера, из-за которых голос проваливается. С включённым оригиналом при записи нужны наушники' }),
    );
  }
  function timingControls() {
    return h('div', { style: 'display:grid;gap:6px' },
      selectRow({ label: 'Отсчёт перед записью', options: [[0, 'нет'], [3, '3 с'], [5, '5 с']], get: () => settings.countdown, set: (v) => { settings.countdown = v; }, title: 'Обратный отсчёт 3-2-1 после нажатия «Записать»' }),
      selectRow({ label: 'Буфер после реплики', options: [[0, 'нет'], [3, '3 с'], [5, '5 с'], [8, '8 с']], get: () => settings.tailSec, set: (v) => { settings.tailSec = v; }, title: 'Запись продолжается после конца реплики — опоздавшую фразу можно перетащить влево' }),
      checkbox({ label: 'Звук отсчёта', get: () => settings.countBeep, set: (v) => { settings.countBeep = v; saveSettings(); } }),
    );
  }
  const fmtSemi = (v) => (v ? fmtSigned(v, 'пт') : '0');
  /** Обработка: target() → {model, apply()} | null */
  function fxControls(target) {
    let timer = 0;
    const commit = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const t = target(); if (!t) return;
        Object.assign(t.model.params, { pitch: settings.fx.pitch, gain: settings.fx.gain, lowcut: settings.fx.lowcut });
        t.apply();
      }, 60);
    };
    const set = (k) => (v, done) => { settings.fx[k] = v; if (done) { saveSettings(); commit(); } };
    const lowcut = checkbox({ label: 'Срез низов (убрать гул)', get: () => settings.fx.lowcut, set: (v) => { settings.fx.lowcut = v; saveSettings(); commit(); }, title: 'Фильтр высоких частот 90 Гц' });
    const reset = h('button', { class: 'vxp-btn small', type: 'button', onclick: () => { settings.fx = { ...DEF_FX }; saveSettings(); syncWidgets(); commit(); } }, 'Сбросить');
    return h('div', { style: 'display:grid;gap:7px' },
      slider({ label: '🔊 Громкость', min: -12, max: 12, get: () => settings.fx.gain, set: set('gain'), fmt: (v) => fmtSigned(v, 'дБ') || '0 дБ', title: 'Громкость моей дорожки (с защитой от перегруза). Двойной клик — сброс' }),
      slider({ label: '🎚 Питч', min: -12, max: 12, step: 1, get: () => settings.fx.pitch, set: set('pitch'), fmt: fmtSemi, title: 'Высота голоса в полутонах, длительность не меняется. Двойной клик — сброс' }),
      h('div', { class: 'vxp-inline' }, lowcut, reset),
      h('div', { class: 'vxp-hint' }, 'Обработка применяется к записи и сохраняется для следующих дублей.'));
  }
  const meters = new Set();
  function tickMeters() {
    const lvl = meterLevel();
    for (const m of meters) {
      if (!m.isConnected) { meters.delete(m); continue; }
      m.classList.toggle('idle', lvl == null);
      if (lvl != null) { m.firstChild.style.width = clamp(Math.sqrt(lvl) * 100, 0, 100) + '%'; m.style.setProperty('--w', m.clientWidth + 'px'); }
    }
    requestAnimationFrame(tickMeters);
  }
  requestAnimationFrame(tickMeters);

  /* ---------- отсчёт ---------- */
  /** Показывает 3-2-1 поверх rectEl (или внутри host). Возвращает true, если не отменён. */
  function countdown(secs, { rectEl, host } = {}) {
    return new Promise((resolve) => {
      if (!secs) return resolve(true);
      const num = h('b'), el = h('div', { class: 'vxp-count' + (host ? ' in' : ''), title: 'Клик или Esc — отмена' }, num, h('small', null, 'Приготовьтесь · Esc — отмена'));
      if (host) host.append(el);
      else {
        const r = (rectEl && rectEl.getBoundingClientRect()) || { left: innerWidth / 2 - 150, top: innerHeight / 2 - 100, width: 300, height: 200 };
        Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        document.body.append(el);
      }
      let n = secs, timer = 0, done = false;
      const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); el.remove(); document.removeEventListener('keydown', onKey, true); resolve(ok); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
      document.addEventListener('keydown', onKey, true);
      el.addEventListener('click', () => finish(false));
      const tick = () => {
        if (n <= 0) { if (settings.countBeep) beep(1320, 0.18, 0.14); finish(true); return; }
        num.textContent = String(n);
        num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
        if (settings.countBeep) beep(880, 0.1, 0.1);
        n--; timer = setTimeout(tick, 1000);
      };
      tick();
    });
  }

  /* ================================================================== */
  /*  Дубли игры: модель, обработка, буфер                              */
  /* ================================================================== */
  const takeOrig = new WeakMap();   // playerAudio -> исходные сэмплы игры
  const takeModels = new WeakMap(); // playerAudio -> model
  const ownUrls = new Set();        // URL дублей, созданные модом (старые освобождаем)
  function origSamplesOf(pa) {
    let o = takeOrig.get(pa);
    if (!o) { o = new Float32Array(pa.samples); takeOrig.set(pa, o); }
    return o;
  }
  function nativeModel(pa) {
    let m = takeModels.get(pa);
    if (!m) {
      m = { base: origSamplesOf(pa), sr: pa.sampleRate, t0: 0, outLen: pa.samples.length, params: defaultParams(), ext: false };
      takeModels.set(pa, m);
    }
    return m;
  }
  function applyNative(entry) {
    const pa = entry && entry.playerAudio;
    if (!pa) return;
    const m = nativeModel(pa);
    pa.samples.set(isDefaultParams(m.params) ? origSamplesOf(pa) : renderModel(m));
    const old = entry.playerUrl;
    const url = URL.createObjectURL(encodeWav(pa.samples, pa.sampleRate));
    ownUrls.add(url);
    if (old) {
      urlRedirect.set(old, url);
      if (ownUrls.has(old)) { ownUrls.delete(old); setTimeout(() => URL.revokeObjectURL(old), 4000); }
    }
    entry.playerUrl = url; // новый ключ → игра заново кодирует и отправит обработанный дубль
    qsa('audio').forEach((a) => {
      const s = a.currentSrc || a.src;
      if (s && s !== url && resolveUrl(s) === url) { const paused = a.paused; a.src = url; if (!paused) a.play().catch(() => {}); }
    });
  }
  /** Подключить расширенную запись (с буфером) к дублю игры. */
  function attachExt(pa, ext, expectSec) {
    const m = nativeModel(pa);
    const big = resample(ext.samples, ext.sr, pa.sampleRate);
    const orig = origSamplesOf(pa);
    if (big.length < orig.length * 0.8) return false;
    const L = locate(orig, big, pa.sampleRate, expectSec); // orig[0] == big[L]
    const r1 = rms(orig), r2 = rms(big, Math.max(0, L), Math.min(big.length, L + orig.length));
    const k = r2 > 1e-5 ? clamp(r1 / r2, 0.25, 8) : 1;
    if (k !== 1) for (let i = 0; i < big.length; i++) big[i] *= k;
    m.base = big; m.t0 = -L / pa.sampleRate; m.ext = true; m.extTail = (big.length - L - orig.length) / pa.sampleRate;
    m._ck = null; m._cp = null;
    return true;
  }

  /** Параллельная запись к родной записи игры: живая волна + буфер после реплики. */
  const nativeRec = {
    cap: null, takeBefore: null, anchorCtx: null, phase: 'idle', tailTimer: 0, tailEnd: 0, pre: false,
    async preStart() {
      // во время отсчёта: начинаем захват заранее, если микрофон игры уже открыт
      const m = app.mic(); const tr = m && m.stream && m.stream.getAudioTracks && m.stream.getAudioTracks()[0];
      if (!tr || tr.readyState !== 'live') return;
      this.reset();
      try { this.cap = await Capture.open(tr.clone(), { noMonitor: true }); this.pre = true; this.phase = 'pre'; this.bindLive(); } catch (e) { console.warn('[Voxalike+] pre capture', e); }
    },
    async onStart(stream) {
      this.takeBefore = (currentTake() || {}).playerAudio || null;
      this.anchorCtx = null;
      if (!(this.cap && this.pre && !this.cap.stopped && performance.now() - this.cap.openedPerf < 15000)) {
        this.reset();
        const tr = stream.getAudioTracks && stream.getAudioTracks()[0];
        if (!tr) return;
        try { this.cap = await Capture.open(tr.clone(), { noMonitor: true }); } catch (e) { console.warn('[Voxalike+] capture', e); return; }
        this.bindLive();
      }
      this.pre = false; this.phase = 'rec';
      const startPerf = performance.now();
      const vid = qs('.talk-stage-frame video') || qs('main video');
      if (vid) {
        const mark = () => { if (this.cap && this.anchorCtx == null) this.anchorCtx = this.cap.perfToCtx(performance.now()); };
        vid.addEventListener('playing', mark, { once: true });
        setTimeout(() => { if (this.cap && this.anchorCtx == null) this.anchorCtx = this.cap.perfToCtx(startPerf + 650); }, 1500);
      }
    },
    onStop() {
      if (!this.cap || this.phase !== 'rec') return;
      const tail = settings.tailSec;
      this.phase = 'tail'; this.tailEnd = performance.now() + tail * 1000;
      clearTimeout(this.tailTimer);
      this.tailTimer = setTimeout(() => this.finish(), tail * 1000);
      emit('native-rec');
    },
    bindLive() {
      const cap = this.cap;
      cap.onData = () => emit('native-live', cap);
    },
    liveView() {
      const cap = this.cap;
      if (!cap || cap.startCtx == null || this.phase === 'idle') return null;
      const anchor = this.anchorCtx != null ? this.anchorCtx : cap.startCtx + (this.phase === 'pre' ? settings.countdown + 0.6 : 0.6);
      const s = app.session();
      const dur = s && s.referenceAudio ? s.referenceAudio.samples.length / s.referenceAudio.sampleRate : 0;
      return { buf: cap.buf, len: cap.len, sr: cap.sr, t0: cap.startCtx - anchor, winEnd: dur ? dur + 0.4 : 0 };
    },
    async finish() {
      clearTimeout(this.tailTimer);
      const cap = this.cap; if (!cap) return;
      this.cap = null; this.phase = 'idle';
      const ext = await cap.stop();
      const expect = this.anchorCtx != null && ext.startCtx != null ? this.anchorCtx - ext.startCtx : null;
      emit('native-rec');
      // ждём, пока игра создаст новый дубль
      let pa = null;
      for (let i = 0; i < 30; i++) {
        const t = currentTake();
        if (t && t.playerAudio && t.playerAudio !== this.takeBefore) { pa = t.playerAudio; break; }
        await sleep(150);
      }
      if (!pa || !ext.samples.length) return;
      try {
        if (attachExt(pa, ext, expect)) {
          const t = currentTake();
          if (t && t.playerAudio === pa && !isDefaultParams(nativeModel(pa).params)) applyNative(t);
          emit('native-ext', pa);
        }
      } catch (e) { console.warn('[Voxalike+] attach', e); }
    },
    reset() {
      clearTimeout(this.tailTimer);
      if (this.cap) { this.cap.abort(); this.cap = null; }
      this.phase = 'idle'; this.pre = false;
    },
  };
  VXP.nativeRec = nativeRec;

  /* ---------- отсчёт перед родной кнопкой «Записать» ---------- */
  let passClick = false, counting = false;
  document.addEventListener('click', async (e) => {
    const btn = e.target && e.target.closest && e.target.closest('.stage-record-button');
    if (!btn || passClick || btn.disabled) return;
    if (!settings.countdown && !settings.tailSec) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (counting) return;
    counting = true;
    try {
      nativeRec.preStart();
      const ok = await countdown(settings.countdown, { rectEl: qs('.talk-stage-frame') || qs('.single-performance-stage') });
      if (!ok) { nativeRec.reset(); emit('native-rec'); return; }
      passClick = true;
      try { btn.click(); } finally { passClick = false; }
    } finally { counting = false; }
  }, true);

  /* ================================================================== */
  /*  Очередь заранее записанных реплик (сетевая игра «Совместно»)       */
  /* ================================================================== */
  const queue = new Map(); // key -> {index, clipId, model, status, error}
  VXP.queue = queue;
  const gameKey = (g) => (room.state ? room.state.roomId : '?') + '|' + (g && g.startedAt);
  const qKey = (g, i) => gameKey(g) + '|' + i;
  const myId = () => room.playerId || (room.state && room.state.playerId);
  function myLines() {
    const g = room.state && room.state.game, me = myId();
    if (!g || !me || g.mode !== 'coop') return [];
    return g.assignments.filter((a) => a.playerId === me);
  }
  function lineStatus(g, a) {
    if (g.takes.some((t) => t.assignmentIndex === a.index)) return 'sent';
    const q = queue.get(qKey(g, a.index));
    if (q && q.status === 'sending') return 'sending';
    if (q && q.status === 'ready') return 'ready';
    if (g.currentAssignmentIndex === a.index) return 'now';
    return 'todo';
  }
  const STATUS_TEXT = { sent: 'Отправлено', ready: 'В очереди', now: 'Сейчас', todo: 'Не записано', sending: 'Отправка…' };

  let submitBusy = false;
  async function trySubmit() {
    if (submitBusy || !settings.autoSubmit) return;
    syncRoomFromApp();
    const r = room.state, g = r && r.game;
    if (!g || g.completedAt || g.mode !== 'coop' || !room.token) return;
    const i = g.currentAssignmentIndex, a = g.assignments[i];
    if (!a || a.playerId !== myId()) return;
    if (g.takes.some((t) => t.assignmentIndex === i)) return;
    const q = queue.get(qKey(g, i));
    if (!q || q.status !== 'ready') return;
    submitBusy = true; q.status = 'sending'; emit('queue');
    try {
      const up = prepareUpload(renderModel(q.model), q.model.sr);
      const meta = {
        roomCode: r.roomCode, playerToken: room.token, assignmentIndex: i, clipId: a.clipId,
        turnKey: JSON.stringify([g.startedAt, i, a.clipId, a.playerId, g.lastRedoAt ?? '']), stage: 'final',
      };
      const fd = new FormData();
      fd.set('metadata', JSON.stringify(meta));
      fd.set('audio', encodeWav(up.samples, up.sampleRate), 'room-take.wav');
      const res = await window.fetch('/api/rooms/audio', { method: 'POST', headers: { 'x-voxalike-request-id': crypto.randomUUID() }, body: fd });
      if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).error || msg; } catch {} throw new Error(msg); }
      q.status = 'sent';
      toast('✓ Реплика #' + (i + 1) + ' отправлена автоматически');
    } catch (e) {
      q.status = 'ready'; q.error = e.message;
      toast('Не удалось отправить #' + (i + 1) + ': ' + e.message, 'err');
      await sleep(2500);
    } finally { submitBusy = false; emit('queue'); setTimeout(trySubmit, 300); }
  }
  onBus('room', () => { trySubmit(); turnNotify(); });
  let lastAppRoom = null;
  setInterval(() => {
    try {
      const r = app.room();
      if (r && r !== lastAppRoom) {
        lastAppRoom = r;
        if (r.playerToken) room.token = r.playerToken;
        if (r.playerId) room.playerId = r.playerId;
        const cur = room.state && room.state.game, nxt = r.game;
        const newer = !cur || !nxt || cur.startedAt !== nxt.startedAt ||
          nxt.currentAssignmentIndex > cur.currentAssignmentIndex || nxt.takes.length > cur.takes.length || !!nxt.completedAt !== !!cur.completedAt;
        if (room.state === null || room.state.roomCode !== r.roomCode || newer) ingestRoom(r);
      }
    } catch {}
    trySubmit();
  }, 1000);

  /* ---------- уведомление о ходе ---------- */
  let notifiedKey = '', titleTimer = 0, origTitle = '';
  function turnNotify() {
    if (!settings.notifyTurn) return;
    const g = room.state && room.state.game;
    if (!g || g.completedAt) return;
    const a = g.assignments[g.currentAssignmentIndex];
    if (!a || a.playerId !== myId()) return;
    const k = qKey(g, a.index);
    if (notifiedKey === k || queue.has(k)) return;
    notifiedKey = k;
    if (document.hidden) {
      beep(880, 0.35, 0.15);
      origTitle = origTitle || document.title;
      let on = false; clearInterval(titleTimer);
      titleTimer = setInterval(() => { document.title = (on = !on) ? '🎙 Ваш ход!' : origTitle; }, 900);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && titleTimer) { clearInterval(titleTimer); titleTimer = 0; if (origTitle) document.title = origTitle; }
  });

  /* ================================================================== */
  /*  Панель на сцене озвучки                                            */
  /* ================================================================== */
  const panel = { root: null, editor: null, takeRef: null, refRef: null, lastQueueSig: '', bufInfo: null };

  function section(id, title, ...body) {
    const sec = h('div', { class: 'vxp-sec' + (settings.collapsed[id] ? ' collapsed' : ''), 'data-sec': id });
    const t = h('div', { class: 'vxp-title', onclick: () => { settings.collapsed[id] = !settings.collapsed[id]; sec.classList.toggle('collapsed', settings.collapsed[id]); saveSettings(); } },
      h('span', null, title), h('span', { class: 'vxp-caret' }, '▾'));
    sec.append(t, ...body);
    return sec;
  }
  function guideCheckbox() {
    const cb = h('input', { type: 'checkbox' });
    const lab = h('label', { class: 'vxp-check' }, cb, 'Слушать оригинал при записи');
    cb.addEventListener('change', () => {
      const nat = qs('.recording-guide-toggle');
      if (!nat || nat.disabled) { cb.checked = false; return; }
      if ((nat.getAttribute('aria-pressed') === 'true') !== cb.checked) nat.click();
    });
    lab._sync = () => {
      const nat = qs('.recording-guide-toggle'), ok = nat && !nat.disabled;
      cb.disabled = !ok; lab.classList.toggle('disabled', !ok);
      lab.title = ok ? 'Во время записи в наушниках звучит оригинальная реплика' : 'Сейчас недоступно (не ваш ход или режим игры не поддерживает)';
      cb.checked = !!(nat && nat.getAttribute('aria-pressed') === 'true');
    };
    widgets.add(lab);
    return lab;
  }
  const nativeTarget = () => { const t = currentTake(); return t && t.playerAudio ? { model: nativeModel(t.playerAudio), apply: () => { applyNative(t); refreshPanel(true); } } : null; };

  function buildPanel(deck) {
    const editor = new TrackEditor({
      onOffset: (ms) => { const t = currentTake(); if (t) { nativeModel(t.playerAudio).params.offset = ms; applyNative(t); refreshPanel(true); toast('Сдвиг применён: ' + fmtMs(ms)); } },
      onPlay: () => playNativeTogether(),
    });
    panel.editor = editor;
    panel.bufInfo = h('div', { class: 'vxp-hint' });
    panel.queueBox = h('div', { class: 'vxp-sec', 'data-sec': 'queue', style: 'display:none' });
    const root = h('div', { class: 'vxp-panel', id: 'vxp-panel' },
      section('tracks', 'Дорожки', editor.root, panel.bufInfo),
      section('fx', 'Обработка', fxControls(nativeTarget)),
      section('mic', 'Запись', micControls(), guideCheckbox(), timingControls()),
      panel.queueBox);
    deck.append(root);
    panel.root = root;
    panel.lastQueueSig = '';
    refreshPanel(true);
  }

  function playNativeTogether() {
    if (player.playing) return player.stop();
    const ed = panel.editor;
    if (!ed.ref) return toast('Нет оригинала');
    const t = currentTake();
    const tracks = [{ samples: ed.ref.samples, sr: ed.ref.sr, startSec: 0, gain: 0.55 }];
    let dur = ed.ref.samples.length / ed.ref.sr;
    if (t && t.playerAudio) { const pa = t.playerAudio; tracks.push({ samples: pa.samples, sr: pa.sampleRate, startSec: 0, gain: 1 }); dur = Math.max(dur, pa.samples.length / pa.sampleRate); }
    ed.setPlaying(true);
    player.play({ tracks, dur: dur + 0.1, onTick: (x) => { ed.playhead = x; ed.draw(); }, onEnd: () => { ed.playhead = null; ed.setPlaying(false); ed.draw(); } });
  }

  function refreshPanel(force) {
    if (!panel.root || !panel.root.isConnected) return;
    const s = app.session(), t = currentTake();
    const refObj = s && s.referenceAudio, pa = t && t.playerAudio;
    const live = nativeRec.liveView();
    if (live && (nativeRec.phase === 'rec' || nativeRec.phase === 'tail' || nativeRec.phase === 'pre')) {
      if (refObj !== panel.refRef) { panel.refRef = refObj; panel.editor.ref = refObj ? { samples: refObj.samples, sr: refObj.sampleRate } : null; }
      panel.editor.setLive(live);
    } else {
      if (panel.editor.live) { panel.editor.live = null; force = true; }
      if (force || refObj !== panel.refRef || pa !== panel.takeRef) {
        const isNew = pa && pa !== panel.takeRef && !takeModels.has(pa);
        panel.refRef = refObj; panel.takeRef = pa;
        if (player.playing) player.stop();
        if (isNew) { const m = nativeModel(pa); if (!isDefaultParams(m.params)) applyNative(t); }
        const m = pa ? nativeModel(pa) : null;
        panel.editor.set(refObj ? { samples: refObj.samples, sr: refObj.sampleRate } : null, m ? modelView(m) : null, m ? m.params.offset : 0);
      }
    }
    // строка о буфере
    let info = '', warn = false;
    if (nativeRec.phase === 'tail') { info = '● Буфер: дописываю ещё ' + Math.max(0, Math.ceil((nativeRec.tailEnd - performance.now()) / 1000)) + ' с — можно продолжать говорить'; warn = true; }
    else if (pa && takeModels.get(pa) && takeModels.get(pa).ext) info = 'Буфер +' + Math.round(takeModels.get(pa).extTail) + ' с: опоздавшую фразу тяните влево, в светлое окно.';
    else info = 'Тяните красную дорожку мышью. В игру уходит то, что в светлом окне.';
    if (panel.bufInfo.textContent !== info) panel.bufInfo.textContent = info;
    panel.bufInfo.classList.toggle('warn', warn);
    syncWidgets();
    renderQueueBox();
  }
  onBus('native-live', () => {
    if (!panel.editor || !panel.root || !panel.root.isConnected) return;
    const live = nativeRec.liveView();
    if (live) panel.editor.setLive(live);
  });
  onBus('native-rec', () => refreshPanel(true));
  onBus('native-ext', () => { panel.takeRef = null; refreshPanel(true); toast('Буфер записи добавлен к дублю'); });

  function renderQueueBox() {
    const box = panel.queueBox; if (!box) return;
    syncRoomFromApp();
    const g = room.state && room.state.game, mine = myLines();
    if (!g || g.completedAt || !mine.length) { box.style.display = 'none'; return; }
    const sig = JSON.stringify([g.currentAssignmentIndex, g.takes.length, [...queue.entries()].map(([k, v]) => k + v.status), settings.autoSubmit, settings.collapsed.queue]);
    if (sig === panel.lastQueueSig && box.childElementCount) return;
    panel.lastQueueSig = sig;
    box.style.display = '';
    box.classList.toggle('collapsed', !!settings.collapsed.queue);
    const done = mine.filter((a) => ['sent', 'ready'].includes(lineStatus(g, a))).length;
    const cur = g.assignments[g.currentAssignmentIndex];
    const left = mine.filter((a) => ['todo', 'now'].includes(lineStatus(g, a)));
    const cb = h('input', { type: 'checkbox' }); cb.checked = settings.autoSubmit;
    cb.addEventListener('change', () => { settings.autoSubmit = cb.checked; saveSettings(); trySubmit(); });
    box.replaceChildren(
      h('div', { class: 'vxp-title', onclick: () => { settings.collapsed.queue = !settings.collapsed.queue; saveSettings(); panel.lastQueueSig = ''; renderQueueBox(); } },
        h('span', null, 'Мои реплики ', h('span', { class: 'vxp-badge' }, done + '/' + mine.length)), h('span', { class: 'vxp-caret' }, '▾')),
      h('div', { class: 'vxp-status' }, cur ? (cur.playerId === myId() ? h('b', null, 'Сейчас ваш ход') : ['Ход: ', h('b', null, cur.playerName || 'игрок'), ' · реплика ' + (g.currentAssignmentIndex + 1) + '/' + g.assignments.length]) : ''),
      h('div', { class: 'vxp-lines' }, mine.map((a) => {
        const st = lineStatus(g, a);
        return h('div', { class: 'vxp-line' + (st === 'now' ? ' active' : ''), title: a.caption, onclick: () => { if (st !== 'sent') openStudio(a.index); } },
          h('span', { class: 'n' }, '#' + (a.index + 1)), h('span', { class: 'c' }, a.caption || a.title || a.clipId), h('span', { class: 'vxp-chip ' + st }, STATUS_TEXT[st]));
      })),
      h('div', { class: 'vxp-row' },
        h('button', { class: 'vxp-btn primary wide', type: 'button', disabled: !left.length, onclick: () => openStudio(left[0] && left[0].index) }, left.length ? '🎙 Записать все заранее (' + left.length + ')' : '✓ Все реплики готовы')),
      h('label', { class: 'vxp-check', title: 'Когда подходит ваша очередь, заранее записанная реплика отправляется сама' }, cb, 'Авто-отправка в мой ход'));
  }
  onBus('queue', () => { panel.lastQueueSig = ''; renderQueueBox(); studio && studio.renderList(); });
  onBus('room', () => { renderQueueBox(); studio && studio.renderList(); });

  /* ---------- монтирование ---------- */
  let mountScheduled = false;
  function ensureMounted() {
    mountScheduled = false;
    injectCss();
    const deck = qs('.single-stage-control-deck');
    if (deck && !qs('#vxp-panel', deck)) {
      try { buildPanel(deck); } catch (e) { console.warn('[Voxalike+] panel', e); }
    } else if (deck && panel.root && deck.lastElementChild !== panel.root) {
      deck.append(panel.root); // элементы игры всегда выше панели мода
    }
    if (!deck && nativeRec.phase !== 'idle' && nativeRec.phase !== 'tail') nativeRec.reset();
  }
  // setTimeout, а не rAF: в фоновой вкладке rAF не срабатывает
  const mo = new MutationObserver(() => { if (!mountScheduled) { mountScheduled = true; setTimeout(ensureMounted, 30); } });
  const startObserver = () => { mo.observe(document.documentElement, { childList: true, subtree: true }); ensureMounted(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver); else startObserver();
  setInterval(() => { try { refreshPanel(false); } catch (e) { console.warn('[Voxalike+]', e); } }, 400);

  /* ================================================================== */
  /*  Студия: запись реплик заранее                                      */
  /* ================================================================== */
  let studio = null;
  function openStudio(index) {
    syncRoomFromApp();
    const g = room.state && room.state.game, pack = app.pack();
    if (!g) return toast('Игра ещё не началась', 'err');
    if (!pack) return toast('Мод с клипами не загружен на этой странице', 'err');
    if (studio) studio.close();
    studio = new Studio(pack);
    studio.select(index != null ? index : (myLines()[0] || {}).index);
  }
  VXP.openStudio = openStudio;

  class Studio {
    constructor(pack) {
      this.pack = pack; this.index = null; this.clip = null; this.ref = null; this.model = null; this.rec = null; this.dirty = false;
      this.video = h('video', { playsinline: true, preload: 'auto' });
      this.video.muted = true;
      this.backing = pack.backingTrackUrl ? h('audio', { preload: 'auto', src: pack.backingTrackUrl }) : null;
      this.guideEl = h('audio', { preload: 'auto' });
      this.cue = h('div', { class: 'vxp-cue' });
      this.videoBox = h('div', { class: 'vxp-video' }, this.video, this.cue);
      this.subSpeaker = h('span'); this.subText = h('p');
      this.editor = new TrackEditor({
        onOffset: (ms) => { if (this.model) { this.model.params.offset = ms; this.dirty = true; } },
        onPlay: () => this.playMine(true),
      });
      this.editor.canvas.classList.add('big');
      this.btnRec = h('button', { class: 'vxp-btn rec wide', type: 'button', onclick: () => this.toggleRec() }, '● Записать');
      this.btnOrig = h('button', { class: 'vxp-btn', type: 'button', onclick: () => this.playOriginal() }, '▶ Оригинал');
      this.btnMine = h('button', { class: 'vxp-btn', type: 'button', onclick: () => this.playMine(false) }, '▶ Моя запись');
      this.btnSave = h('button', { class: 'vxp-btn primary wide', type: 'button', onclick: () => this.save(true) }, '✓ Сохранить → далее');
      this.btnDel = h('button', { class: 'vxp-btn', type: 'button', title: 'Удалить из очереди', onclick: () => this.remove() }, '🗑');
      this.title = h('h3'); this.kicker = h('small');
      this.list = h('div', { class: 'vxp-lines' });
      const guide = checkbox({ label: 'Слушать оригинал при записи', get: () => settings.studioGuide, set: (v) => { settings.studioGuide = v; saveSettings(); }, title: 'Нужны наушники' });
      const fx = fxControls(() => this.model ? { model: this.model, apply: () => { this.dirty = true; this.refreshEditor(); } } : null);
      this.root = h('div', { class: 'vxp-studio', role: 'dialog', 'aria-label': 'Запись реплик заранее' },
        h('div', { class: 'vxp-card' },
          h('div', { class: 'vxp-card-head' },
            h('div', null, this.kicker, this.title),
            h('button', { class: 'vxp-btn icon', type: 'button', title: 'Закрыть (Esc)', onclick: () => this.close() }, '✕')),
          h('div', { class: 'vxp-stagebox' },
            this.videoBox,
            h('div', { class: 'vxp-sub' }, this.subSpeaker, this.subText),
            this.editor.root,
            h('div', { class: 'vxp-row' }, this.btnRec, this.btnOrig, this.btnMine),
            h('div', { class: 'vxp-row' }, this.btnSave, this.btnDel),
            h('div', { class: 'vxp-hint' }, 'Клавиши: R — запись/стоп · Пробел — моя запись · Enter — сохранить и далее · [ ] — сдвиг · A — авто · Esc — закрыть')),
          h('div', { class: 'vxp-side' },
            h('div', { class: 'vxp-sec' }, h('div', { class: 'vxp-title' }, h('span', null, 'Мои реплики')), this.list),
            h('div', { class: 'vxp-sec' }, h('div', { class: 'vxp-title' }, h('span', null, 'Обработка')), fx),
            h('div', { class: 'vxp-sec' }, h('div', { class: 'vxp-title' }, h('span', null, 'Запись')), micControls(), guide, timingControls()),
            h('div', { class: 'vxp-sec' }, h('div', { class: 'vxp-hint' },
              'Записанные реплики ждут в очереди и отправляются сами, как только подходит ваш ход. Не закрывайте вкладку до конца игры.')))));
      this.keyHandler = (e) => this.onKey(e);
      document.addEventListener('keydown', this.keyHandler, true);
      document.body.append(this.root);
      this.renderList();
    }
    close() {
      this.stopRec(true); player.stop();
      document.removeEventListener('keydown', this.keyHandler, true);
      this.root.remove();
      if (studio === this) studio = null;
      emit('queue');
    }
    onKey(e) {
      if (isTyping(e.target) || this.counting) return;
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); this.close(); }
      else if ('rRкК'.includes(k)) { e.preventDefault(); this.toggleRec(); }
      else if (k === ' ') { e.preventDefault(); this.playMine(false); }
      else if (k === 'Enter') { e.preventDefault(); this.save(true); }
      else if (k === '[' || k === 'х') { e.preventDefault(); this.editor.setOffset(this.editor.offset - (e.shiftKey ? 50 : 10), true); }
      else if (k === ']' || k === 'ъ') { e.preventDefault(); this.editor.setOffset(this.editor.offset + (e.shiftKey ? 50 : 10), true); }
      else if ('aAфФ'.includes(k)) { e.preventDefault(); this.editor.auto(); }
      else return;
      e.stopPropagation();
    }
    renderList() {
      const g = room.state && room.state.game; if (!g) return;
      const mine = myLines();
      this.list.replaceChildren(...mine.map((a) => {
        const st = lineStatus(g, a);
        return h('div', { class: 'vxp-line' + (a.index === this.index ? ' active' : ''), title: a.caption, onclick: () => { if (st !== 'sent' && st !== 'sending') this.select(a.index); } },
          h('span', { class: 'n' }, '#' + (a.index + 1)), h('span', { class: 'c' }, a.caption || a.clipId), h('span', { class: 'vxp-chip ' + st }, STATUS_TEXT[st]));
      }));
      const done = mine.filter((a) => ['sent', 'ready'].includes(lineStatus(g, a))).length;
      this.kicker.textContent = 'Запись заранее · готово ' + done + '/' + mine.length;
    }
    refreshEditor() { this.editor.set(this.ref, this.model ? modelView(this.model) : null, this.model ? this.model.params.offset : 0); this.updateButtons(); }
    async select(index) {
      const g = room.state && room.state.game; if (!g || index == null) return;
      if (this.dirty && this.model) this.save(false);
      this.stopRec(true); player.stop();
      const a = g.assignments[index]; if (!a) return;
      this.index = index; this.assignment = a;
      this.clip = this.pack.clips.find((c) => c.id === a.clipId);
      if (!this.clip) { toast('Клип ' + a.clipId + ' не найден в моде', 'err'); return; }
      this.title.textContent = '#' + (index + 1) + ' · ' + (a.title || this.clip.title || '');
      this.subSpeaker.textContent = this.speakerName();
      this.subText.textContent = a.caption || this.clip.caption || '';
      if (this.video.src !== this.clip.videoUrl) this.video.src = this.clip.videoUrl;
      this.guideEl.src = this.clip.audioUrl || '';
      const seek = () => { try { this.video.currentTime = this.clip.videoStartSeconds || 0; } catch {} };
      if (this.video.readyState >= 1) seek(); else this.video.addEventListener('loadedmetadata', seek, { once: true });
      this.ref = null;
      try {
        const d = await decodeBlob(this.clip.audioFile || this.clip.audioUrl);
        if (this.index !== index) return;
        this.ref = { samples: d.samples, sr: d.sampleRate, duration: d.duration };
      } catch (e) { console.warn('[Voxalike+] ref decode', e); }
      const q = queue.get(qKey(g, index));
      this.model = q ? q.model : null; this.dirty = false;
      this.refreshEditor();
      this.renderList();
    }
    speakerName() {
      const list = (this.clip && this.clip.speakers) || [];
      const ch = Array.isArray(this.pack.characters) ? this.pack.characters : [];
      return list.map((sp) => {
        if (typeof sp === 'string' && !/^\d+$/.test(sp)) return sp;
        const c = ch[+sp] ?? ch.find((x) => x && x.id === sp);
        return c == null ? '' : typeof c === 'string' ? c : c.name || c.title || '';
      }).filter(Boolean).join(' · ');
    }
    clipDur() { return Math.max(0.5, this.ref ? this.ref.duration : (this.clip.videoEndSeconds - this.clip.videoStartSeconds) || 3); }
    updateButtons() {
      const recOn = !!this.rec;
      this.btnRec.textContent = recOn ? '■ Стоп' : (this.model ? '● Перезаписать' : '● Записать');
      this.btnMine.disabled = recOn || !this.model;
      this.btnOrig.disabled = recOn;
      this.btnSave.disabled = recOn || !this.model;
      const g = room.state && room.state.game;
      this.btnDel.disabled = recOn || !(g && queue.has(qKey(g, this.index)));
    }
    playOriginal() {
      if (player.playing) return player.stop();
      const c = this.clip; if (!c) return;
      const dur = (c.videoEndSeconds || c.videoStartSeconds + this.clipDur()) - c.videoStartSeconds;
      player.play({ media: [{ el: this.video, from: c.videoStartSeconds, muted: false, vol: 1 }], dur,
        onEnd: () => { this.video.pause(); this.video.muted = true; try { this.video.currentTime = c.videoStartSeconds; } catch {} } });
    }
    playMine(withRef) {
      if (player.playing) { player.stop(); return; }
      if (!this.model) return;
      const c = this.clip, ed = this.editor, out = renderModel(this.model);
      const dur = Math.max(out.length / this.model.sr, (c.videoEndSeconds || 0) - c.videoStartSeconds);
      const media = [{ el: this.video, from: c.videoStartSeconds, muted: true }];
      if (!withRef && this.backing) media.push({ el: this.backing, from: c.videoStartSeconds, vol: 0.6 });
      const tracks = [{ samples: out, sr: this.model.sr, startSec: 0, gain: 1 }];
      if (withRef && this.ref) tracks.push({ samples: this.ref.samples, sr: this.ref.sr, startSec: 0, gain: 0.55 });
      ed.setPlaying(withRef);
      this.btnMine.textContent = withRef ? '▶ Моя запись' : '■ Стоп';
      player.play({ tracks, media, dur,
        onTick: (t) => { ed.playhead = t; ed.draw(); },
        onEnd: () => { ed.playhead = null; ed.setPlaying(false); ed.draw(); this.btnMine.textContent = '▶ Моя запись'; this.video.pause(); try { this.video.currentTime = c.videoStartSeconds; } catch {} } });
    }
    async toggleRec() { if (this.counting) return; if (this.rec) this.stopRec(false); else await this.startRec(); }
    async startRec() {
      if (!this.clip) return;
      player.stop();
      let track;
      try {
        const dev = app.mic(); const id = dev && dev.selectedDeviceId;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id && id !== 'default' ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        track = stream.getAudioTracks()[0];
      } catch (e) { toast('Микрофон недоступен: ' + e.message, 'err'); return; }
      let cap;
      try { cap = await Capture.open(track, { noMonitor: false }); } catch (e) { track.stop(); toast('Не удалось начать запись: ' + e.message, 'err'); return; }
      const c = this.clip, dur = this.clipDur(), C = settings.countdown, start = c.videoStartSeconds || 0;
      const rec = this.rec = { cap, videoCtx: null, timers: [] };
      const winEnd = dur + 0.4;
      const plannedPerf = performance.now() + C * 1000;
      const liveT0 = () => (cap.startCtx == null ? 0 : cap.startCtx - (rec.videoCtx != null ? rec.videoCtx : cap.perfToCtx(plannedPerf)));
      cap.onData = () => this.editor.setLive({ buf: cap.buf, len: cap.len, sr: cap.sr, t0: liveT0(), winEnd });
      this.editor.setLive({ buf: cap.buf, len: 0, sr: cap.sr, t0: -C, winEnd });
      this.updateButtons();
      this.video.muted = true;
      // предпрокрутка видео во время отсчёта
      const from = Math.max(0, start - C), delay = Math.max(0, C - (start - from));
      try { this.video.currentTime = from; } catch {}
      const mark = (perf) => {
        if (rec.videoCtx != null || this.rec !== rec) return;
        rec.videoCtx = cap.perfToCtx(perf);
        this.cue.className = 'vxp-cue on rec'; this.cue.textContent = '● ЗАПИСЬ';
        if (settings.studioGuide && c.audioUrl) { this.guideEl.currentTime = 0; this.guideEl.volume = settings.guideVol; this.guideEl.play().catch(() => {}); }
        const tail = settings.tailSec;
        rec.timers.push(setTimeout(() => {
          if (this.rec !== rec) return;
          if (!tail) return this.stopRec(false);
          const tEnd = performance.now() + tail * 1000;
          this.cue.className = 'vxp-cue on tail';
          const upd = () => { if (this.rec !== rec) return; const s = Math.ceil((tEnd - performance.now()) / 1000); this.cue.textContent = '● БУФЕР ' + s + ' с · R — стоп'; if (s > 0) rec.timers.push(setTimeout(upd, 250)); };
          upd();
          rec.timers.push(setTimeout(() => this.stopRec(false), tail * 1000));
        }, winEnd * 1000 - Math.max(0, performance.now() - perf)));
      };
      const watchStart = () => {
        if (this.video.requestVideoFrameCallback) {
          const onFrame = (now, meta) => {
            if (this.rec !== rec || rec.videoCtx != null) return;
            if (meta.mediaTime >= start - 0.017) mark(meta.expectedDisplayTime - (meta.mediaTime - start) * 1000);
            else this.video.requestVideoFrameCallback(onFrame);
          };
          this.video.requestVideoFrameCallback(onFrame);
        }
        this.video.addEventListener('playing', () => {
          const t = this.video.currentTime, p = performance.now();
          rec.timers.push(setTimeout(() => mark(p + Math.max(0, start - t) * 1000), Math.max(0, (start - t) * 1000) + 120));
        }, { once: true });
      };
      rec.timers.push(setTimeout(() => { if (this.rec !== rec) return; watchStart(); this.video.play().catch(() => {}); }, delay * 1000));
      this.counting = true;
      const ok = await countdown(C, { host: this.videoBox });
      this.counting = false;
      if (!ok) { this.stopRec(true); return; }
      if (rec.videoCtx == null && this.rec === rec) { this.cue.className = 'vxp-cue on rec'; this.cue.textContent = '● ЗАПИСЬ'; }
    }
    stopRec(discard) {
      const rec = this.rec; if (!rec) return;
      this.rec = null;
      rec.timers.forEach(clearTimeout);
      rec.cap.onData = null; // последний кусок после остановки не должен включать живой режим
      this.video.pause(); this.guideEl.pause();
      this.cue.className = 'vxp-cue';
      this.editor.setLive(null);
      rec.cap.stop().then((res) => {
        if (discard || rec.videoCtx == null || res.startCtx == null || !res.samples.length) { this.refreshEditor(); return; }
        const fx = settings.fx;
        this.model = {
          base: normalizeTake(res.samples), sr: res.sr, t0: res.startCtx - rec.videoCtx,
          outLen: Math.round((this.clipDur() + 0.4) * res.sr),
          params: { offset: 0, pitch: fx.pitch, gain: fx.gain, lowcut: fx.lowcut },
        };
        this.dirty = true;
        this.refreshEditor();
        try { this.video.currentTime = this.clip.videoStartSeconds; } catch {}
      });
      this.updateButtons();
    }
    save(next) {
      const g = room.state && room.state.game;
      if (!g || !this.model || this.index == null) return;
      if (g.takes.some((t) => t.assignmentIndex === this.index)) { toast('Эта реплика уже отправлена', 'err'); return; }
      queue.set(qKey(g, this.index), { index: this.index, clipId: this.assignment.clipId, model: this.model, status: 'ready', savedAt: Date.now() });
      this.dirty = false;
      emit('queue');
      trySubmit();
      if (!next) return;
      toast('Реплика #' + (this.index + 1) + ' в очереди');
      const mine = myLines().filter((a) => ['todo', 'now'].includes(lineStatus(g, a)) && a.index !== this.index);
      const nxt = mine.find((a) => a.index > this.index) || mine[0];
      if (nxt) this.select(nxt.index); else { toast('Все ваши реплики готовы — ждём остальных 🎉'); this.close(); }
    }
    remove() {
      const g = room.state && room.state.game; if (!g) return;
      queue.delete(qKey(g, this.index));
      this.model = null; this.dirty = false;
      this.refreshEditor(); emit('queue');
    }
  }

  /* ================================================================== */
  /*  Горячие клавиши на сцене                                           */
  /* ================================================================== */
  document.addEventListener('keydown', (e) => {
    if (!settings.hotkeys || studio || isTyping(e.target) || e.ctrlKey || e.metaKey) return;
    if (!panel.root || !panel.root.isConnected) return;
    const ed = panel.editor;
    if (e.key === '[' || e.key === 'х') { ed.setOffset(ed.offset - (e.shiftKey ? 50 : 10), true); e.preventDefault(); }
    else if (e.key === ']' || e.key === 'ъ') { ed.setOffset(ed.offset + (e.shiftKey ? 50 : 10), true); e.preventDefault(); }
  }, true);

  console.info('%cVoxalike+ ' + VERSION + ' загружен', 'color:#4ee7d2;font-weight:bold');
})();
