/*!
 * Voxalike+OrdaxEd — модуль «Нейросетевой шумодав» 1.0.0
 * Отдельный файл: подключается к основному моду (vxp-main.js) и работает только вместе с ним.
 * Две нейросети внутри файла (ничего скачивать не нужно):
 *   • GTCRN  — сильная, хорошо убирает клавиатуру, мышку и «живой» шум.  MIT, © 2024 Rong Xiaobin
 *   • RNNoise — лёгкая и быстрая, хороша против вентилятора и гула.      BSD-3, © Xiph.Org / Mozilla
 * WebAssembly-сборки взяты из пакета @sapphi-red/web-noise-suppressor (MIT, © 2022 翠 / green).
 * Обработка офлайн, по готовой записи; если нейросеть не загрузилась — основной мод использует обычный шумодав.
 */
(() => {
  'use strict';
  const NAME = 'denoise', VERSION = '1.0.0';
  const B64 = { gtcrn: '@@MODEL:gtcrn@@', rnnoise: '@@MODEL:rnnoise@@' };
  const DELAY = { gtcrn: 889, rnnoise: 480 }; // задержка сетей в сэмплах (48 кГц), измерена по взаимной корреляции

  const NNCORE = (() => {
  const engines = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function growHeap(getInst) { return (req) => { try { const mem = getInst().exports.c || getInst().exports.memory; const need = Math.ceil((req - mem.buffer.byteLength) / 65536); if (need > 0) mem.grow(need); return 1; } catch { return 0; } }; }
  async function loadGtcrn(bytes) {
    let inst; const fail = () => { throw new Error('gtcrn assert'); };
    const r = await WebAssembly.instantiate(bytes, { a: { a: fail, b: growHeap(() => inst) } });
    inst = r.instance; const X = inst.exports; X.d();
    const FR = 768;
    return {
      name: 'gtcrn', sr: 48000, frame: FR,
      create() {
        const st = X.e(), ip = X.k(FR * 4), op = X.k(FR * 4);
        return { run(frame) { const mem = X.c.buffer; new Float32Array(mem, ip, FR).set(frame); X.j(st, ip, op); return new Float32Array(X.c.buffer, op, FR).slice(); }, destroy() { X.f(ip); X.f(op); X.g(st); } };
      },
    };
  }
  async function loadRnnoise(bytes) {
    let inst; const mem = () => inst.exports.memory;
    const imp = { env: {
      emscripten_memcpy_big: (d, s, n) => { new Uint8Array(mem().buffer).copyWithin(d, s, s + n); },
      emscripten_resize_heap: growHeap(() => inst),
      __assert_fail: () => { throw new Error('rnnoise assert'); },
    } };
    const r = await WebAssembly.instantiate(bytes, imp);
    inst = r.instance; const X = inst.exports; if (X.__wasm_call_ctors) X.__wasm_call_ctors();
    const FR = X.rnnoise_get_frame_size();
    return {
      name: 'rnnoise', sr: 48000, frame: FR,
      create() {
        const st = X.rnnoise_create(0), ip = X.malloc(FR * 4), op = X.malloc(FR * 4);
        return { run(frame) { const m = X.memory.buffer, a = new Float32Array(m, ip, FR); for (let i = 0; i < FR; i++) a[i] = frame[i] * 32767; X.rnnoise_process_frame(st, op, ip); const o = new Float32Array(X.memory.buffer, op, FR), y = new Float32Array(FR); for (let i = 0; i < FR; i++) y[i] = o[i] / 32767; return y; }, destroy() { X.free(ip); X.free(op); X.rnnoise_destroy(st); } };
      },
    };
  }
  /** Передискретизация окном-синком (полоса ~0.45 от меньшей частоты). */
  function resample(x, from, to) {
    if (from === to) return x;
    const ratio = to / from, n = Math.max(1, Math.round(x.length * ratio)), y = new Float32Array(n), cut = Math.min(1, ratio) * 0.94, Wd = 12;
    for (let i = 0; i < n; i++) {
      const c = i / ratio, i0 = Math.floor(c); let s = 0, ws = 0;
      for (let j = i0 - Wd + 1; j <= i0 + Wd; j++) {
        if (j < 0 || j >= x.length) continue;
        const t = c - j, a = Math.PI * t * cut, sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(a) / a, w = 0.5 + 0.5 * Math.cos((Math.PI * t) / Wd);
        const k = sinc * w; s += x[j] * k; ws += k;
      }
      y[i] = ws > 1e-6 ? s / ws * 1 : 0;
    }
    return y;
  }
  /** Прогнать дорожку через сеть (48 кГц), вернуть выровненный по задержке результат. */
  function run(eng, x48, delay) {
    const F = eng.frame, n = x48.length, total = n + delay, frames = Math.ceil(total / F), out = new Float32Array(frames * F), st = eng.create();
    try {
      const buf = new Float32Array(F);
      for (let f = 0; f < frames; f++) {
        const s = f * F; buf.fill(0);
        for (let i = 0; i < F; i++) { const q = s + i; if (q < n) buf[i] = x48[q]; }
        out.set(st.run(buf), s);
      }
    } finally { st.destroy(); }
    return out.subarray(delay, delay + n);
  }
  /** Задержку сети находим по взаимной корреляции на шумовой пачке. */
  function calibrate(eng) {
    const sr = 48000, n = sr, x = new Float32Array(n); let seed = 7;
    for (let i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; const env = i > 4000 && i < 30000 ? 1 : 0; x[i] = env * (seed / 2147483647 - 0.5) * 0.5 * Math.sin(i * 0.05 + Math.sin(i * 0.002) * 8); }
    const y = run(eng, x, 0); let best = 0, bd = 0;
    for (let d = 0; d < 3000; d += 1) { let c = 0; for (let i = 5000; i < 28000; i += 3) c += x[i] * y[i + d]; if (c > best) { best = c; bd = d; } }
    return bd;
  }
    return { loadGtcrn, loadRnnoise, resample, run };
  })();

  const init = (api) => {
    const status = { gtcrn: 'idle', rnnoise: 'idle' }, engines = {}, loading = {};
    const dec = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
    const load = (name) => {
      if (engines[name]) return Promise.resolve(engines[name]);
      if (loading[name]) return loading[name];
      status[name] = 'loading';
      loading[name] = (name === 'gtcrn' ? NNCORE.loadGtcrn : NNCORE.loadRnnoise)(dec(B64[name]))
        .then((e) => { engines[name] = e; status[name] = 'ready'; try { api.emit && api.emit('nn'); } catch {} return e; })
        .catch((er) => { status[name] = 'error: ' + (er && er.message || er); console.warn('[Voxalike+OrdaxEd] нейросеть ' + name, er); });
      return loading[name];
    };
    /** Нейросетевой шумодав дорожки: strength 0..1 — доля очищенного звука в итоге. */
    function denoise(x, sr, strength, name) {
      const eng = engines[name]; if (!eng) throw new Error('нейросеть не готова');
      const s = Math.max(0, Math.min(1, strength));
      if (!x.length || s <= 0) return x;
      const x48 = NNCORE.resample(x, sr, 48000), d = DELAY[name] || 0;
      const y48 = NNCORE.run(eng, x48, d), y = sr === 48000 ? y48 : NNCORE.resample(y48, 48000, sr), out = new Float32Array(x.length);
      for (let i = 0; i < out.length; i++) { const v = i < y.length ? y[i] : 0; out[i] = x[i] * (1 - s) + v * s; }
      return out;
    }
    window.__VXP__.nn = { version: VERSION, status, ok: (n) => !!engines[n], denoise, load, engines: ['gtcrn', 'rnnoise'] };
    setTimeout(() => { load('gtcrn'); load('rnnoise'); }, 1200); // подгружаем в фоне, чтобы не тормозить загрузку сайта
  };

  if (window.__VXP__ && window.__VXP__.registerModule) window.__VXP__.registerModule(NAME, init);
  else (window.__VXP_PLUGINS__ = window.__VXP_PLUGINS__ || []).push({ name: NAME, init });
})();
