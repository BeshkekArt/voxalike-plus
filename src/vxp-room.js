/*!
 * Voxalike+OrdaxEd — модуль «Убрать комнату» (авто-дереверберация) 1.1.0
 * Отдельный файл: подключается к основному моду (vxp-main.js) и работает только вместе с ним.
 * Сам слушает вашу запись: по спаду звука после слов определяет, насколько в ней гулкая комната и сколько длится эхо,
 * и подбирает настройки. Поздний хвост эха оценивается по модели экспоненциального спада и вычитается в спектре,
 * ближние отражения (живость голоса) сохраняются. Обработка офлайн, классический алгоритм без нейросети.
 */
(() => {
  'use strict';
  const NAME = 'room', VERSION = '1.1.0';
  const DEF = { on: false, k: 100 };
  const ROOM = (() => {
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const plans = new Map();
    function plan(n) { let p = plans.get(n); if (p) return p; const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n), cs = new Float64Array(n / 2), sn = new Float64Array(n / 2); for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; } for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos((2 * Math.PI * i) / n); sn[i] = -Math.sin((2 * Math.PI * i) / n); } p = { n, rev, cs, sn }; plans.set(n, p); return p; }
    function fft(re, im, inv) {
      const { n, rev, cs, sn } = plan(re.length);
      for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= n; size <<= 1) { const half = size >> 1, step = n / size; for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) { const wr = cs[k], wi = inv ? -sn[k] : sn[k], a = i + j, b = a + half; const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
      if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
    /**
     * Убрать «комнату»: поздний хвост реверберации оценивается моделью экспоненциального спада (T60) и вычитается в спектре.
     * P = { amt 0..100, t60 сек, early мс (ближние отражения сохраняются), keep 0..100 (% оригинала в итоге) }
     */
    function dereverb(x, sr, P) {
      const n = x.length, N = 1024, H = 256, K = N >> 1, w = new Float64Array(N);
      for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      const amt = clamp((P.amt == null ? 60 : P.amt) / 100, 0, 1), t60 = clamp(P.t60 || 0.5, 0.1, 2), early = clamp(P.early == null ? 50 : P.early, 20, 120), keep = clamp((P.keep == null ? 15 : P.keep) / 100, 0, 1);
      if (amt <= 0) return x;
      const hopSec = H / sr, D = Math.max(2, Math.round(early / 1000 / hopSec));
      const frames = Math.ceil((n + N) / H), re = new Float64Array(N), im = new Float64Array(N);
      // 1. спектры и мощности
      const spec = new Array(frames), pw = new Array(frames);
      for (let t = 0; t < frames; t++) {
        const pos = -N + H + t * H; for (let i = 0; i < N; i++) { const q = pos + i; re[i] = q >= 0 && q < n ? x[q] * w[i] : 0; im[i] = 0; }
        fft(re, im, false);
        const R = new Float32Array(K + 1), I = new Float32Array(K + 1), p = new Float32Array(K + 1);
        for (let k = 0; k <= K; k++) { R[k] = re[k]; I[k] = im[k]; p[k] = re[k] * re[k] + im[k] * im[k]; }
        spec[t] = [R, I]; pw[t] = p;
      }
      // 2. оценка позднего хвоста: максимум из затухающего прошлого и мощности, отодвинутой на «ближнюю» задержку
      const alpha = 1.2 + 2.8 * amt, floor = Math.pow(10, -(6 + 20 * amt) / 20), floor2 = floor * floor;
      const L = new Float32Array(K + 1), G = new Array(frames);
      const rho = new Float32Array(K + 1), gD = new Float32Array(K + 1);
      for (let k = 0; k <= K; k++) { const tk = t60 * (1 + 0.7 * Math.pow(1 - k / K, 2)); rho[k] = Math.pow(10, (-6 * hopSec) / tk); gD[k] = Math.pow(10, (-6 * D * hopSec) / tk); }
      const sm = new Float32Array(K + 1);
      for (let t = 0; t < frames; t++) {
        const cur = pw[t], del = t - D >= 0 ? pw[t - D] : null, g = new Float32Array(K + 1);
        // сглаживание мощности по частоте (±2 бина) — меньше случайных провалов
        for (let k = 0; k <= K; k++) { let s = 0, c = 0; for (let d = -2; d <= 2; d++) { const q = k + d; if (q >= 0 && q <= K) { s += cur[q]; c++; } } sm[k] = s / c; }
        for (let k = 0; k <= K; k++) {
          const dl = del ? (del[k] + (k > 0 ? del[k - 1] : del[k]) + (k < K ? del[k + 1] : del[k])) / 3 : 0;
          L[k] = Math.max(L[k] * rho[k], gD[k] * dl);
          // падает ли энергия по сравнению с моментом «ближних отражений» назад: падает — это хвост, держится — это сама речь
          const drop = dl > 1e-12 ? -10 * Math.log10(Math.max(sm[k], 1e-12) / dl) : 6;
          const u = clamp(drop / 6, 0, 1), ae = alpha * (0.15 + 0.85 * u);
          const r = 1 - (ae * L[k]) / Math.max(sm[k], 1e-12);
          g[k] = Math.sqrt(Math.max(floor2, r));
        }
        G[t] = g;
      }
      // 3. сглаживание усиления: по частоте и времени (против «музыкального шума»)
      const out = new Float32Array(n), nrm = new Float32Array(n), tmp = new Float32Array(K + 1);
      for (let t = 0; t < frames; t++) {
        const a = G[Math.max(0, t - 1)], b = G[t], c = G[Math.min(frames - 1, t + 1)];
        for (let k = 0; k <= K; k++) { const kk0 = Math.max(0, k - 1), kk1 = Math.min(K, k + 1); tmp[k] = (0.25 * (a[k] + c[k]) + 0.5 * b[k]) * 0.5 + 0.25 * (0.25 * (a[kk0] + c[kk0]) + 0.5 * b[kk0]) + 0.25 * (0.25 * (a[kk1] + c[kk1]) + 0.5 * b[kk1]); }
        const [R, I] = spec[t];
        for (let k = 0; k <= K; k++) { re[k] = R[k] * tmp[k]; im[k] = I[k] * tmp[k]; if (k > 0 && k < K) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
        im[0] = 0; im[K] = 0;
        fft(re, im, true);
        const pos = -N + H + t * H;
        for (let i = 0; i < N; i++) { const q = pos + i; if (q >= 0 && q < n) { out[q] += re[i] * w[i]; nrm[q] += w[i] * w[i]; } }
      }
      for (let i = 0; i < n; i++) { const y = nrm[i] > 1e-6 ? out[i] / nrm[i] : out[i]; out[i] = y * (1 - keep) + x[i] * keep; }
      return out;
    }
    return { dereverb };
  })();
  /** Анализ записи: по спаду энергии после слов определяем, сколько в записи комнаты, и подбираем параметры. */
  function analyzeRoom(x, sr) {
    const hop = Math.round(sr * 0.01), n = Math.floor(x.length / hop), none = { t60: 0.4, amt: 0, keep: 15, conf: 0, tail: null };
    if (n < 60) return none;
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j++) { const v = x[i * hop + j]; s += v * v; } e[i] = 10 * Math.log10(s / hop + 1e-12); }
    const sorted = Array.from(e).sort((a, b) => a - b), floor = sorted[Math.floor(n * 0.08)], sp = sorted[Math.floor(n * 0.92)];
    if (sp - floor < 14) return { t60: 0.4, amt: 25, keep: 18, conf: 0, tail: null }; // слишком мало пауз: берём мягкие значения
    const t60s = [], tails = [];
    for (let i = 4; i < n - 32; i++) {
      const before = (e[i - 3] + e[i - 2] + e[i - 1]) / 3;
      if (before < sp - 10 || e[i + 3] > before - 6 || e[i - 1] < e[i - 2] - 3) continue; // не конец громкого звука
      let lim = 30; for (let k = 5; k <= 30; k++) if (e[i + k] > e[i + k - 1] + 5) { lim = k - 1; break; } // дальше начался новый звук
      if (lim < 13) continue; // пауза слишком короткая, чтобы судить о хвосте
      // спад: от 2-го кадра после падения до пола или до роста
      let end = i + 3, mn = e[end]; while (end < i + lim && e[end] > floor + 5 && e[end] < mn + 4) { mn = Math.min(mn, e[end]); end++; }
      const m = end - (i + 3);
      if (m >= 6) {
        let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let k = 0; k < m; k++) { const t = k * 0.01, y = e[i + 3 + k]; sx += t; sy += y; sxx += t * t; sxy += t * y; }
        const sl = (m * sxy - sx * sy) / (m * sxx - sx * sx);
        if (sl < -6 && sl > -500) t60s.push(60 / -sl);
      }
      let tl = 0; let c = 0; for (let k = 8; k <= Math.min(25, lim); k++) { tl += e[i + k]; c++; } tails.push(tl / c);
    }
    if (tails.length < 3) return { t60: 0.4, amt: 25, keep: 18, conf: 0.2, tail: null };
    const med = (a) => { const b = a.slice().sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
    const tail = med(tails), rel = tail - sp, above = tail - floor;
    const t60 = t60s.length >= 3 ? Math.min(1.5, Math.max(0.15, med(t60s))) : 0.4;
    let amt;
    if (above < 4) amt = 0;
    else { const pts = [[-12, 95], [-20, 75], [-30, 45], [-40, 15], [-48, 0]]; amt = pts[pts.length - 1][1]; if (rel >= pts[0][0]) amt = pts[0][1]; else for (let i = 0; i < pts.length - 1; i++) if (rel <= pts[i][0] && rel >= pts[i + 1][0]) { const f = (rel - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); amt = pts[i][1] + f * (pts[i + 1][1] - pts[i][1]); } }
    return { t60, amt: Math.round(amt), keep: Math.round(25 - 0.15 * amt), conf: Math.min(1, tails.length / 8), tail: Math.round(rel) };
  }

  /* анализ запоминается, пока дорожка та же: ручки «Сила» не пересчитывают его заново */
  const memo = new Map();
  function fingerprint(x, sr) {
    let a = 0, b = 0; const st = Math.max(1, Math.floor(x.length / 97));
    for (let i = 0; i < x.length; i += st) { a += x[i] * (1 + (i % 7)); b += Math.abs(x[i]); }
    return x.length + ':' + sr + ':' + a.toFixed(5) + ':' + b.toFixed(5);
  }
  function analyzeCached(x, sr) {
    const key = fingerprint(x, sr); let r = memo.get(key);
    if (!r) { r = analyzeRoom(x, sr); memo.set(key, r); while (memo.size > 6) memo.delete(memo.keys().next().value); }
    return r;
  }

  const init = (api) => {
    const { h, tr, settings, saveSettings, checkbox, slider, toast } = api;
    const roomfx = window.__VXP__.roomfx = { version: VERSION, last: null, defaults: DEF, analyze: analyzeRoom };
    /** P: { k } — множитель силы в % (100 = как подобрал анализ). Если задан P.manual — берутся ручные amt/t60/early/keep. */
    roomfx.process = (x, sr, P) => {
      P = Object.assign({}, DEF, P);
      if (P.manual) return ROOM.dereverb(x, sr, P.manual);
      const a = analyzeCached(x, sr); roomfx.last = a;
      const amt = Math.min(100, a.amt * (P.k / 100));
      if (amt < 3) return x;
      return ROOM.dereverb(x, sr, { amt, t60: a.t60, early: 50, keep: a.keep });
    };
    api.addFxExtra({
      id: 'room',
      build(ctx) {
        const cur = () => Object.assign({}, DEF, settings.fx.room || {});
        const patch = (o, done) => { settings.fx.room = Object.assign({}, cur(), o); if (done) { saveSettings(); ctx.commit(); } };
        const on = checkbox({ label: tr('🏠 Убрать эхо комнаты (авто)', '🏠 Remove room echo (auto)'), get: () => !!(settings.fx.room && settings.fx.room.on), set: (v) => patch({ on: v }, true), title: tr('Мод сам послушает вашу запись и подберёт настройки. Работает по готовой записи', 'The mod listens to your take and picks the settings itself. Works on the recorded take') });
        const info = h('div', { class: 'vxp-hint' });
        const fmtInfo = () => {
          const a = roomfx.last;
          if (!cur().on) return tr('Включите галочку — настройки подберутся по вашей записи.', 'Turn it on — the settings are picked from your take.');
          if (!a) return tr('Запишите реплику — тогда я подберу настройки.', 'Record a line — then I will pick the settings.');
          if (a.conf < 0.3) return tr('В записи мало пауз, поэтому взял мягкие настройки.', 'Few pauses in the take, so I used gentle settings.');
          if (a.amt < 3) return tr('Комната сухая, эха почти нет — трогать не нужно.', 'The room is dry, almost no echo — nothing to remove.');
          const lvl = a.amt >= 70 ? tr('сильное', 'strong') : a.amt >= 35 ? tr('заметное', 'noticeable') : tr('лёгкое', 'light');
          return tr('Эхо ' + lvl + ', около ' + a.t60.toFixed(1) + ' с. Убираю на ' + Math.round(Math.min(100, a.amt * cur().k / 100)) + '%.', 'Echo is ' + lvl + ', about ' + a.t60.toFixed(1) + ' s. Removing ' + Math.round(Math.min(100, a.amt * cur().k / 100)) + '%.');
        };
        const sl = slider({ label: tr('Сила', 'Amount'), min: 0, max: 150, step: 5, def: 100, get: () => cur().k, set: (v, d) => patch({ k: v }, d), fmt: (v) => v + '%', title: tr('100% — как подобрал анализ. Больше — сильнее убирает, но звук суше. Двойной клик — сброс', '100% — as picked by the analysis. More removes more but sounds drier. Double-click to reset') });
        const ab = h('div', { class: 'vxp-row' },
          h('button', { class: 'vxp-btn small', type: 'button', title: tr('Послушать мою дорожку без этой обработки', 'Listen without this processing'), onclick: () => ctx.ab({ room: { on: false } }) }, tr('▶ Без неё', '▶ Without')),
          h('button', { class: 'vxp-btn small', type: 'button', title: tr('Послушать мою дорожку с обработкой', 'Listen with the processing'), onclick: () => ctx.ab({ room: Object.assign({}, cur(), { on: true }) }) }, tr('▶ С ней', '▶ With')));
        const box = h('div', { style: 'display:grid;gap:7px' }, on, info, sl, ab);
        const upd = () => { info.textContent = fmtInfo(); };
        box._sync = upd; upd();
        const t = setInterval(() => { if (!box.isConnected) { clearInterval(t); return; } upd(); }, 900);
        try { api.widgets.add(box); } catch {}
        return box;
      },
    });
  };

  if (window.__VXP__ && window.__VXP__.registerModule) window.__VXP__.registerModule(NAME, init);
  else (window.__VXP_PLUGINS__ = window.__VXP_PLUGINS__ || []).push({ name: NAME, init });
})();