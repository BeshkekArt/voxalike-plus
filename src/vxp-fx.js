/*!
 * Voxalike+OrdaxEd — модуль «Эффектор» 1.1.0
 * Отдельный файл: подключается к основному моду (vxp-main.js) и работает только вместе с ним.
 * Голосовой эффектор для записанной дорожки: питч и формант по отдельности, слои (суб-октава, гармонайзер, хор),
 * шёпот, робот, кольцевая модуляция, рычание, дисторшн, цифровой хруст, тембр. Пресеты: демон, дракон, веном, робот и другие,
 * плюс свои пресеты. Обработка — офлайн, по записанной дорожке (в реальном времени голос не трогается).
 */
(() => {
  'use strict';
  const NAME = 'fx', VERSION = '1.1.0';
  const KEY = 'vxp-fx:v1';

  /* ---------------- параметры ---------------- */
  const DEF = {
    on: false, preset: '',
    pitch: 0,          // полутонов, -24..24
    formant: 0,        // полутонов, -12..12 (тембр «размера» горла)
    sub: 0, up: 0, upInt: 7, uni: 0, det: 20, whisper: 0,
    robot: 0, robotHz: 110, ring: 0, ringHz: 30, growl: 0, growlHz: 70,
    drive: 0, crush: 0, low: 0, high: 0, mix: 100, level: 0,
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const norm = (o) => { const r = Object.assign({}, DEF, o || {}); for (const k of Object.keys(DEF)) if (k !== 'preset' && k !== 'on') r[k] = Number.isFinite(+r[k]) ? +r[k] : DEF[k]; return r; };

  const PRESETS = [
    { id: 'demon', ico: '😈', ru: 'Демон', en: 'Demon', p: { pitch: -8, formant: -6, sub: 70, uni: 2, det: 18, growl: 30, growlHz: 70, drive: 40, low: 5, high: -2, whisper: 12 }, space: { type: 'hall', mix: 30, size: 60 } },
    { id: 'dragon', ico: '🐲', ru: 'Дракон', en: 'Dragon', p: { pitch: -5, formant: -4, sub: 60, growl: 55, growlHz: 48, drive: 35, low: 6, high: -3, whisper: 8 }, space: { type: 'hall', mix: 40, size: 75 } },
    { id: 'venom', ico: '🕷', ru: 'Веном', en: 'Venom', p: { pitch: -6, formant: -5, sub: 55, uni: 2, det: 26, growl: 25, growlHz: 90, drive: 30, low: 4, high: 1, whisper: 20 }, space: { type: 'room', mix: 18, size: 45 } },
    { id: 'robot', ico: '🤖', ru: 'Робот', en: 'Robot', p: { robot: 100, robotHz: 120, crush: 22, high: 3 }, space: { type: 'room', mix: 0, size: 50 } },
    { id: 'dalek', ico: '🛸', ru: 'Далек', en: 'Dalek', p: { ring: 100, ringHz: 32, pitch: 1, crush: 10, high: 3, low: -4 }, space: { type: 'room', mix: 0, size: 50 } },
    { id: 'mush', ico: '🍄', ru: 'Грибной хор', en: 'Mushroom choir', p: { pitch: 0, formant: 2, up: 55, upInt: 7, sub: 30, uni: 2, det: 14, high: 3 }, space: { type: 'hall', mix: 25, size: 55 } },
    { id: 'giant', ico: '🗿', ru: 'Гигант', en: 'Giant', p: { pitch: -9, formant: -8, sub: 35, low: 4, drive: 8 }, space: { type: 'room', mix: 12, size: 55 } },
    { id: 'goblin', ico: '👺', ru: 'Гоблин', en: 'Goblin', p: { pitch: 6, formant: 5, high: 2, drive: 6 }, space: { type: 'room', mix: 0, size: 50 } },
    { id: 'ghost', ico: '👻', ru: 'Призрак', en: 'Ghost', p: { whisper: 75, pitch: -2, formant: -2, up: 22, upInt: 12, high: 3 }, space: { type: 'hall', mix: 45, size: 70 } },
  ];

  /* ---------------- БПФ ---------------- */
  const plans = new Map();
  function plan(n) {
    let p = plans.get(n); if (p) return p;
    const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n), cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
    for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos((2 * Math.PI * i) / n); sn[i] = -Math.sin((2 * Math.PI * i) / n); }
    p = { n, rev, cs, sn }; plans.set(n, p); return p;
  }
  function fft(re, im, inv) {
    const { n, rev, cs, sn } = plan(re.length);
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cs[k], wi = inv ? -sn[k] : sn[k], a = i + j, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  const hanns = new Map();
  const hann = (N) => { let w = hanns.get(N); if (!w) { w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); hanns.set(N, w); } return w; };

  /** Оконное преобразование: cb(re, im, t) меняет спектр кадра, дальше обратное БПФ и сложение с нормировкой. */
  function stftProc(x, N, H, cb) {
    const n = x.length, out = new Float32Array(n), nrm = new Float32Array(n), w = hann(N), re = new Float64Array(N), im = new Float64Array(N);
    let t = 0;
    for (let pos = -N + H; pos < n; pos += H, t++) {
      for (let i = 0; i < N; i++) { const q = pos + i; re[i] = q >= 0 && q < n ? x[q] * w[i] : 0; im[i] = 0; }
      fft(re, im, false);
      cb(re, im, t);
      fft(re, im, true);
      for (let i = 0; i < N; i++) { const q = pos + i; if (q >= 0 && q < n) { out[q] += re[i] * w[i]; nrm[q] += w[i] * w[i]; } }
    }
    for (let i = 0; i < n; i++) out[i] = nrm[i] > 1e-6 ? out[i] / nrm[i] : out[i];
    return out;
  }
  const rmsOf = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };
  const scaleTo = (y, target) => { const r = rmsOf(y); if (r > 1e-9) { const k = target / r; for (let i = 0; i < y.length; i++) y[i] *= k; } return y; };

  /* ---------------- огибающая спектра (кепстр) ---------------- */
  function makeEnv(N, L) {
    const re = new Float64Array(N), im = new Float64Array(N), K = N >> 1;
    return (mag, out) => {
      for (let k = 0; k <= K; k++) re[k] = Math.log(mag[k] + 1e-7);
      for (let k = 1; k < K; k++) re[N - k] = re[k];
      im.fill(0);
      fft(re, im, false);
      for (let q = 0; q < N; q++) {
        const d = q <= K ? q : N - q;
        let w = d > L ? 0 : d > L * 0.75 ? (L - d) / (L * 0.25) : 1;
        re[q] = (re[q] * w) / N; im[q] = 0;
      }
      fft(re, im, false);
      for (let k = 0; k <= K; k++) out[k] = Math.exp(re[k]);
    };
  }

  /** Сдвиг высоты (semis) и формант (form) независимо. ctx кеширует огибающие исходника и готовые голоса. */
  function shiftVoice(ctx, semis, form) {
    const key = semis.toFixed(3) + '|' + form.toFixed(3);
    if (ctx.cache.has(key)) return ctx.cache.get(key);
    const mk = ctx.fp + '|' + key, hit = memo.get(mk);
    if (hit) { ctx.cache.set(key, hit); return hit; }
    const { x, sr, dsp } = ctx;
    let res;
    if (!semis && !form) res = x;
    else {
      const y = semis ? dsp.pitchShift(x, sr, semis) : x;
      const N = 1024, H = 256, K = N >> 1, L = Math.max(40, Math.round(sr / 450)), env = makeEnv(N, L);
      const r = Math.pow(2, form / 12);
      if (!ctx.envX && envMemo.fp === ctx.fp) ctx.envX = envMemo.e;
      if (!ctx.envX) { // огибающие исходника по кадрам — один раз на все голоса
        ctx.envX = [];
        const mag = new Float64Array(K + 1);
        stftProc(x, N, H, (re, im) => { for (let k = 0; k <= K; k++) mag[k] = Math.hypot(re[k], im[k]); const e = new Float32Array(K + 1); env(mag, e); ctx.envX.push(e); });
        envMemo.fp = ctx.fp; envMemo.e = ctx.envX;
      }
      const magY = new Float64Array(K + 1), eY = new Float32Array(K + 1), tgt = new Float32Array(K + 1);
      res = stftProc(y, N, H, (re, im, t) => {
        const ex = ctx.envX[t] || ctx.envX[ctx.envX.length - 1];
        for (let k = 0; k <= K; k++) magY[k] = Math.hypot(re[k], im[k]);
        env(magY, eY);
        for (let k = 0; k <= K; k++) { // целевая огибающая: исходная, сдвинутая по частоте в r раз
          const s = k / r, i0 = Math.floor(s);
          tgt[k] = i0 >= K ? ex[K] : ex[i0] * (1 - (s - i0)) + ex[i0 + 1] * (s - i0);
        }
        for (let k = 0; k <= K; k++) {
          const g = clamp(tgt[k] / Math.max(eY[k], 1e-9), 0.05, 12);
          re[k] *= g; im[k] *= g;
          if (k > 0 && k < K) { re[N - k] *= g; im[N - k] *= g; }
        }
      });
    }
    ctx.cache.set(key, res);
    if (res !== x) { memo.set(mk, res); while (memo.size > 8) memo.delete(memo.keys().next().value); }
    return res;
  }
  function cached(ctx, key, fn) {
    const mk = ctx.fp + '|' + key, hit = memo.get(mk); if (hit) return hit;
    const r = fn(); memo.set(mk, r); while (memo.size > 12) memo.delete(memo.keys().next().value); return r;
  }
  /* Готовые голоса кешируются между пересчётами: поменяли рычание или дисторшн — питч заново не считается. */
  const memo = new Map(), envMemo = { fp: '', e: null };
  function fingerprint(x, sr) {
    let a = 0, b = 0; const st = Math.max(1, Math.floor(x.length / 97));
    for (let i = 0; i < x.length; i += st) { a += x[i] * (1 + (i % 7)); b += Math.abs(x[i]); }
    return x.length + ':' + sr + ':' + a.toFixed(5) + ':' + b.toFixed(5);
  }

  /* ---------------- прочие блоки ---------------- */
  /** Робот: все кадры с нулевой фазой на фиксированном шаге — голос «поёт» одной высотой (f0). */
  function robotize(x, sr, f0) {
    const n = x.length, H = Math.max(32, Math.round(sr / clamp(f0, 40, 400)));
    let N = 1024; while (N < 3 * H) N <<= 1;
    const w = hann(N), re = new Float64Array(N), im = new Float64Array(N), out = new Float32Array(n), half = N >> 1;
    for (let pos = 0; pos < n + H; pos += H) {
      let e = 0;
      for (let i = 0; i < N; i++) { const q = pos - half + i; const v = q >= 0 && q < n ? x[q] * w[i] : 0; re[i] = v; im[i] = 0; e += v * v; }
      if (e < 1e-12) continue;
      fft(re, im, false);
      for (let k = 0; k < N; k++) { re[k] = Math.hypot(re[k], im[k]); im[k] = 0; }
      fft(re, im, true);
      for (let d = -half; d < half; d++) { const q = pos + d; if (q >= 0 && q < n) out[q] += re[(d + N) % N] * w[d + half]; }
    }
    return scaleTo(out, rmsOf(x));
  }
  /** Шёпот: те же амплитуды, фазы случайные — голос без тона. */
  function whisperize(x) {
    const N = 1024, K = N >> 1;
    const y = stftProc(x, N, 256, (re, im) => {
      for (let k = 0; k <= K; k++) {
        const m = Math.hypot(re[k], im[k]), ph = Math.random() * 2 * Math.PI;
        re[k] = m * Math.cos(ph); im[k] = k === 0 || k === K ? 0 : m * Math.sin(ph);
        if (k > 0 && k < K) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      }
    });
    return scaleTo(y, rmsOf(x));
  }
  function delayed(x, d) { const y = new Float32Array(x.length); if (d < x.length) y.set(x.subarray(0, x.length - d), d); return y; }
  function ringMod(x, sr, f, amt) {
    const y = new Float32Array(x.length), w = (2 * Math.PI * f) / sr;
    for (let i = 0; i < x.length; i++) y[i] = x[i] * (1 - amt + amt * Math.sin(w * i));
    return scaleTo(y, rmsOf(x));
  }
  /** Рычание: быстрая амплитудная модуляция с лёгким «плаванием» частоты. */
  function growl(x, sr, f, depth) {
    const y = new Float32Array(x.length), tw = (2 * Math.PI * 5.3) / sr;
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      ph += (2 * Math.PI * f * (1 + 0.07 * Math.sin(tw * i))) / sr;
      y[i] = x[i] * (1 - depth * (0.5 - 0.5 * Math.cos(ph)));
    }
    return scaleTo(y, rmsOf(x));
  }
  function crush(x, amt) {
    const bits = Math.round(16 - 11 * amt), hold = Math.max(1, Math.round(1 + 10 * amt)), q = Math.pow(2, bits - 1), y = new Float32Array(x.length);
    let held = 0;
    for (let i = 0; i < x.length; i++) { if (i % hold === 0) held = Math.round(clamp(x[i], -1, 1) * q) / q; y[i] = held; }
    return y;
  }
  function drive(x, amt) {
    const g = 1 + amt * 0.4, y = new Float32Array(x.length), r = rmsOf(x), pre = r > 1e-6 ? Math.min(30, 0.2 / r) : 1;
    for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i] * pre * g);
    return y;
  }
  function shelf(x, sr, f0, gDb, high) {
    if (!gDb) return x;
    const A = Math.pow(10, gDb / 40), w0 = (2 * Math.PI * f0) / sr, cs = Math.cos(w0), sn = Math.sin(w0), al = (sn / 2) * Math.SQRT2, sq = 2 * Math.sqrt(A) * al;
    let b0, b1, b2, a0, a1, a2;
    if (!high) { b0 = A * (A + 1 - (A - 1) * cs + sq); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - sq); a0 = A + 1 + (A - 1) * cs + sq; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - sq; }
    else { b0 = A * (A + 1 + (A - 1) * cs + sq); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - sq); a0 = A + 1 - (A - 1) * cs + sq; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - sq; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  const addScaled = (dst, src, g) => { for (let i = 0; i < dst.length; i++) dst[i] += src[i] * g; };

  /** Главная функция: x — моно дорожка, sr — частота, P — параметры. Возвращает дорожку той же длины. */
  function process(x, sr, P0, dsp) {
    const P = norm(P0), n = x.length;
    if (!n) return x;
    const ctx = { x, sr, dsp: dsp || window.__VXP__.dsp, cache: new Map(), envX: null, fp: fingerprint(x, sr) };
    const rmsIn = rmsOf(x);
    const main = shiftVoice(ctx, P.pitch, P.formant);
    const W = P.whisper / 100;
    let sum = new Float32Array(n);
    addScaled(sum, main, 1 - 0.8 * W);
    if (P.sub > 0) addScaled(sum, shiftVoice(ctx, P.pitch - 12, P.formant), (P.sub / 100) * 0.9);
    if (P.up > 0) addScaled(sum, shiftVoice(ctx, P.pitch + P.upInt, P.formant), (P.up / 100) * 0.8);
    if (P.uni > 0) {
      const u = Math.min(4, Math.round(P.uni)), groups = Math.ceil(u / 2);
      for (let i = 0; i < u; i++) {
        const cents = (i % 2 ? 1 : -1) * P.det * (((i >> 1) + 1) / groups);
        const v = cached(ctx, 'u|' + P.pitch + '|' + P.formant + '|' + cents.toFixed(2), () => ctx.dsp.pitchShift(main, sr, cents / 100));
        addScaled(sum, delayed(v, Math.round((0.011 + 0.007 * i) * sr)), 0.6 / Math.sqrt(u));
      }
    }
    if (W > 0) addScaled(sum, cached(ctx, 'w|' + P.pitch + '|' + P.formant, () => whisperize(main)), W * 0.9);
    if (P.robot > 0) { const r = robotize(sum, sr, P.robotHz), a = P.robot / 100, y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = sum[i] * (1 - a) + r[i] * a; sum = y; }
    if (P.ring > 0) sum = ringMod(sum, sr, P.ringHz, P.ring / 100);
    if (P.growl > 0) sum = growl(sum, sr, P.growlHz, (P.growl / 100) * 0.85);
    if (P.crush > 0) sum = crush(sum, P.crush / 100);
    if (P.drive > 0) sum = drive(sum, P.drive);
    sum = shelf(shelf(sum, sr, 160, P.low, false), sr, 3800, P.high, true);
    scaleTo(sum, rmsIn * Math.pow(10, P.level / 20));
    const wet = clamp(P.mix / 100, 0, 1);
    if (wet < 1) for (let i = 0; i < n; i++) sum[i] = sum[i] * wet + x[i] * (1 - wet);
    let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(sum[i]); if (a > pk) pk = a; }
    if (pk > 0.98) { const k = 0.98 / pk; for (let i = 0; i < n; i++) sum[i] *= k; }
    return sum;
  }

  /* ---------------- интерфейс: студия эффектора ---------------- */
  const CSS = `
.vfx-card{width:min(880px,97vw);max-height:94vh;overflow:auto;border-radius:20px;border:1px solid rgba(var(--va3,255,90,0),.35);background:radial-gradient(120% 90% at 50% 0%,#1b1d26 0%,#0d0e13 62%,#08090c 100%);box-shadow:0 30px 90px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.06);color:#eceff6;padding:16px 18px 14px;display:grid;gap:14px;position:relative}
.vfx-top{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding-right:30px}
.vfx-title{font:950 13px/1 inherit;letter-spacing:.2em;color:var(--va,#ff5a00);text-transform:uppercase;white-space:nowrap}
.vfx-title small{display:block;margin-top:5px;font:700 10px/1 inherit;letter-spacing:.12em;color:#8a90a2}
.vfx-pre{display:flex;align-items:center;justify-content:center;gap:8px;min-width:0}
.vfx-pre button.arrow{width:34px;height:34px;border-radius:50%;border:1px solid #2c3040;background:linear-gradient(#22252f,#14161c);color:#cfd3e0;font-size:13px;cursor:pointer}
.vfx-pre button.arrow:hover{border-color:var(--va,#ff5a00);color:#fff}
.vfx-name{flex:1;max-width:340px;height:38px;border-radius:12px;border:1px solid #2b2f3d;background:#0a0b0f;box-shadow:inset 0 2px 8px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;gap:8px;font:900 15px/1 inherit;letter-spacing:.04em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 12px}
.vfx-name.off{color:#6d7284}
.vfx-name i{font-style:normal;cursor:pointer;color:#8a90a2;font-size:12px}
.vfx-name i:hover{color:#ff6b6b}
.vfx-pwr{width:44px;height:44px;border-radius:50%;border:1px solid #2c3040;background:linear-gradient(#22252f,#14161c);color:#6d7284;font-size:20px;cursor:pointer;display:grid;place-items:center}
.vfx-pwr.on{color:#fff;border-color:var(--va,#ff5a00);background:radial-gradient(circle at 50% 35%,var(--va,#ff5a00),#9a3400);box-shadow:0 0 18px rgba(var(--va3,255,90,0),.55)}
.vfx-body{display:grid;grid-template-columns:1fr 92px;gap:14px;align-items:stretch}
.vfx-field{display:grid;gap:10px}
.vfx-row{display:flex;justify-content:space-around;align-items:flex-end;gap:6px;flex-wrap:wrap}
.vfx-knob{position:relative;display:grid;justify-items:center;gap:2px;user-select:none;touch-action:none;cursor:ns-resize}
.vfx-knob svg{display:block;overflow:visible}
.vfx-knob .tr{fill:none;stroke:#252835;stroke-width:5;stroke-linecap:round}
.vfx-knob .vl{fill:none;stroke:var(--va,#ff5a00);stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 4px rgba(var(--va3,255,90,0),.8))}
.vfx-knob .pt{stroke:#fff;stroke-width:3;stroke-linecap:round}
.vfx-knob .bd{stroke:#343949;stroke-width:1.5}
.vfx-knob .vv{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font:900 12px/1 inherit;color:#e8ebf4;pointer-events:none;text-shadow:0 1px 3px #000;margin-top:7px}
.vfx-knob .vn{font:900 11px/1.1 inherit;letter-spacing:.14em;color:#99a0b3;text-transform:uppercase;text-align:center}
.vfx-knob:hover .vn{color:#fff}
.vfx-knob.k-big svg{width:132px;height:132px}.vfx-knob.k-mid svg{width:92px;height:92px}.vfx-knob.k-sm svg{width:74px;height:74px}
.vfx-knob.k-sm .vv{font-size:10.5px}.vfx-knob.k-big .vv{font-size:14px}
.vfx-int{display:flex;gap:4px;justify-content:center;margin-top:2px}
.vfx-int button{padding:3px 7px;border-radius:7px;border:1px solid #2c3040;background:#14161c;color:#99a0b3;font:800 10px/1 inherit;cursor:pointer}
.vfx-int button.on{background:var(--va,#ff5a00);border-color:var(--va,#ff5a00);color:#fff}
.vfx-slots{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.vfx-slot{border:1px solid #232634;border-radius:14px;background:linear-gradient(#10121a,#0a0b10);padding:8px 6px 8px;display:grid;gap:4px;justify-items:center}
.vfx-slot header{display:flex;align-items:center;gap:7px;font:900 11px/1 inherit;letter-spacing:.14em;color:#b7bdce;text-transform:uppercase;cursor:pointer}
.vfx-led{width:10px;height:10px;border-radius:50%;background:#2a2d3a;box-shadow:inset 0 1px 2px #000}
.vfx-slot.on .vfx-led{background:var(--va,#ff5a00);box-shadow:0 0 9px var(--va,#ff5a00)}
.vfx-slot.on header{color:#fff}
.vfx-slot .vfx-row{justify-content:center;gap:2px}
.vfx-side{display:grid;grid-template-rows:1fr auto;gap:8px;justify-items:center}
.vfx-wet{display:grid;gap:6px;justify-items:center;align-content:center}
.vfx-bar{position:relative;width:34px;height:210px;border-radius:9px;border:1px solid #2b2f3d;background:#08090c;box-shadow:inset 0 2px 8px rgba(0,0,0,.7);cursor:ns-resize;overflow:hidden;touch-action:none}
.vfx-bar i{position:absolute;left:0;right:0;bottom:0;background:repeating-linear-gradient(to top,var(--va,#ff5a00) 0 7px,transparent 7px 10px);box-shadow:0 0 16px rgba(var(--va3,255,90,0),.5)}
.vfx-wet b{font:900 12px/1 inherit}.vfx-wet span{font:900 10px/1 inherit;letter-spacing:.16em;color:#99a0b3}
.vfx-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between;border-top:1px solid #20232f;padding-top:10px}
.vfx-foot .grp{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.vfx-foot input{height:30px;border-radius:9px;border:1px solid #2b2f3d;background:#0a0b0f;color:#e8ebf4;padding:0 9px;font:700 12px inherit;width:150px}
.vfx-x{position:absolute;right:10px;top:8px;width:28px;height:28px;border-radius:50%;border:0;background:transparent;color:#6d7284;font-size:16px;cursor:pointer}
.vfx-x:hover{color:#fff}
.vfx-hint{font:600 11px/1.4 inherit;color:#7c8296}
@media(max-width:700px){.vfx-body{grid-template-columns:1fr}.vfx-slots{grid-template-columns:repeat(2,1fr)}.vfx-bar{height:90px;width:100%}.vfx-side{grid-template-rows:auto}}
`;

  const init = (api) => {
    const { h, tr, settings, saveSettings, checkbox, toast } = api;
    const dsp = api.dsp || window.__VXP__.dsp;
    let st = {};
    try { st = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
    if (!Array.isArray(st.mine)) st.mine = [];
    const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
    window.__VXP__.voxfx = { version: VERSION, process: (x, sr, P) => process(x, sr, P, dsp), presets: PRESETS, defaults: DEF };

    const cur = () => settings.fx.vox || { on: false };
    const val = (k) => (cur()[k] == null ? DEF[k] : +cur()[k]);
    let ctxNow = null; const knobs = new Set(); const syncAll = () => { for (const k of knobs) k._sync(); };
    const patch = (o, done) => { settings.fx.vox = Object.assign({}, cur(), o); if (done) { saveSettings(); ctxNow && ctxNow.commit(); } };

    const pt = (v) => (v ? (v > 0 ? '+' : '') + v : '0');
    const pc = (v) => (v ? v + '%' : tr('выкл', 'off'));
    const dbf = (v) => (v ? (v > 0 ? '+' : '') + v + tr(' дБ', ' dB') : '0');
    const hzf = (v) => v + tr(' Гц', ' Hz');
    const polar = (a, r) => [50 + r * Math.sin((a * Math.PI) / 180), 50 - r * Math.cos((a * Math.PI) / 180)];
    const arc = (a0, a1) => { const [x0, y0] = polar(a0, 41), [x1, y1] = polar(a1, 41); return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A41 41 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2); };

    /** Круглая ручка: тянуть вверх-вниз (Shift — точнее), колесо мыши, двойной клик — сброс. */
    function knob(o) {
      const size = o.size || 'mid', span = o.max - o.min, def = o.def == null ? DEF[o.key] : o.def;
      const el = h('div', { class: 'vfx-knob k-' + size, title: (o.title || '') + (o.title ? '. ' : '') + tr('Тяни вверх-вниз, колесо мыши, двойной клик — сброс', 'Drag up/down, mouse wheel, double-click to reset') });
      el.innerHTML = '<svg viewBox="0 0 100 100"><path class="tr" d="' + arc(-135, 135) + '"/><path class="vl" d=""/><circle class="bd" cx="50" cy="50" r="30" fill="url(#vfxg)"/><line class="pt" x1="50" y1="24" x2="50" y2="34"/></svg><b class="vv"></b><span class="vn"></span>';
      el.querySelector('.vn').textContent = o.label;
      const vl = el.querySelector('.vl'), ptr = el.querySelector('.pt'), vv = el.querySelector('.vv');
      const snap = (v) => clamp(Math.round(v / o.step) * o.step, o.min, o.max);
      const draw = (v) => {
        const f = (v - o.min) / span, a = -135 + 270 * f, a0 = o.bi ? -135 + 270 * ((def - o.min) / span) : -135;
        const lo = Math.min(a0, a), hi = Math.max(a0, a);
        vl.setAttribute('d', hi - lo < 0.5 ? '' : arc(lo, hi));
        ptr.setAttribute('transform', 'rotate(' + a.toFixed(1) + ' 50 50)');
        vv.textContent = o.fmt ? o.fmt(v) : String(v);
      };
      const set = (v, done) => { v = snap(v); patch({ [o.key]: v, preset: '' }, done); draw(v); if (done) syncPreset(); };
      let wheelT = 0;
      el.addEventListener('pointerdown', (e) => {
        if (e.button) return; e.preventDefault(); el.setPointerCapture(e.pointerId);
        const y0 = e.clientY, v0 = val(o.key); let last = v0;
        const mv = (ev) => { last = clamp(v0 + ((y0 - ev.clientY) / 180) * span * (ev.shiftKey ? 0.2 : 1), o.min, o.max); set(last, false); };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); set(last, true); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
      el.addEventListener('wheel', (e) => { e.preventDefault(); const v = val(o.key) + (e.deltaY < 0 ? 1 : -1) * o.step * (e.shiftKey ? 1 : Math.max(1, Math.round(span / 60))); set(v, false); clearTimeout(wheelT); wheelT = setTimeout(() => set(val(o.key), true), 450); }, { passive: false });
      el.addEventListener('dblclick', () => set(def, true));
      el._sync = () => draw(val(o.key));
      el._sync(); knobs.add(el);
      return el;
    }

    /* ---- пресеты ---- */
    const allPresets = () => PRESETS.map((p) => ({ id: p.id, name: p.ico + ' ' + tr(p.ru, p.en), p: p.p, space: p.space, mine: false })).concat(st.mine.map((m) => ({ id: m.id, name: '⭐ ' + m.name, p: m.p, space: m.space || null, mine: true })));
    const spaceOf = (q) => (q ? Object.assign({ type: 'room', mix: 0, size: 50 }, q) : null);
    let nameEl, pwrEl, wetFill, wetNum, slotEls = [];
    function syncPreset() {
      if (!nameEl) return;
      const id = cur().preset || '', list = allPresets(), p = list.find((q) => q.id === id);
      nameEl.textContent = '';
      nameEl.append(p ? p.name : tr('🎛 Свой звук', '🎛 Custom'));
      if (p && p.mine) nameEl.append(h('i', { title: tr('Удалить этот пресет', 'Delete this preset'), onclick: () => { st.mine = st.mine.filter((q) => q.id !== p.id); keep(); patch({ preset: '' }, true); syncPreset(); toast(tr('Пресет удалён', 'Preset deleted')); } }, '✕'));
      nameEl.classList.toggle('off', !cur().on);
      pwrEl.classList.toggle('on', !!cur().on);
      const w = val('mix'); wetFill.style.height = w + '%'; wetNum.textContent = w + '%';
      for (const s of slotEls) s._upd();
    }
    function applyPreset(q) {
      settings.fx.vox = Object.assign({}, DEF, q.p, { on: true, preset: q.id });
      if (q.space) settings.fx.space = spaceOf(q.space);
      saveSettings(); syncAll(); syncPreset(); ctxNow && ctxNow.commit();
    }
    const step = (d) => { const list = allPresets(); let i = list.findIndex((q) => q.id === (cur().preset || '')); i = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length; applyPreset(list[i]); };

    /* ---- модуль-слот: светодиод включает/выключает «главную» ручку ---- */
    function slot(title, mainKey, keys, kn) {
      const el = h('div', { class: 'vfx-slot' });
      const led = h('i', { class: 'vfx-led' });
      let memo = {};
      const hd = h('header', { title: tr('Клик — включить или выключить модуль', 'Click to switch the module on/off'), onclick: () => {
        const on = keys.some((k) => val(k) > 0);
        if (on) { memo = {}; const o = {}; for (const k of keys) { memo[k] = val(k); o[k] = 0; } patch(Object.assign(o, { preset: '' }), true); }
        else { const o = {}; for (const k of keys) o[k] = memo[k] || (k === mainKey ? 60 : val(k)); patch(Object.assign(o, { preset: '' }), true); }
        syncAll(); syncPreset();
      } }, led, title);
      el.append(hd, h('div', { class: 'vfx-row' }, ...kn));
      el._upd = () => el.classList.toggle('on', keys.some((k) => val(k) > 0));
      slotEls.push(el);
      return el;
    }

    /* ---- сборка окна ---- */
    function openStudio(ctx) {
      const D = api.hostDoc ? api.hostDoc() : document;
      if (D.getElementById('vfx-ov')) return;
      ctxNow = ctx; knobs.clear(); slotEls = [];
      const ov = h('div', { id: 'vfx-ov', class: 'vxp-fxs' });
      const styleEl = h('style', null, CSS);
      const defs = h('div', { style: 'position:absolute;width:0;height:0;overflow:hidden' });
      defs.innerHTML = '<svg width="0" height="0"><defs><radialGradient id="vfxg" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#3b4050"/><stop offset=".55" stop-color="#1b1e27"/><stop offset="1" stop-color="#0d0f14"/></radialGradient></defs></svg>';
      const close = () => { D.removeEventListener('keydown', onKey, true); ov.remove(); ctxNow = null; };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      D.addEventListener('keydown', onKey, true);
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });

      nameEl = h('div', { class: 'vfx-name' });
      pwrEl = h('button', { class: 'vfx-pwr', type: 'button', title: tr('Включить / выключить эффектор', 'Effector on/off'), onclick: () => { patch({ on: !cur().on }, true); syncPreset(); } }, '⏻');
      const top = h('div', { class: 'vfx-top' },
        h('div', { class: 'vfx-title' }, '🎭 ' + tr('Эффектор голоса', 'Voice effector'), h('small', null, 'ORDAX FX')),
        h('div', { class: 'vfx-pre' }, h('button', { class: 'arrow', type: 'button', title: tr('Предыдущий пресет', 'Previous preset'), onclick: () => step(-1) }, '◀'), nameEl, h('button', { class: 'arrow', type: 'button', title: tr('Следующий пресет', 'Next preset'), onclick: () => step(1) }, '▶')),
        pwrEl);

      const K = (key, label, min, max, stp, fmt, size, extra) => knob(Object.assign({ key, label, min, max, step: stp, fmt, size }, extra || {}));
      const intBtns = [[3, tr('3', '3')], [5, tr('4', '4')], [7, tr('5', '5')], [12, tr('8', '8')]].map(([v, l]) => h('button', { type: 'button', title: tr('Интервал гармонайзера', 'Harmonizer interval'), 'data-v': v, onclick: () => { patch({ upInt: v, preset: '' }, true); syncInt(); } }, l));
      const syncInt = () => intBtns.forEach((b) => b.classList.toggle('on', +b.dataset.v === val('upInt')));
      syncInt();
      const harm = h('div', { style: 'display:grid;justify-items:center;gap:2px' }, K('up', tr('Гармоники', 'Harmonics'), 0, 100, 1, pc, 'big', { title: tr('Копия голоса выше на выбранный интервал', 'A copy above by the chosen interval') }), h('div', { class: 'vfx-int' }, intBtns));

      const row1 = h('div', { class: 'vfx-row' },
        K('pitch', tr('Питч', 'Pitch'), -24, 24, 1, pt, 'big', { bi: true, title: tr('Высота голоса в полутонах, формант не меняется', 'Pitch in semitones, formant stays') }),
        K('formant', tr('Формант', 'Formant'), -12, 12, 1, pt, 'big', { bi: true, title: tr('Размер «горла»: вниз — гигант, вверх — малыш', 'Throat size: down — a giant, up — a tiny one') }),
        harm,
        K('sub', tr('Октава вниз', 'Sub octave'), 0, 100, 1, pc, 'big', { title: tr('Копия голоса на октаву ниже: вес и бас', 'A copy an octave lower: weight and bass') }));
      const row2 = h('div', { class: 'vfx-row' },
        K('uni', tr('Хор', 'Chorus'), 0, 4, 1, (v) => (v ? v + '' : tr('выкл', 'off')), 'mid', { title: tr('Слегка расстроенные двойники (0–4)', 'Slightly detuned doubles (0–4)') }),
        K('det', tr('Расстройка', 'Detune'), 0, 60, 1, (v) => v + tr(' ц', ' ct'), 'mid', { title: tr('Насколько двойники расстроены', 'How detuned the doubles are') }),
        K('whisper', tr('Шёпот', 'Whisper'), 0, 100, 1, pc, 'mid', { title: tr('Дыхательный слой без тона', 'A breathy toneless layer') }),
        K('low', tr('Низы', 'Lows'), -12, 12, 1, dbf, 'mid', { bi: true }),
        K('high', tr('Верха', 'Highs'), -12, 12, 1, dbf, 'mid', { bi: true }));
      const slots = h('div', { class: 'vfx-slots' },
        slot(tr('Рык', 'Growl'), 'growl', ['growl'], [K('growl', tr('Сила', 'Amount'), 0, 100, 1, pc, 'sm'), K('growlHz', tr('Частота', 'Rate'), 25, 140, 1, hzf, 'sm', { def: 70 })]),
        slot(tr('Робот', 'Robot'), 'robot', ['robot'], [K('robot', tr('Сила', 'Amount'), 0, 100, 1, pc, 'sm'), K('robotHz', tr('Нота', 'Note'), 50, 300, 1, hzf, 'sm', { def: 110 })]),
        slot(tr('Кольцо', 'Ring'), 'ring', ['ring'], [K('ring', tr('Сила', 'Amount'), 0, 100, 1, pc, 'sm'), K('ringHz', tr('Частота', 'Freq'), 10, 400, 1, hzf, 'sm', { def: 30 })]),
        slot(tr('Грязь', 'Grit'), 'drive', ['drive', 'crush'], [K('drive', tr('Драйв', 'Drive'), 0, 100, 1, pc, 'sm'), K('crush', tr('Хруст', 'Crush'), 0, 100, 1, pc, 'sm')]));

      /* вертикальный регулятор «эффект / оригинал» + громкость */
      wetFill = h('i'); wetNum = h('b');
      const bar = h('div', { class: 'vfx-bar', title: tr('Сколько эффекта в итоге (100% — только эффект). Двойной клик — 100%', 'How much effect stays (100% — effect only). Double-click for 100%') }, wetFill);
      const setWet = (v, done) => { v = clamp(Math.round(v), 0, 100); patch({ mix: v, preset: '' }, done); wetFill.style.height = v + '%'; wetNum.textContent = v + '%'; if (done) syncPreset(); };
      bar.addEventListener('pointerdown', (e) => {
        e.preventDefault(); bar.setPointerCapture(e.pointerId);
        const upd = (ev) => { const r = bar.getBoundingClientRect(); setWet(100 * (1 - (ev.clientY - r.top) / r.height), false); };
        const up = () => { bar.removeEventListener('pointermove', upd); bar.removeEventListener('pointerup', up); setWet(val('mix'), true); };
        upd(e); bar.addEventListener('pointermove', upd); bar.addEventListener('pointerup', up);
      });
      bar.addEventListener('dblclick', () => setWet(100, true));
      const side = h('div', { class: 'vfx-side' }, h('div', { class: 'vfx-wet' }, wetNum, bar, h('span', null, tr('ЭФФЕКТ', 'WET'))), K('level', tr('Громкость', 'Level'), -12, 12, 1, dbf, 'sm', { bi: true }));

      const nameInp = h('input', { type: 'text', placeholder: tr('Название пресета', 'Preset name'), maxlength: '24' });
      const saveBtn = h('button', { class: 'vxp-btn small', type: 'button', title: tr('Сохранить текущие ручки как свой пресет', 'Save the current knobs as your preset'), onclick: () => {
        const nm = (nameInp.value || '').trim().slice(0, 24); if (!nm) return toast(tr('Введите название пресета', 'Enter a preset name'), 'err');
        const o = Object.assign({}, norm(cur())); delete o.on; delete o.preset;
        const id = 'my' + Date.now().toString(36);
        st.mine.push({ id, name: nm, p: o, space: Object.assign({}, settings.fx.space) }); keep();
        patch({ preset: id }, true); nameInp.value = ''; syncPreset(); toast(tr('Пресет сохранён', 'Preset saved'));
      } }, tr('⭐ Сохранить', '⭐ Save'));
      const foot = h('div', { class: 'vfx-foot' },
        h('div', { class: 'grp' },
          h('button', { class: 'vxp-btn small', type: 'button', title: tr('Послушать мою дорожку без эффектора (повторный клик — стоп)', 'Listen without the effector (click again to stop)'), onclick: () => ctx.ab({ vox: { on: false } }) }, tr('▶ Без эффектора', '▶ Dry')),
          h('button', { class: 'vxp-btn small primary', type: 'button', title: tr('Послушать мою дорожку с эффектором', 'Listen with the effector'), onclick: () => ctx.ab({ vox: Object.assign({}, cur(), { on: true }) }) }, tr('▶ С эффектором', '▶ With effector'))),
        h('div', { class: 'grp' }, nameInp, saveBtn,
          h('button', { class: 'vxp-btn small', type: 'button', onclick: () => { settings.fx.vox = { on: cur().on }; saveSettings(); syncAll(); syncInt(); syncPreset(); ctx.commit(); } }, tr('Сбросить', 'Reset')),
          h('button', { class: 'vxp-btn small', type: 'button', onclick: close }, tr('Закрыть', 'Close'))));
      const x = h('button', { class: 'vfx-x', type: 'button', title: tr('Закрыть (Esc)', 'Close (Esc)'), onclick: close }, '✕');

      const card = h('div', { class: 'vfx-card' }, x, top,
        h('div', { class: 'vfx-body' }, h('div', { class: 'vfx-field' }, row1, row2, slots), side),
        foot,
        h('div', { class: 'vfx-hint' }, tr('Эффектор обрабатывает записанную дорожку, на сложных настройках расчёт занимает несколько секунд. Эхо и зал добавляются в блоке «Пространство» панели.', 'The effector processes the recorded take; heavy settings may take a few seconds. Echo and hall are added in the panel’s “Space” block.')));
      ov.append(styleEl, defs, card);
      D.body.appendChild(ov);
      syncAll(); syncPreset();
    }

    /* ---- кнопка в панели «Обработка» ---- */
    api.addFxExtra({
      id: 'vox',
      build(ctx) {
        const btn = h('button', { class: 'vxp-btn primary wide', type: 'button', title: tr('Питч и формант, суб-октава, хор, рык, робот, дисторшн и пресеты: демон, дракон, веном', 'Pitch and formant, sub octave, chorus, growl, robot, drive and presets: demon, dragon, venom'), onclick: () => openStudio(ctx) }, '🎭 ' + tr('ЭФФЕКТОР ГОЛОСА · питч, формант, рык', 'VOICE EFFECTOR · pitch, formant, growl'));
        const on = checkbox({ label: tr('Эффектор включён', 'Effector on'), get: () => cur().on, set: (v) => { patch({ on: v }, true); }, title: tr('Обработать мою дорожку эффектором. Работает по готовой записи', 'Process my take with the effector. Works on the recorded take') });
        return h('div', { style: 'display:grid;gap:7px' }, btn, on);
      },
    });
  };

  if (window.__VXP__ && window.__VXP__.registerModule) window.__VXP__.registerModule(NAME, init);
  else (window.__VXP_PLUGINS__ = window.__VXP_PLUGINS__ || []).push({ name: NAME, init });
})();