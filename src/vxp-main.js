/*!
 * Voxalike+OrdaxEd — редакция ORDAX для https://voxalike.com
 * Основано на Voxalike+ (https://github.com/BeshkekArt/voxalike-plus · MIT License · © 2026 BeshkekArt).
 * Изменения OrdaxEd: новый дизайн в стиле ORDAX, шумодав микрофона и дорожки,
 *   профиль шума («Запомнить шум»), сравнение до/после, панель диагностики,
 *   10 тем оформления (включая светлую и «Радугу»),
 *   ORDAX FX: эквалайзер со спектром, компрессор, дэ-эссер, лимитер, пресеты.
 * Не связан с разработчиками Voxalike. Предоставляется «как есть», без гарантий.
 *
 * Работает на оригинальных серверах: ничего не подменяет на сервере,
 * только улучшает интерфейс и логику клиента.
 *
 *  • Сцена озвучки: 2 дорожки (оригинал / моя запись), сдвиг моей дорожки,
 *    автоподгонка, прослушивание «вместе», волна в реальном времени.
 *  • Обработка: питч, громкость дорожки, срез низов, шумодав (неразрушающая).
 *  • Шумодав микрофона: спектральное вычитание в реальном времени (AudioWorklet),
 *    сила регулируется, работает при записи и в студии.
 *  • Запись: усиление микрофона, мониторинг, «слушать оригинал»,
 *    отсчёт 3-2-1, буфер после реплики (~5 с).
 *  • Сетевая игра «Совместно»: запиши все свои реплики заранее — мод
 *    отправит каждую мгновенно, когда подойдёт твоя очередь.
 *  • Chrome / Edge / Яндекс / Opera / Firefox.
 */
(() => {
  'use strict';
  if (window.__VXP__) return;
  const VERSION = '1.20.0';
  const VXP = (window.__VXP__ = { version: VERSION });
  const IS_FF = /firefox/i.test(navigator.userAgent);

  /* ================================================================== */
  /*  Утилиты                                                            */
  /* ================================================================== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dbToLin = (db) => Math.pow(10, db / 20);
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  /* Окно студии: если студия вынесена в отдельное окно, документ, кадры и таймеры берём оттуда
     (фоновая вкладка игры не тормозит интерфейс студии). */
  let stageWin = null;
  const W = () => (stageWin && !stageWin.closed ? stageWin : window);
  const hostDoc = () => W().document;
  const raf = (f) => W().requestAnimationFrame(f);
  const caf = (id) => W().cancelAnimationFrame(id);
  const wst = (f, ms) => W().setTimeout(f, ms);
  const wct = (id) => W().clearTimeout(id);
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
  const fmtMs = (ms) => { const r = Math.round(ms); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r) + ' ' + tr('мс', 'ms'); };
  const fmtSigned = (v, unit) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' ' + unit;
  const isTyping = (t) =>
    t && (t.isContentEditable || /^(textarea|select)$/i.test(t.tagName) ||
      (t.tagName === 'INPUT' && !/^(range|checkbox|button)$/i.test(t.type)));

  /* ================================================================== */
  /*  Настройки                                                          */
  /* ================================================================== */
  const SKEY = 'vxp:settings:v1';
  const cloneJ = (o) => JSON.parse(JSON.stringify(o));
  const defEq = () => [
    { type: 'hp', f: 80, g: 0, q: 0.71, on: false }, { type: 'lowshelf', f: 150, g: 0, q: 0.7, on: false },
    { type: 'bell', f: 400, g: 0, q: 1, on: false }, { type: 'bell', f: 2500, g: 0, q: 1, on: false },
    { type: 'bell', f: 6000, g: 0, q: 1.2, on: false }, { type: 'highshelf', f: 10000, g: 0, q: 0.7, on: false }];
  const defFx = () => ({
    pitch: 0, gain: 0, lowcut: false, speed: 1, underwater: false, echo: false, denoise: 0, space: { type: 'room', mix: 0, size: 50 },
    eq: defEq(), comp: { on: false, thr: -24, ratio: 3, att: 10, rel: 120, knee: 6, makeup: 0 },
    deess: { on: false, f: 6500, thr: -34, amt: 6 }, lim: { on: false, ceil: -1, gain: 0 }, vox: { on: false }, nn: '', room: { on: false } });
  const settings = Object.assign(
    {
      gainDb: 0, monitorSelf: false, monitorVol: 0.8, rawMic: true,
      nr: false, nrStrength: 55, theme: 'ordax',
      studioGuide: true, guideVol: 0.55, studioPopout: false, quietSite: true,
      countdown: 3, countBeep: true, tailSec: 5,
      autoSubmit: true, notifyTurn: true, hotkeys: true, lobbyStats: true, punchReplace: true, loopPlay: false, playFromMarker: false,
      fx: defFx(),
      collapsed: {},
      lang: 'auto', // auto | ru | en
    },
    (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } })()
  );
  settings.rawMic = false; // функция «Чистый микрофон» убрана: микрофон игры не трогаем
  settings.fx = Object.assign(defFx(), settings.fx || {});
  settings.nr = false; // шумодав в реальном времени убран из интерфейса
  if (!settings.nrPostMig) { // шумодав теперь работает ПОСЛЕ записи; в реальном времени — только если включить вручную
    settings.nrPostMig = 1; settings.nr = false; if (!settings.fx.denoise) settings.fx.denoise = 40;
    try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {}
  }
  { const d = defFx(); if (!Array.isArray(settings.fx.eq) || settings.fx.eq.length !== 6) settings.fx.eq = d.eq; for (const k of ['comp', 'deess', 'lim', 'space']) settings.fx[k] = Object.assign(d[k], settings.fx[k] || {}); if (settings.fx.echo) { settings.fx.echo = false; settings.fx.space = { type: 'echo', mix: 40, size: 25 }; } }
  if (settings.collapsed.app === undefined) settings.collapsed.app = true;
  if (settings.collapsed.diag === undefined) settings.collapsed.diag = true;
  for (const k of ['st_rec', 'st_nr', 'st_set']) if (settings.collapsed[k] === undefined) settings.collapsed[k] = true;
  /** Язык интерфейса: 'auto' — по языку браузера (ru/uk/be/kk → русский, иначе English). */
  const curLang = () => (settings.lang === 'ru' || settings.lang === 'en' ? settings.lang
    : /^(ru|uk|be|kk)\b/i.test(navigator.language || '') ? 'ru' : 'en');
  /** tr(русский, english) — строка на текущем языке. */
  const tr = (ru, en) => (curLang() === 'en' ? en : ru);
  const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} };
  VXP.settings = settings;

  /* ================================================================== */
  /*  Темы оформления                                                    */
  /* ================================================================== */
  const THEMES = [
    ['ordax', 'ORDAX', 'ORDAX', '#ff5a00', '#ff8a3d'],
    ['cyan', 'Бирюза', 'Cyan', '#2fd8c2', '#6ff0de'],
    ['violet', 'Фиолет', 'Violet', '#9b6bff', '#c2a0ff'],
    ['rose', 'Роза', 'Rose', '#ff4f8b', '#ff86b0'],
    ['blue', 'Синий', 'Blue', '#3d8bff', '#7db3ff'],
    ['lime', 'Лайм', 'Lime', '#7fd100', '#b0ee4a'],
    ['gold', 'Золото', 'Gold', '#ffb020', '#ffd060'],
    ['mono', 'Моно', 'Mono', '#e8e8ee', '#ffffff'],
    ['light', 'Светлая', 'Light', '#e84d00', '#ff7a2e'],
    ['rainbow', 'Радуга', 'Rainbow', '#ff3b3b', '#ffd23b'],
  ];
  const hexRgb = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
  const rgbHex = (r) => '#' + r.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const hsl = (hh, ss, ll) => { const a = ss * Math.min(ll, 1 - ll), f = (n) => { const k = (n + hh / 30) % 12; return ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return rgbHex([f(0) * 255, f(8) * 255, f(4) * 255]); };
  const LIGHT_VARS = '--vb:#f4f4f7;--v1:#ffffff;--v2:#f1f1f5;--v3:#e7e7ee;--vl:rgba(0,0,0,.1);--vl2:rgba(0,0,0,.2);--vt:#16161c;--vd:rgba(22,22,28,.62);--vtr:#d3d3dd;--vtr2:#dcdce4;--vh:#dcdce6;--vp0:#ffffff;--vp1:#f0f0f5;--vcard:#fafafc;--vov:rgba(235,235,242,.86);--vok:#0aa66a;--vw:#c77d00;--vr:#d62c3e;--vo:#5d6b80;';
  /** Текущие цвета темы (для canvas и CSS). */
  const THEME = { id: 'ordax', acc: '#ff5a00', acc2: '#ff8a3d', rgb: '255,90,0', mine: '#ff8a3d', mineRGB: '255,138,61', sel: '#ffd9bf' };
  function themeStyleText() {
    const light = THEME.id === 'light';
    return '.vxp-panel,.vxp-studio,.vxp-toasts,.vxp-count{--va:' + THEME.acc + ';--va2:' + THEME.acc2 + ';--va3:' + THEME.rgb + ';' + (light ? LIGHT_VARS : '') + '}.vxp-fxs{--va:' + THEME.acc + ';--va2:' + THEME.acc2 + ';--va3:' + THEME.rgb + '}';
  }
  function computeTheme() {
    let spec = THEMES.find((t) => t[0] === settings.theme) || THEMES[0], acc = spec[3], acc2 = spec[4];
    if (spec[0] === 'rainbow') { const hue = (Date.now() / 45) % 360; acc = hsl(hue, 1, 0.55); acc2 = hsl((hue + 28) % 360, 1, 0.65); }
    THEME.id = spec[0]; THEME.acc = acc; THEME.acc2 = acc2;
    THEME.rgb = hexRgb(acc).join(','); THEME.mine = acc2; THEME.mineRGB = hexRgb(acc2).join(',');
    THEME.sel = rgbHex(hexRgb(acc2).map((v) => v + (255 - v) * 0.6));
  }
  let themeEl = null, rainbowTimer = 0, rainbowDraw = 0;
  function applyTheme() {
    computeTheme();
    if (!themeEl || !themeEl.isConnected) { themeEl = h('style', { id: 'vxp-theme' }); (document.head || document.documentElement).append(themeEl); }
    themeEl.textContent = themeStyleText();
    clearInterval(rainbowTimer); rainbowTimer = 0;
    if (THEME.id === 'rainbow') {
      rainbowTimer = setInterval(() => {
        if (document.hidden) return;
        computeTheme(); themeEl.textContent = themeStyleText();
        if (++rainbowDraw % 6 === 0) emit('theme');
      }, 180);
    }
    emit('theme');
  }
  const themeName = (t) => tr(t[1], t[2]);
  function themeControl() {
    const box = h('div', { class: 'vxp-themes' });
    const sws = THEMES.map((t) => {
      const bg = t[0] === 'rainbow' ? 'conic-gradient(#ff3b3b,#ffd23b,#4be36a,#3dc4ff,#9b6bff,#ff3b3b)' : t[0] === 'light' ? 'linear-gradient(135deg,#ffffff 45%,' + t[3] + ' 55%)' : 'linear-gradient(135deg,' + t[3] + ',' + t[4] + ')';
      const b = h('button', { class: 'vxp-sw', type: 'button', title: themeName(t), style: 'background:' + bg, onclick: () => { settings.theme = t[0]; saveSettings(); applyTheme(); syncWidgets(); } });
      b._id = t[0]; return b;
    });
    box.append(...sws);
    const el = h('div', { style: 'display:grid;gap:6px' }, h('div', { class: 'vxp-inline' }, h('span', null, '🎨 ' + tr('Тема', 'Theme'))), box);
    el._sync = () => sws.forEach((b) => b.classList.toggle('on', b._id === settings.theme));
    el._sync(); widgets.add(el);
    return el;
  }

  const bus = new EventTarget();
  const emit = (n, d) => bus.dispatchEvent(new CustomEvent(n, { detail: d }));
  const onBus = (n, f) => bus.addEventListener(n, (e) => f(e.detail));
  onBus('theme', () => { try { panel.editor && panel.editor.draw(); studio && studio.editor && studio.editor.draw(); } catch {} });

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

  function lowpass(x, sr, f0 = 700, Q = 0.8) {
    const w0 = (2 * Math.PI * f0) / sr, c = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
    const a0 = 1 + al, b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  /** «Под водой»: плавающая задержка (лёгкое вибрато) + глухой фильтр. */
  function underwater(x, sr) {
    const n = x.length, y = new Float32Array(n), base = 0.007 * sr, depth = 0.0035 * sr, w = (2 * Math.PI * 0.8) / sr;
    for (let i = 0; i < n; i++) {
      const p = i - (base + depth * Math.sin(w * i)), a = Math.floor(p), f = p - a;
      const s0 = a >= 0 && a < n ? x[a] : 0, s1 = a + 1 >= 0 && a + 1 < n ? x[a + 1] : 0;
      y[i] = 0.75 * (s0 * (1 - f) + s1 * f) + 0.25 * x[i];
    }
    return lowpass(lowpass(y, sr, 650, 0.9), sr, 900, 0.7);
  }
  /** Небольшое эхо: задержка 180 мс с затуханием. */
  function echo(x, sr, delaySec = 0.18, fb = 0.33, mix = 0.32) {
    const D = Math.round(delaySec * sr), n = x.length, d = new Float32Array(n), y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = i >= D ? x[i - D] + fb * d[i - D] : 0;
      d[i] = v; y[i] = x[i] + mix * v;
    }
    return y;
  }

  /** Пространство: «комната» и «зал» (ревербератор на гребенчатых и all-pass фильтрах) или эхо с затемнением повторов.
   *  o = { type: 'room'|'hall'|'echo', mix: 0..100, size: 0..100 }. Хвост обрезается по длине дорожки. */
  function space(x, sr, o) {
    const n = x.length, m = clamp((o.mix || 0) / 100, 0, 1), sz = clamp((o.size == null ? 50 : o.size) / 100, 0, 1);
    if (!m || !n) return x;
    const y = new Float32Array(n), wet = new Float32Array(n);
    if (o.type === 'echo') {
      const D = Math.max(1, Math.round((0.1 + 0.45 * sz) * sr)), d = new Float32Array(n), fb = 0.4;
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const src = i >= D ? x[i - D] + fb * d[i - D] : 0;
        lp += 0.55 * (src - lp); d[i] = lp; wet[i] = lp;
      }
      for (let i = 0; i < n; i++) y[i] = x[i] + m * 0.9 * wet[i];
      return y;
    }
    const hall = o.type === 'hall';
    const sc = (sr / 44100) * (hall ? 1.0 + 0.9 * sz : 0.45 + 0.55 * sz);
    const fb = hall ? 0.84 + 0.09 * sz : 0.72 + 0.12 * sz, damp = hall ? 0.22 : 0.38;
    const preD = Math.round((hall ? 0.028 : 0.012) * sr);
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((L) => ({ b: new Float32Array(Math.max(8, Math.round(L * sc))), i: 0, f: 0 }));
    const aps = [556, 441, 341, 225].map((L) => ({ b: new Float32Array(Math.max(8, Math.round(L * sc))), i: 0 }));
    let hpx = 0, hpy = 0;
    const hpA = Math.exp(-2 * Math.PI * 180 / sr);
    for (let i = 0; i < n; i++) {
      const inp = (i >= preD ? x[i - preD] : 0) * 0.03;
      let acc = 0;
      for (const c of combs) {
        const o2 = c.b[c.i];
        c.f = o2 * (1 - damp) + c.f * damp;
        c.b[c.i] = inp + c.f * fb;
        if (++c.i >= c.b.length) c.i = 0;
        acc += o2;
      }
      for (const a of aps) {
        const bo = a.b[a.i], out = bo - acc;
        a.b[a.i] = acc + bo * 0.5;
        if (++a.i >= a.b.length) a.i = 0;
        acc = out;
      }
      const hy = hpA * (hpy + acc - hpx); hpx = acc; hpy = hy; // срез низа в «мокрой» части, чтобы не гудело
      wet[i] = hy;
    }
    // уровень «мокрой» части подгоняем под дорожку, чтобы ползунок «Количество» работал одинаково для любого размера
    let ew = 0, ex = 0;
    for (let i = 0; i < n; i++) { ew += wet[i] * wet[i]; ex += x[i] * x[i]; }
    const g = ew > 1e-12 ? (hall ? 0.8 : 0.7) * Math.sqrt(ex / ew) : 0;
    for (let i = 0; i < n; i++) y[i] = x[i] * (1 - 0.25 * m) + wet[i] * m * g;
    return y;
  }

  /* ---------- шумодав: спектральное вычитание (STFT 512/128), один код для живого микрофона и дорожки ---------- */
  class VxpNRCore {
    constructor(sr) {
      const N = 512, H = 128, B = N / 2 + 1;
      this.N = N; this.H = H; this.B = B; this.sr = sr || 48000;
      this.win = new Float32Array(N);
      for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      this.cs = new Float32Array(N / 2); this.sn = new Float32Array(N / 2);
      for (let i = 0; i < N / 2; i++) { this.cs[i] = Math.cos((2 * Math.PI * i) / N); this.sn[i] = -Math.sin((2 * Math.PI * i) / N); }
      this.rev = new Uint16Array(N);
      for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); this.rev[i] = r; }
      this.re = new Float32Array(N); this.im = new Float32Array(N);
      this.inb = new Float32Array(N); this.w = 0; this.cnt = 0;
      this.acc = new Float32Array(N); this.outb = new Float32Array(H); this.fo = 0;
      this.ps = new Float32Array(B); this.pn = new Float32Array(B); this.pw = new Float32Array(B); this.cm = new Float32Array(B); this.mins = new Float32Array(4 * B); this.nz = new Float32Array(B); this.g = new Float32Array(B).fill(1); this.gs = new Float32Array(B);
      this.pf = new Float32Array(B); this.prof = null; this.lf = 0; this.lc = 0; this.lacc = new Float32Array(B); this.learnDone = false;
      this.frames = 0; this.red = 0; this.setStrength(0.55);
    }
    /** Запомнить шум: усреднить спектр за n кадров (молчание). */
    startLearn(n) { this.lf = Math.max(8, n | 0); this.lc = 0; this.lacc.fill(0); this.learnDone = false; }
    /** Применить сохранённый профиль (power по бинам при частоте srFrom). */
    setProfile(arr, srFrom) {
      if (!arr || !arr.length) { this.prof = null; return; }
      const B = this.B, out = new Float32Array(B), ratio = (srFrom || this.sr) / this.sr;
      for (let k = 0; k < B; k++) {
        const q = Math.min(arr.length - 1, k * ratio), a = Math.floor(q), f = q - a;
        out[k] = arr[a] * (1 - f) + arr[Math.min(arr.length - 1, a + 1)] * f;
      }
      this.prof = out;
    }
    setStrength(s) {
      this.s = Math.max(0, Math.min(1, s));
      this.alpha = 0.9 + 1.6 * this.s;
      this.gmin = Math.pow(10, -(8 + 22 * this.s) / 20);
    }
    fft(re, im, inv) {
      const N = this.N, rev = this.rev;
      if (inv) for (let i = 0; i < N; i++) im[i] = -im[i];
      for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j, b = a + half, wr = this.cs[k], wi = this.sn[k];
            const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          }
        }
      }
      if (inv) for (let i = 0; i < N; i++) im[i] = -im[i];
    }
    frame() {
      const { N, H, B, re, im, win, inb, ps, pn, nz, g, gs } = this;
      for (let i = 0; i < N; i++) { re[i] = inb[(this.w + i) % N] * win[i]; im[i] = 0; }
      this.fft(re, im, false);
      const first = this.frames++ === 0;
      if (this.lf > 0 && this.frames > 12) {
        for (let k = 0; k < B; k++) this.lacc[k] += this.pf[k];
        if (++this.lc >= this.lf) {
          const pr = new Float32Array(B); for (let k = 0; k < B; k++) pr[k] = this.lacc[k] / this.lc;
          this.prof = pr; this.lf = 0; this.learnDone = true;
        }
      }
      let sumG = 0;
      const cm = this.cm;
      if (this.frames % 112 === 0 && !first) { const u = ((this.frames / 112) | 0) % 4; for (let k = 0; k < B; k++) { this.mins[u * B + k] = cm[k]; cm[k] = pn[k]; } }
      const pw = this.pw;
      for (let k = 0; k < B; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
      for (let k = 0; k < B; k++) {
        const p = (pw[k > 1 ? k - 2 : 0] + 2 * pw[k > 0 ? k - 1 : 0] + 3 * pw[k] + 2 * pw[k < B - 1 ? k + 1 : B - 1] + pw[k < B - 2 ? k + 2 : B - 1]) / 9;
        this.pf[k] = p;
        ps[k] = first ? p : 0.6 * ps[k] + 0.4 * p;
        pn[k] = first ? p : 0.93 * pn[k] + 0.07 * p;
        if (first) { cm[k] = pn[k]; for (let u = 0; u < 4; u++) this.mins[u * B + k] = 1e30; }
        else if (pn[k] < cm[k]) cm[k] = pn[k];
        let mn = cm[k];
        for (let u = 0; u < 4; u++) { const v = this.mins[u * B + k]; if (v < mn) mn = v; }
        let al = this.alpha;
        if (this.fixed && this.prof) {
          nz[k] = Math.max(this.prof[k] * 1.3, mn * 1.2);
          const snr = ps[k] / Math.max(1e-12, nz[k]);
          al = this.alpha * (1 - 0.55 * Math.min(1, Math.max(0, (snr - 2) / 14))); // где голос заметно сильнее шума — вычитаем меньше
        } else nz[k] = this.prof ? Math.max(mn * 1.7, this.prof[k] * 1.25) : mn * 1.7;
        const gt = ps[k] > 1e-12 ? Math.sqrt(Math.max(this.gmin * this.gmin, 1 - (al * nz[k]) / ps[k])) : this.gmin;
        g[k] = gt > g[k] ? 0.4 * g[k] + 0.6 * gt : 0.88 * g[k] + 0.12 * gt;
      }
      for (let k = 0; k < B; k++) {
        const a = g[k > 0 ? k - 1 : 0], c = g[k < B - 1 ? k + 1 : B - 1];
        gs[k] = (a + 2 * g[k] + c) * 0.25; sumG += gs[k];
      }
      for (let k = 0; k < B; k++) { re[k] *= gs[k]; im[k] *= gs[k]; if (k > 0 && k < N / 2) { re[N - k] *= gs[k]; im[N - k] *= gs[k]; } }
      this.fft(re, im, true);
      const sc = 0.5 / N, acc = this.acc;
      for (let i = 0; i < N; i++) acc[(this.w + i) % N] += re[i] * win[i] * sc;
      for (let j = 0; j < H; j++) { const p = (this.w + j) % N; this.outb[j] = acc[p]; acc[p] = 0; }
      const mg = Math.max(1e-4, sumG / B);
      this.red = 0.92 * this.red + 0.08 * (-20 * Math.log10(mg));
    }
    /** Обработать блок (любой длины). Задержка = 512 сэмплов. */
    process(x, y) {
      const N = this.N, H = this.H;
      for (let i = 0; i < x.length; i++) {
        y[i] = this.outb[this.fo++];
        this.inb[this.w] = x[i]; this.w = (this.w + 1) % N;
        if (++this.cnt === H) { this.cnt = 0; this.frame(); this.fo = 0; }
      }
    }
  }

  /** Код AudioWorklet шумодава: ядро + процессор (один и тот же алгоритм, что и для дорожки). */
  const NR_WORKLET = VxpNRCore.toString() + `
class VxpNRProc extends AudioWorkletProcessor{constructor(){super();this.c=[];this.s=0.55;this.t=0;this.pr=null;this.port.onmessage=e=>{const d=e.data||{};if(d.s!=null){this.s=d.s;this.c.forEach(c=>c.setStrength(this.s))}if('prof' in d){this.pr=d.prof?{a:Float32Array.from(d.prof),sr:d.sr}:null;this.c.forEach(c=>c.setProfile(this.pr&&this.pr.a,this.pr&&this.pr.sr))}if(d.learn){this.ln=d.learn;this.c.forEach(c=>c.startLearn(d.learn))}}}
process(inp,out){const x=inp[0],y=out[0];if(!x||!x.length)return true;for(let ch=0;ch<y.length;ch++){const src=x[ch]||x[0];if(!this.c[ch]){this.c[ch]=new VxpNRCore(sampleRate);this.c[ch].setStrength(this.s);if(this.pr)this.c[ch].setProfile(this.pr.a,this.pr.sr);if(this.ln)this.c[ch].startLearn(this.ln)}this.c[ch].process(src,y[ch])}if(this.c[0]&&this.c[0].learnDone){this.c[0].learnDone=false;this.ln=0;this.port.postMessage({done:true,prof:Array.from(this.c[0].prof),sr:sampleRate})}if(++this.t%25===0&&this.c[0])this.port.postMessage({r:this.c[0].red});return true}}
registerProcessor('vxp-nr',VxpNRProc);`;
  /** Шумодав дорожки (офлайн): strength 0..1. Задержку ядра (512 сэмплов) компенсируем. */
  /** Оценка шума по всей записи: средний спектр самых тихих кадров (паузы между репликами). */
  function estimateNoise(x, sr) {
    const core = new VxpNRCore(sr), N = core.N, B = core.B, hop = core.H * 3, re = core.re, im = core.im, win = core.win;
    const frames = [];
    for (let i = 0; i + N <= x.length; i += hop) {
      for (let j = 0; j < N; j++) { re[j] = x[i + j] * win[j]; im[j] = 0; }
      core.fft(re, im, false);
      const pw = new Float32Array(B); let e = 0;
      for (let k = 0; k < B; k++) { pw[k] = re[k] * re[k] + im[k] * im[k]; e += pw[k]; }
      frames.push({ e, pw });
    }
    if (frames.length < 24) return null;
    const alive = frames.filter((f) => f.e > 1e-9).sort((a, b) => a.e - b.e);
    if (alive.length < 16) return null;
    const take = alive.slice(0, Math.max(8, Math.floor(alive.length * 0.1)));
    const pr = new Float32Array(B);
    for (const f of take) for (let k = 0; k < B; k++) pr[k] += f.pw[k] / take.length;
    const sm = new Float32Array(B);
    for (let k = 0; k < B; k++) sm[k] = (pr[k > 1 ? k - 2 : 0] + 2 * pr[k > 0 ? k - 1 : 0] + 3 * pr[k] + 2 * pr[k < B - 1 ? k + 1 : B - 1] + pr[k < B - 2 ? k + 2 : B - 1]) / 9;
    return sm;
  }
  function denoiseTrack(x, sr, strength) {
    if (!strength) return x;
    const core = new VxpNRCore(sr), D = core.N, n = x.length;
    core.setStrength(strength);
    if (settings.nrProf && settings.nrProf.p) { core.setProfile(Float32Array.from(settings.nrProf.p), settings.nrProf.sr); core.fixed = true; }
    else { const pr = estimateNoise(x, sr); if (pr) { core.setProfile(pr, sr); core.fixed = true; } }
    const xin = new Float32Array(n + D); xin.set(x);
    const y = new Float32Array(n + D);
    for (let i = 0; i < xin.length; i += core.H) core.process(xin.subarray(i, Math.min(i + core.H, xin.length)), y.subarray(i, Math.min(i + core.H, xin.length)));
    return y.slice(D, D + n);
  }

  /* ---------- ORDAX FX: эквалайзер, компрессор, дэ-эссер, лимитер (офлайн, для дорожки) ---------- */
  /** Коэффициенты бикуада (RBJ): [b0,b1,b2,a1,a2]. type: bell | lowshelf | highshelf | hp | lp | bp */
  function biquadCoefs(type, f, gDb, q, sr) {
    const w0 = (2 * Math.PI * clamp(f, 10, sr * 0.45)) / sr, c = Math.cos(w0), sn = Math.sin(w0);
    const A = Math.pow(10, gDb / 40), al = sn / (2 * Math.max(0.1, q));
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowshelf') {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) - (A - 1) * c + s); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - s);
      a0 = (A + 1) + (A - 1) * c + s; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - s;
    } else if (type === 'highshelf') {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) + (A - 1) * c + s); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - s);
      a0 = (A + 1) - (A - 1) * c + s; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - s;
    } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  function biquadRun(x, k) {
    const y = new Float32Array(x.length), [b0, b1, b2, a1, a2] = k;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  /** АЧХ бикуада в дБ на частоте f. */
  function biquadDb(k, f, sr) {
    const w = (2 * Math.PI * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = k[0] + k[1] * c1 + k[2] * c2, ni = -(k[1] * s1 + k[2] * s2);
    const dr = 1 + k[3] * c1 + k[4] * c2, di = -(k[3] * s1 + k[4] * s2);
    return 10 * Math.log10(Math.max(1e-12, (nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di)));
  }
  const eqBandDb = (b, f, sr) => (b && b.on ? biquadDb(biquadCoefs(b.type, b.f, b.g, b.q, sr), f, sr) : 0);
  function applyEq(x, sr, bands) {
    let y = x;
    for (const b of bands) if (b && b.on) y = biquadRun(y, biquadCoefs(b.type, b.f, b.g, b.q, sr));
    return y;
  }
  const TR_STEP = 256;
  /** Компрессор (feed-forward, мягкое колено). Возвращает { y, gr } — gr в дБ (≤0) по блокам TR_STEP. */
  function compress(x, sr, c) {
    const n = x.length, y = new Float32Array(n), gr = new Float32Array(Math.ceil(n / TR_STEP) + 1);
    const at = Math.exp(-1 / (sr * Math.max(0.05, c.att) / 1000)), rl = Math.exp(-1 / (sr * Math.max(1, c.rel) / 1000));
    const thr = c.thr, ratio = Math.max(1, c.ratio), knee = Math.max(0, c.knee), mk = dbToLin(c.makeup || 0), slope = 1 / ratio - 1;
    let g = 0;
    for (let i = 0; i < n; i++) {
      const a = x[i] < 0 ? -x[i] : x[i], lvl = a > 1e-6 ? 20 * Math.log10(a) : -120, over = lvl - thr;
      let t;
      if (2 * over < -knee) t = 0;
      else if (2 * Math.abs(over) <= knee) t = (slope * (over + knee / 2) * (over + knee / 2)) / (2 * knee);
      else t = slope * over;
      g = t < g ? at * g + (1 - at) * t : rl * g + (1 - rl) * t;
      y[i] = x[i] * dbToLin(g) * mk;
      const bi = (i / TR_STEP) | 0; if (g < gr[bi]) gr[bi] = g;
    }
    return { y, gr };
  }
  /** Дэ-эссер: подавляет полосу вокруг частоты f, когда её уровень выше порога. */
  function deEss(x, sr, d) {
    const n = x.length, y = new Float32Array(n), gr = new Float32Array(Math.ceil(n / TR_STEP) + 1);
    const band = biquadRun(x, biquadCoefs('bp', d.f, 0, 1.2, sr));
    const at = Math.exp(-1 / (sr * 0.0006)), rl = Math.exp(-1 / (sr * 0.03));
    let env = 0, g = 0;
    const maxRed = Math.max(0, d.amt);
    for (let i = 0; i < n; i++) {
      const a = band[i] < 0 ? -band[i] : band[i];
      env = a > env ? at * env + (1 - at) * a : rl * env + (1 - rl) * a;
      const lvl = env > 1e-6 ? 20 * Math.log10(env) : -120, over = lvl - d.thr;
      const t = over > 0 ? -Math.min(maxRed, over * 0.75) : 0;
      g = t < g ? 0.6 * g + 0.4 * t : 0.995 * g + 0.005 * t;
      y[i] = x[i] - band[i] * (1 - dbToLin(g));
      const bi = (i / TR_STEP) | 0; if (g < gr[bi]) gr[bi] = g;
    }
    return { y, gr };
  }
  function slidingMin(a, half) {
    const n = a.length, out = new Float32Array(n), dq = new Int32Array(n);
    let hd = 0, tl = 0, r = 0;
    for (let i = 0; i < n; i++) {
      for (const lim = Math.min(n - 1, i + half); r <= lim; r++) { while (tl > hd && a[dq[tl - 1]] >= a[r]) tl--; dq[tl++] = r; }
      while (dq[hd] < i - half) hd++;
      out[i] = a[dq[hd]];
    }
    return out;
  }
  /** Лимитер с упреждением 2 мс: пик не выше ceil (дБ). gain — входное усиление (дБ). */
  function limiter(x, sr, l) {
    const n = x.length, L = Math.max(8, Math.round(sr * 0.002)), ce = dbToLin(Math.min(0, l.ceil)), ig = dbToLin(l.gain || 0);
    const req = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = Math.abs(x[i] * ig); req[i] = a > ce ? ce / a : 1; }
    const mn = slidingMin(req, L - 1), pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + mn[i];
    const half = L >> 1, y = new Float32Array(n), gr = new Float32Array(Math.ceil(n / TR_STEP) + 1), rel = Math.exp(-1 / (sr * 0.08));
    let g = 1;
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
      const sm = (pre[hi] - pre[lo] + (L - (hi - lo))) / L;      // за краями считаем 1
      const smv = Math.min(1, sm);
      g = Math.min(smv, g + (1 - g) * (1 - rel));
      y[i] = x[i] * ig * g;
      const bi = (i / TR_STEP) | 0, d = 20 * Math.log10(Math.max(1e-6, g)); if (d < gr[bi]) gr[bi] = d;
    }
    return { y, gr };
  }
  /** Спектр (дБFS) окна size сэмплов с позиции start, Hann + FFT. */
  const fftCache = new Map();
  function fftPlan(N) {
    let p = fftCache.get(N);
    if (!p) {
      const rev = new Uint32Array(N), bits = Math.log2(N), cs = new Float32Array(N / 2), sn = new Float32Array(N / 2), win = new Float32Array(N);
      for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); }
      for (let i = 0; i < N / 2; i++) { cs[i] = Math.cos((2 * Math.PI * i) / N); sn[i] = -Math.sin((2 * Math.PI * i) / N); }
      p = { N, rev, cs, sn, win, re: new Float32Array(N), im: new Float32Array(N) };
      fftCache.set(N, p);
    }
    return p;
  }
  /** Добавляет в acc (Float32Array N/2) мощность окна. */
  function spectrumAdd(x, start, N, acc) {
    const { rev, cs, sn, win, re, im } = fftPlan(N);
    for (let i = 0; i < N; i++) { const j = start + i; re[rev[i]] = j >= 0 && j < x.length ? x[j] * win[i] : 0; im[rev[i]] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half, tr_ = re[b] * cs[k] - im[b] * sn[k], ti = re[b] * sn[k] + im[b] * cs[k];
        re[b] = re[a] - tr_; im[b] = im[a] - ti; re[a] += tr_; im[a] += ti;
      }
    }
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  /** Средний спектр дорожки в дБFS (массив N/2), по окнам с шагом N. */
  function avgSpectrum(x, N = 2048) {
    const acc = new Float32Array(N / 2); let cnt = 0;
    const hop = Math.max(N, Math.floor(x.length / 80));
    for (let s = 0; s + N <= x.length; s += hop) {
      let e = 0; for (let i = s; i < s + N; i += 8) e += x[i] * x[i];
      if (e / (N / 8) < 1e-7) continue; // тишину не учитываем
      spectrumAdd(x, s, N, acc); cnt++;
    }
    const out = new Float32Array(N / 2), norm = (N / 4) * (N / 4);
    for (let k = 0; k < N / 2; k++) out[k] = 10 * Math.log10(Math.max(1e-12, cnt ? acc[k] / cnt / norm : 0));
    return out;
  }
  function spectrumAt(x, start, N = 2048) {
    const acc = new Float32Array(N / 2); spectrumAdd(x, start, N, acc);
    const out = new Float32Array(N / 2), norm = (N / 4) * (N / 4);
    for (let k = 0; k < N / 2; k++) out[k] = 10 * Math.log10(Math.max(1e-12, acc[k] / norm));
    return out;
  }
  const chainOn = (p) => !!((p.eq && p.eq.some((b) => b.on)) || (p.comp && p.comp.on) || (p.deess && p.deess.on) || (p.lim && p.lim.on));

  /* ---------- модель дубля (неразрушающая обработка и монтаж) ---------- */
  // model = { base:Float32Array, sr, t0 (сек, где base[0] относительно старта видео),
  //           outLen (сэмплов в окне для игры),
  //           params:{offset, pitch, gain, lowcut, speed, underwater, echo},
  //           segs:[{id, a, b, pos}] — куски base[a..b), стоящие на таймлайне с позиции pos (сек) }
  const FX_KEYS = ['pitch', 'gain', 'lowcut', 'speed', 'underwater', 'echo', 'space', 'denoise', 'eq', 'comp', 'deess', 'lim', 'vox', 'nn', 'room'];
  const defaultParams = () => ({ offset: 0, ...cloneJ(settings.fx) });
  const isDefaultParams = (p) => !p.offset && !p.pitch && !p.gain && !p.lowcut && (p.speed || 1) === 1 && !p.underwater && !p.echo && !(p.space && p.space.mix) && !p.denoise && !(p.vox && p.vox.on) && !(p.room && p.room.on) && !chainOn(p);
  let segSeq = 1;
  const segSig = (m) => JSON.stringify(m.segs.map((s) => [s.a, s.b, +s.pos.toFixed(5), s.fx || 0]));
  function initSegs(m) {
    m.segs = [{ id: segSeq++, a: 0, b: m.base.length, pos: m.t0 }];
    m._segInit = segSig(m);
    m._sc = null; m._r = null;
    return m.segs;
  }
  const ensureSegs = (m) => m.segs || initSegs(m);
  const segsPristine = (m) => !m.segs || segSig(m) === m._segInit;
  const isDefaultModel = (m) => isDefaultParams(m.params) && segsPristine(m);
  const segDur = (m, s) => (s.b - s.a) / m.sr / (m.params.speed || 1);
  /** Звук куска с учётом скорости (темп без изменения высоты). */
  function segAudio(m, s) {
    const sp = m.params.speed || 1, key = s.a + '|' + s.b + '|' + sp;
    if (!m._sc || m._scBase !== m.base) { m._sc = new Map(); m._scBase = m.base; }
    let x = m._sc.get(key);
    if (!x) {
      x = sp === 1 ? m.base.subarray(s.a, s.b) : timeStretch(m.base.slice(s.a, s.b), 1 / sp, Math.max(1, Math.round((s.b - s.a) / sp)), m.sr);
      if (m._sc.size > 80) m._sc.clear();
      m._sc.set(key, x);
    }
    if (!segFxActive(s.fx)) return x;
    const k2 = key + '|fx' + JSON.stringify(s.fx);
    let y = m._sc.get(k2);
    if (!y) { y = applySegFx(x, m.sr, s.fx); if (m._sc.size > 80) m._sc.clear(); m._sc.set(k2, y); }
    return y;
  }
  /** Вырезать из раскладки отрезок [t0, t1) (сек): куски, попавшие под него, подрезаются или делятся. */
  function carveSegs(m, t0, t1) {
    const sr = m.sr, sp = m.params.speed || 1, out = [], minD = 0.01;
    for (const sg of ensureSegs(m)) {
      const st = sg.pos, en = sg.pos + segDur(m, sg);
      if (en <= t0 || st >= t1) { out.push(sg); continue; }
      if (st < t0 - minD) out.push({ ...sg, b: sg.a + Math.round((t0 - st) * sr * sp) });
      if (en > t1 + minD) out.push({ ...sg, id: segSeq++, a: sg.a + Math.round((t1 - st) * sr * sp), pos: t1 });
    }
    return out;
  }
  /* iFix: обработка отдельного куска (громкость, питч, срез низов, шумодав, пространство) */
  const segFxActive = (f) => !!f && !!(f.gain || f.pitch || f.lowcut || f.denoise || (f.space && f.space.mix));
  function applySegFx(x, sr, f) {
    let y = new Float32Array(x);
    if (f.denoise) y = denoiseTrack(y, sr, f.denoise / 100);
    if (f.pitch) y = pitchShift(y, sr, f.pitch);
    if (f.lowcut) y = highpass(y, sr);
    const sp = f.space;
    if (sp && sp.mix) {
      const sz = (sp.size == null ? 50 : sp.size) / 100;
      const tail = sp.type === 'hall' ? 1.8 : sp.type === 'echo' ? (0.1 + 0.45 * sz) * 3.5 : 0.9;
      const pad = new Float32Array(y.length + Math.round(tail * sr)); pad.set(y);
      y = space(pad, sr, sp);
    }
    if (f.gain) { const g = dbToLin(f.gain); for (let i = 0; i < y.length; i++) y[i] *= g; }
    return y;
  }
  /** Собрать куски на таймлайн в окно [fromSec, fromSec + len/sr). Края кусков — короткие фейды без щелчков. */
  function assemble(m, fromSec, len, withOffset = true) {
    const out = new Float32Array(len), off = withOffset ? m.params.offset / 1000 : 0, sr = m.sr;
    for (const s of ensureSegs(m)) {
      const x = segAudio(m, s), L = x.length, start = Math.round((s.pos + off - fromSec) * sr);
      const fade = Math.min(Math.round(0.004 * sr), L >> 1);
      const i0 = Math.max(0, -start), i1 = Math.min(L, len - start);
      for (let i = i0; i < i1; i++) {
        let g = 1;
        if (i < fade) g = i / fade; else if (i > L - fade) g = (L - i) / fade;
        out[start + i] += x[i] * g;
      }
    }
    return out;
  }
  /** Шумодав дорожки: нейросеть (модуль vxp-denoise.js), если выбрана и готова; иначе обычный. */
  const nnReady = (n) => !!(n && VXP.nn && VXP.nn.ok && VXP.nn.ok(n));
  function denoiseAny(x, sr, strength, nn) {
    if (nnReady(nn)) { try { return VXP.nn.denoise(x, sr, strength, nn); } catch (e) { console.warn('[Voxalike+OrdaxEd] нейросеть', e); } }
    return denoiseTrack(x, sr, strength);
  }
  function renderModel(m) {
    const p = m.params, key = segSig({ segs: ensureSegs(m) }) + JSON.stringify(p) + (p.denoise ? JSON.stringify((settings.nrProf || {}).p ? settings.nrProf.p[3] : 0) + (nnReady(p.nn) ? 'N' : '') : '') + m.outLen + '|' + m.base.length;
    if (m._rk === key && m._r) return m._r;
    let x = assemble(m, 0, m.outLen);
    if (p.room && p.room.on && VXP.roomfx) { try { x = VXP.roomfx.process(x, m.sr, p.room); } catch (e) { console.warn('[Voxalike+OrdaxEd] дереверб', e); } }
    if (p.denoise) x = denoiseAny(x, m.sr, p.denoise / 100, p.nn);
    if (p.pitch) x = pitchShift(x, m.sr, p.pitch);
    if (p.lowcut) x = highpass(x, m.sr);
    if (p.vox && p.vox.on && VXP.voxfx) { try { x = VXP.voxfx.process(x, m.sr, p.vox); } catch (e) { console.warn('[Voxalike+OrdaxEd] эффектор', e); } }
    const trc = {};
    if (p.eq && p.eq.some((b) => b.on)) x = applyEq(x, m.sr, p.eq);
    if (p.deess && p.deess.on) { const r = deEss(x, m.sr, p.deess); x = r.y; trc.deess = r.gr; }
    if (p.comp && p.comp.on) { const r = compress(x, m.sr, p.comp); x = r.y; trc.comp = r.gr; }
    if (p.underwater) x = underwater(x, m.sr);
    if (p.echo) x = echo(x, m.sr);
    if (p.space && p.space.mix) x = space(x, m.sr, p.space);
    if (p.gain) { const g = dbToLin(p.gain); for (let i = 0; i < x.length; i++) x[i] *= g; }
    if (p.lim && p.lim.on) { const r = limiter(x, m.sr, p.lim); x = r.y; trc.lim = r.gr; }
    const pk = peakOf(x);
    if (pk > 0.98) { const k = 0.98 / pk; for (let i = 0; i < x.length; i++) x[i] *= k; }
    m._rk = key; m._r = x; m._tr = trc;
    return x;
  }
  /** Сдвиг (мс), при котором собранная дорожка лучше всего совпадает с оригиналом. */
  function alignOffset(m, ref) {
    let lo = Infinity, hi = -Infinity;
    for (const s of ensureSegs(m)) { lo = Math.min(lo, s.pos); hi = Math.max(hi, s.pos + segDur(m, s)); }
    if (!isFinite(lo)) return m.params.offset;
    const wide = assemble(m, lo, Math.max(1, Math.round((hi - lo) * m.sr)), false);
    return autoAlign(ref.samples, ref.sr, wide, m.sr, lo);
  }
  VXP.dsp = { applyEq, compress, deEss, limiter, avgSpectrum, spectrumAt, biquadCoefs, biquadDb, denoiseTrack, VxpNRCore, pitchShift, timeStretch, highpass, lowpass, underwater, echo, space, renderModel, assemble, autoAlign, alignOffset, locate, initSegs, segsPristine, isDefaultModel };

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
    const nrLoaded = new WeakMap();
    const loadNR = (ctx) => {
      if (!nrLoaded.has(ctx)) {
        const url = URL.createObjectURL(new Blob([NR_WORKLET], { type: 'text/javascript' }));
        nrLoaded.set(ctx, ctx.audioWorklet.addModule(url).finally(() => setTimeout(() => URL.revokeObjectURL(url), 5000)));
      }
      return nrLoaded.get(ctx);
    };
    /** Шумодав между микрофоном и усилителем: включается/выключается на лету. */
    function applyNR(node) {
      if (node.dead) return;
      if (settings.nr && !node.nrNode && !node.nrPending) {
        if (!node.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return;
        node.nrPending = true;
        loadNR(node.ctx).then(() => {
          node.nrPending = false;
          if (node.dead || !settings.nr || node.nrNode) return;
          const nn = new AudioWorkletNode(node.ctx, 'vxp-nr', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
          nn.port.onmessage = (e) => { if (e.data && e.data.r != null) node.nrRed = e.data.r; };
          nn.port.postMessage({ s: settings.nrStrength / 100 });
          if (settings.nrProf) nn.port.postMessage({ prof: settings.nrProf.p, sr: settings.nrProf.sr });
          origConnect.call(node.src, nn); origConnect.call(nn, node.gain); origDisconnect.call(node.src, node.gain);
          node.nrNode = nn;
        }).catch((e) => { node.nrPending = false; console.warn('[Voxalike+OrdaxEd] noise suppressor', e); });
      } else if (!settings.nr && node.nrNode) {
        const nn = node.nrNode; node.nrNode = null; node.nrRed = 0;
        try { origConnect.call(node.src, node.gain); } catch {}
        try { origDisconnect.call(node.src, nn); } catch {}
        try { nn.disconnect(); } catch {}
      }
    }
    audioHook.applyNR = () => audioHook.nodes.forEach(applyNR);
    audioHook.setProf = () => audioHook.nodes.forEach((n) => { if (n.nrNode) n.nrNode.port.postMessage(settings.nrProf ? { prof: settings.nrProf.p, sr: settings.nrProf.sr } : { prof: null }); });
    /** Отдельная короткая запись тишины для профиля шума (не зависит от игры). */
    audioHook.learn = async (secs = 2.5) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AC();
      try {
        await ctx.resume(); await loadNR(ctx);
        const src = orig.call(ctx, stream);
        const nn = new AudioWorkletNode(ctx, 'vxp-nr', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
        const zero = ctx.createGain(); zero.gain.value = 0;
        origConnect.call(src, nn); origConnect.call(nn, zero); origConnect.call(zero, ctx.destination);
        const frames = Math.round((secs * ctx.sampleRate) / 128);
        return await new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error('timeout')), (secs + 5) * 1000);
          nn.port.onmessage = (e) => { if (e.data && e.data.done) { clearTimeout(to); res(e.data); } };
          nn.port.postMessage({ s: 0, learn: frames });
        });
      } finally {
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        try { ctx.close(); } catch {}
      }
    };
    audioHook.setNR = () => audioHook.nodes.forEach((n) => { if (n.nrNode) n.nrNode.port.postMessage({ s: settings.nrStrength / 100 }); });
    AC.prototype.createMediaStreamSource = function (stream) {
      const src = orig.call(this, stream);
      try {
        const ctx = this, gain = ctx.createGain();
        gain.gain.value = dbToLin(settings.gainDb);
        origConnect.call(src, gain);
        const node = { ctx, src, gain, monitor: null, recording: false, analyser: null, nrNode: null, nrPending: false, nrRed: 0, dead: false };
        audioHook.nodes.add(node); audioHook.last = node;
        applyNR(node);
        src.connect = function (dest, ...rest) {
          if (typeof AudioWorkletNode !== 'undefined' && dest instanceof AudioWorkletNode && !node.recording) {
            node.recording = true; updateMonitor(node);
            if (!src.__vxpOwn) { try { nativeRec.onStart(stream); } catch (e) { console.warn('[Voxalike+OrdaxEd]', e); } }
          }
          return gain.connect(dest, ...rest);
        };
        src.disconnect = function (...args) {
          if (!args.length) {
            const was = node.recording;
            node.recording = false; updateMonitor(node);
            node.dead = true;
            if (node.nrNode) { try { node.nrNode.disconnect(); } catch {} node.nrNode = null; }
            try { origDisconnect.call(gain); } catch {}
            audioHook.nodes.delete(node);
            if (audioHook.last === node) audioHook.last = null;
            if (was && !src.__vxpOwn) { try { nativeRec.onStop(); } catch (e) { console.warn('[Voxalike+OrdaxEd]', e); } }
            return origDisconnect.call(src);
          }
          return gain.disconnect(...args);
        };
      } catch (e) { console.warn('[Voxalike+OrdaxEd] mic hook', e); }
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
        if (c && c.audio) {
          const a = typeof c.audio === 'object' ? { ...c.audio } : {};
          if (settings.rawMic) Object.assign(a, rawConstraints(true));
          else a.autoGainControl = false; // автоусиление браузера выравнивает громкость сам: крик тише, тихое громче
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
    nodes: [], els: [], t0: 0, dur: 0, playing: false, raf: 0, onTick: null, onEnd: null, args: null, startAt: 0,
    stop() {
      this.nodes.forEach((n) => { try { n.stop(); } catch {} try { n.disconnect(); } catch {} });
      this.els.forEach((e) => { try { e.pause(); } catch {} });
      this.nodes = []; this.els = [];
      caf(this.raf);
      const was = this.playing; this.playing = false; this.args = null;
      const end = this.onEnd; this.onTick = this.onEnd = null;
      if (was && end) end();
    },
    async play(args) {
      const { tracks = [], media = [], dur, onTick, onEnd, startAt = 0 } = args;
      this.stop(); this.args = args; this.startAt = startAt;
      const ctx = getCtx(); await ctx.resume();
      for (const m of media) { try { m.el.currentTime = (m.from || 0) + startAt; m.el.muted = !!m.muted; if (m.vol != null) m.el.volume = m.vol; } catch {} }
      const at = ctx.currentTime + 0.12;
      for (const t of tracks) {
        if (!t || !t.samples) continue;
        const src = ctx.createBufferSource(); src.buffer = makeBuffer(t.samples, t.sr);
        const g = ctx.createGain(); g.gain.value = t.gain ?? 1;
        src.connect(g).connect(ctx.destination);
        const ts = t.startSec - startAt;
        if (ts >= 0) src.start(at + ts); else src.start(at, -ts);
        this.nodes.push(src);
      }
      setTimeout(() => { media.forEach((m) => { this.els.push(m.el); m.el.play().catch(() => {}); }); }, 120);
      this.t0 = performance.now() + 120; this.dur = dur; this.playing = true; this.onTick = onTick; this.onEnd = onEnd;
      const loop = () => {
        const t = (performance.now() - this.t0) / 1000 + startAt;
        if (this.onTick) this.onTick(Math.max(startAt, t));
        if (t >= this.dur) {
          if (settings.loopPlay && this.args === args) { this.onEnd = null; this.stop(); this.play(args); return; } // зацикливание: играем заново с той же точки
          return this.stop();
        }
        this.raf = raf(loop);
      };
      this.raf = raf(loop);
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
    /** onChange(kind) — модель изменена (kind: move | offset | cut | delete | undo | reset | auto) */
    constructor({ onChange, onPlay }) {
      this.ref = null; this.model = null; this.live = null; this.playhead = null; this.marker = null; this.onMarker = null;
      this.sel = new Set(); this.tool = 'move'; this.hist = []; this.hoverT = null;
      this.onChange = onChange; this.onPlay = onPlay;
      this.canvas = h('canvas', { class: 'vxp-tracks', tabindex: '0', title: tr('Клик — выбрать кусок, тянуть — двигать. Ножницы — разрезать. Delete — удалить, Ctrl+Z — отменить', 'Click — select a piece, drag — move. Scissors — cut. Delete — remove, Ctrl+Z — undo') });
      this.label = h('span', { class: 'vxp-offset' }, fmtMs(0));
      const B = (txt, title, fn, cls = 'icon') => h('button', { class: 'vxp-btn ' + cls, type: 'button', title, onclick: fn }, txt);
      this.btnMove = B('↔', tr('Выбор и перемещение кусков (V). Shift+клик — выбрать несколько', 'Select and move pieces (V). Shift+click — select several'), () => this.setTool('move'));
      this.btnCut = B('✂', tr('Ножницы: клик по своей дорожке — разрезать (S)', 'Scissors: click your track to cut (S)'), () => this.setTool('cut'));
      this.btnDel = B('🗑', tr('Удалить выбранные куски (Delete)', 'Delete selected pieces (Delete)'), () => this.deleteSel());
      this.btnUndo = B('↶', tr('Отменить (Ctrl+Z)', 'Undo (Ctrl+Z)'), () => this.undo());
      this.btnReset = B('⟲', tr('Сбросить монтаж и сдвиг', 'Reset edits and shift'), () => this.resetEdit());
      this.btnFix = B('iFix', tr('Обработка выбранного куска: реверберация, громкость, питч и другое', 'Processing for the selected piece: reverb, volume, pitch and more'), () => this.toggleFix(), 'primary');
      this.btnFix.style.display = 'none'; this.fixOpen = false; this.fixBox = null;
      this.btnPlay = B(tr('▶ Вместе', '▶ Together'), tr('Оригинал + моя запись вместе', 'Original + my take together'), () => this.onPlay && this.onPlay(), '');
      this.playOpts = h('div', { class: 'vxp-row vxp-playopts' },
        checkbox({ label: tr('Зацикливание', 'Loop'), get: () => settings.loopPlay, set: (v) => { settings.loopPlay = v; saveSettings(); }, title: tr('По окончании отрезка проигрывать заново', 'Start playing again when the section ends') }),
        checkbox({ label: tr('Играть с метки', 'Play from marker'), get: () => settings.playFromMarker, set: (v) => { settings.playFromMarker = v; saveSettings(); }, title: tr('Все кнопки воспроизведения начинают с метки (метка — клик по линейке времени над дорожкой)', 'All play buttons start at the marker (set it by clicking the time ruler above the track)') }));
      this.toolbar = h('div', { class: 'vxp-editbar' },
        h('div', { class: 'vxp-row vxp-tools' }, this.btnMove, this.btnCut, this.btnDel, this.btnUndo, this.btnReset, this.btnFix),
        h('div', { class: 'vxp-row vxp-tools' },
          B('◀', tr('Сдвинуть влево (−10 мс, Shift −50). Если выбраны куски — только их', 'Shift left (−10 ms, Shift −50). With pieces selected — only them'), (e) => this.nudge(e.shiftKey ? -50 : -10)),
          this.label,
          B('▶', tr('Сдвинуть вправо (+10 мс, Shift +50). Если выбраны куски — только их', 'Shift right (+10 ms, Shift +50). With pieces selected — only them'), (e) => this.nudge(e.shiftKey ? 50 : 10)),
          B(tr('Авто', 'Auto'), tr('Автоподгонка к оригиналу', 'Auto-align to the original'), () => this.auto(), ''),
          this.btnPlay),
        this.playOpts);
      this.root = h('div', { class: 'vxp-editor' }, this.canvas, this.toolbar);
      this.bindPointer();
      this.canvas.addEventListener('keydown', (e) => { if (this.handleKey(e)) { e.preventDefault(); e.stopPropagation(); } });
      new ResizeObserver(() => this.draw()).observe(this.canvas);
      this._rafPending = false;
      this.updateUi();
    }
    set(ref, model) {
      this.ref = ref;
      if (model !== this.model) { this.sel.clear(); this.hist = []; this.marker = null; }
      this.model = model;
      if (model) ensureSegs(model);
      this.updateUi(); this.draw();
    }
    setLive(live) { this.live = live; this.requestDraw(); }
    requestDraw() { if (this._rafPending) return; this._rafPending = true; raf(() => { this._rafPending = false; this.draw(); }); }
    setPlaying(p) { this.btnPlay.textContent = p ? tr('■ Стоп', '■ Stop') : tr('▶ Вместе', '▶ Together'); }
    /** Откуда играть: с метки, если включён тумблер 📍 и метка стоит; иначе с начала. */
    playStart() { return settings.playFromMarker && this.marker != null && this.model ? Math.max(0, this.marker) : 0; }
    get offset() { return this.model ? this.model.params.offset : 0; }
    setTool(t) { this.tool = t; this.hoverT = null; this.updateUi(); this.draw(); }
    updateUi() {
      const m = this.model;
      this.btnMove.classList.toggle('active', this.tool === 'move');
      this.btnCut.classList.toggle('active', this.tool === 'cut');
      this.canvas.classList.toggle('cut', this.tool === 'cut');
      this.btnDel.disabled = !this.sel.size;
      this.btnUndo.disabled = !this.hist.length;
      this.btnReset.disabled = !m || isDefaultModelEdit(m);
      this.btnFix.style.display = this.sel.size ? '' : 'none';
      this.btnFix.classList.toggle('active', this.fixOpen && !!this.sel.size);
      if (this.fixBox) { const show = this.fixOpen && !!this.sel.size && !!m; this.fixBox.style.display = show ? '' : 'none'; if (show) { this.fixTitle.textContent = 'iFix · ' + this.sel.size + ' ' + tr('кус.', 'pcs'); syncWidgets(); } }
      this.label.textContent = this.sel.size ? this.sel.size + ' ' + tr('выбр.', 'sel.') : fmtMs(this.offset);
    }
    fxOf() {
      const m = this.model, sg = m && m.segs.find((x) => this.sel.has(x.id)), f = (sg && sg.fx) || {};
      return { gain: f.gain || 0, pitch: f.pitch || 0, lowcut: !!f.lowcut, denoise: f.denoise || 0, space: Object.assign({ type: 'room', mix: 0, size: 50 }, f.space) };
    }
    setFx(patch, done) {
      const m = this.model; if (!m || !this.sel.size) return;
      if (!this._fxg) { this.pushHist(); this._fxg = true; }
      const cur = this.fxOf(), nf = Object.assign({}, cur, patch);
      if (patch.space) nf.space = Object.assign({}, cur.space, patch.space);
      const act = segFxActive(nf);
      for (const sg of m.segs) if (this.sel.has(sg.id)) sg.fx = act ? nf : undefined;
      if (done) { this._fxg = false; this.commit('ifix'); } else this.requestDraw();
    }
    toggleFix() {
      this.fixOpen = !this.fixOpen;
      if (this.fixOpen && !this.fixBox) this.buildFix();
      this.updateUi();
    }
    playSel() {
      const m = this.model; if (!m || !this.sel.size) return;
      if (player.playing) { player.stop(); return; }
      const segs = m.segs.filter((x) => this.sel.has(x.id));
      const out = renderModel(Object.assign({}, m, { segs, _rk: null, _r: null }));
      const first = Math.min(...segs.map((x) => x.pos + m.params.offset / 1000)); // играем с начала куска
      const from = Math.max(0, Math.floor((first - 0.05) * m.sr)), ed = this;
      player.play({ tracks: [{ samples: out.subarray(from), sr: m.sr, startSec: 0, gain: 1 }], dur: (out.length - from) / m.sr + 0.1,
        onTick: (t) => { ed.playhead = t + from / m.sr; ed.draw(); }, onEnd: () => { ed.playhead = null; ed.draw(); } });
    }
    buildFix() {
      const f = () => this.fxOf();
      const typeBtns = [['room', tr('Комната', 'Room')], ['hall', tr('Зал', 'Hall')], ['echo', tr('Эхо', 'Echo')]].map(([t, l]) =>
        h('button', { class: 'vxp-btn small', type: 'button', 'data-t': t, onclick: () => { const sp = f().space; this.setFx({ space: { type: t, mix: sp.mix || 25 } }, true); } }, l));
      const typeRow = h('div', { class: 'vxp-row' }, ...typeBtns);
      typeRow._sync = () => { const sp = f().space; typeBtns.forEach((b) => b.classList.toggle('primary', b.dataset.t === sp.type && !!sp.mix)); };
      widgets.add(typeRow);
      this.fixTitle = h('b', null, 'iFix');
      this.fixBox = h('div', { class: 'vxp-ifix', style: 'display:none' },
        h('div', { class: 'vxp-row', style: 'justify-content:space-between;align-items:center' }, this.fixTitle,
          h('div', { class: 'vxp-row' },
            h('button', { class: 'vxp-btn small', type: 'button', title: tr('Прослушать только выбранные куски', 'Listen to the selected pieces only'), onclick: () => this.playSel() }, tr('▶ Кусок', '▶ Piece')),
            h('button', { class: 'vxp-btn small', type: 'button', onclick: () => { this.setFx({ gain: 0, pitch: 0, lowcut: false, denoise: 0, space: { mix: 0 } }, true); } }, tr('Сбросить', 'Reset')),
            h('button', { class: 'vxp-btn icon small', type: 'button', onclick: () => { this.fixOpen = false; this.updateUi(); } }, '✕'))),
        slider({ label: tr('🔊 Громкость', '🔊 Volume'), min: -18, max: 12, step: 0.5, get: () => f().gain, set: (v, d) => this.setFx({ gain: v }, d), fmt: (v) => (v ? (v > 0 ? '+' : '−') + Math.abs(v) + ' ' + tr('дБ', 'dB') : '0 ' + tr('дБ', 'dB')) }),
        slider({ label: tr('🎚 Питч', '🎚 Pitch'), min: -12, max: 12, step: 1, get: () => f().pitch, set: (v, d) => this.setFx({ pitch: v }, d), fmt: (v) => (v ? (v > 0 ? '+' : '−') + Math.abs(v) : '0') }),
        slider({ label: tr('🧹 Шумодав', '🧹 Denoise'), min: 0, max: 100, step: 5, get: () => f().denoise, set: (v, d) => this.setFx({ denoise: v }, d), fmt: (v) => (v ? v + '%' : tr('выкл', 'off')) }),
        checkbox({ label: tr('Срез низов', 'Low cut'), get: () => f().lowcut, set: (v) => this.setFx({ lowcut: v }, true), title: tr('Убирает гул и стук (90 Гц)', 'Removes rumble and thumps (90 Hz)') }),
        h('div', { class: 'vxp-title', style: 'cursor:default' }, h('span', null, tr('Пространство', 'Space'))),
        typeRow,
        slider({ label: tr('🌌 Количество', '🌌 Amount'), min: 0, max: 100, step: 1, get: () => f().space.mix, set: (v, d) => this.setFx({ space: { mix: v } }, d), fmt: (v) => (v ? v + '%' : tr('выкл', 'off')) }),
        slider({ label: tr('📐 Размер', '📐 Size'), min: 0, max: 100, step: 1, def: 50, get: () => f().space.size, set: (v, d) => this.setFx({ space: { size: v } }, d), fmt: (v) => v + '%' }),
        h('div', { class: 'vxp-hint' }, tr('Действует только на выбранные куски. Хвост реверберации виден на дорожке.', 'Applies to the selected pieces only. The reverb tail is shown on the track.')));
      this.root.append(this.fixBox);
    }
    snapshot() { const m = this.model; return { segs: m.segs.map((s) => ({ ...s })), offset: m.params.offset }; }
    pushHist() { if (!this.model) return; this.hist.push(this.snapshot()); if (this.hist.length > 60) this.hist.shift(); }
    commit(kind) { this.updateUi(); this.draw(); if (this.onChange) this.onChange(kind); }
    undo() {
      const s = this.hist.pop(); if (!s || !this.model) return;
      this.model.segs = s.segs; this.model.params.offset = s.offset;
      const ids = new Set(s.segs.map((x) => x.id)); for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id);
      this.commit('undo');
    }
    nudge(d) {
      const m = this.model; if (!m) return;
      this.pushHist();
      if (this.sel.size) for (const s of m.segs) { if (this.sel.has(s.id)) s.pos += d / 1000; }
      else m.params.offset = clamp(Math.round(m.params.offset + d), -9000, 9000);
      this.commit('offset');
    }
    setOffset(ms) { if (!this.model) return; this.pushHist(); this.model.params.offset = clamp(Math.round(ms), -9000, 9000); this.commit('offset'); }
    auto() {
      if (!this.ref || !this.model) return toast(tr('Нет записи для подгонки', 'No recording to align'));
      this.pushHist();
      const ms = Math.round(alignOffset(this.model, this.ref));
      this.model.params.offset = clamp(ms, -9000, 9000);
      this.commit('auto');
      toast(tr('Автоподгонка: ', 'Auto-align: ') + fmtMs(ms));
    }
    deleteSel() {
      const m = this.model;
      if (!m || !this.sel.size) return toast(tr('Сначала выберите кусок: клик по нему', 'Select a piece first: click it'));
      if (this.sel.size >= m.segs.length) return toast(tr('Нельзя удалить всю запись — оставьте хотя бы один кусок', 'You can\'t delete the whole take — keep at least one piece'));
      this.pushHist();
      m.segs = m.segs.filter((s) => !this.sel.has(s.id));
      this.sel.clear();
      this.commit('delete');
    }
    resetEdit() {
      const m = this.model; if (!m) return;
      this.pushHist();
      initSegs(m); m.params.offset = 0; this.sel.clear();
      this.commit('reset');
    }
    selectAll() { if (!this.model) return; this.model.segs.forEach((s) => this.sel.add(s.id)); this.updateUi(); this.draw(); }
    /** Разрезать кусок в точке t (сек таймлайна, с учётом сдвига). */
    split(t) {
      const m = this.model; if (!m) return false;
      const seg = this.segAt(t); if (!seg) return false;
      const off = m.params.offset / 1000, start = seg.pos + off, sp = m.params.speed || 1;
      if (t - start < 0.02 || start + segDur(m, seg) - t < 0.02) return false;
      const k = seg.a + Math.round((t - start) * m.sr * sp);
      this.pushHist();
      const right = { id: segSeq++, a: k, b: seg.b, pos: seg.pos + (k - seg.a) / m.sr / sp };
      if (seg.fx) right.fx = seg.fx;
      seg.b = k;
      m.segs.splice(m.segs.indexOf(seg) + 1, 0, right);
      this.commit('cut');
      return true;
    }
    segAt(t) {
      const m = this.model; if (!m) return null;
      const off = m.params.offset / 1000;
      for (let i = m.segs.length - 1; i >= 0; i--) { const s = m.segs[i], a = s.pos + off; if (t >= a && t <= a + segDur(m, s)) return s; }
      return null;
    }
    handleKey(e) {
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if ((k === 'Delete' || k === 'Backspace') && this.sel.size) { this.deleteSel(); return true; }
      if (ctrl && (k === 'z' || k === 'Z' || k === 'я' || k === 'Я')) { this.undo(); return true; }
      if (ctrl && (k === 'a' || k === 'A' || k === 'ф' || k === 'Ф')) { this.selectAll(); return true; }
      if (!ctrl && 'sSыЫ'.includes(k)) { this.setTool(this.tool === 'cut' ? 'move' : 'cut'); return true; }
      if (!ctrl && 'vVмМ'.includes(k)) { this.setTool('move'); return true; }
      if (k === 'Escape' && (this.sel.size || this.tool !== 'move')) { this.sel.clear(); this.setTool('move'); return true; }
      return false;
    }
    view() {
      const rd = this.ref ? this.ref.samples.length / this.ref.sr : 0;
      let start = -0.3, end = Math.max(rd, 1) + 0.3;
      const ext = (lo, hi, winEnd) => {
        start = Math.min(start, Math.max(-4, lo - 0.1));
        end = Math.max(end, (winEnd || 0) + 0.3, Math.min(hi + 0.1, 14));
      };
      if (this.live) ext(this.live.t0, this.live.t0 + this.live.len / this.live.sr, this.live.winEnd);
      else if (this.model && this.model.segs && this.model.segs.length) {
        const m = this.model, off = m.params.offset / 1000;
        let lo = Infinity, hi = -Infinity;
        for (const s of m.segs) { lo = Math.min(lo, s.pos + off); hi = Math.max(hi, s.pos + off + segDur(m, s)); }
        ext(lo, hi, m.outLen / m.sr);
      }
      return { start, end };
    }
    tAt(e, v) { const r = this.canvas.getBoundingClientRect(); return v.start + ((e.clientX - r.left) / r.width) * (v.end - v.start); }
    bindPointer() {
      let drag = null;
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        try { c.focus({ preventScroll: true }); } catch {}
        if (this.live || !this.model) return;
        const v = this.view(), t = this.tAt(e, v);
        
        // Если клик по верхней панели (линейке) — двигаем метку
        if (e.clientY - c.getBoundingClientRect().top <= 18) {
          this.marker = Math.max(0, t);
          drag = { kind: 'marker', v, x: e.clientX, moved: false };
          c.setPointerCapture(e.pointerId);
          this.draw(); this.onMarker && this.onMarker();
          return;
        }

        if (this.tool === 'cut') { if (!this.split(t)) toast(tr('Режьте внутри своей дорожки', 'Cut inside your own track')); return; }
        const seg = this.segAt(t);
        if (!seg) {
          if (!e.shiftKey) this.sel.clear();
          drag = { kind: 'offset', x: e.clientX, o: this.model.params.offset, v, moved: false };
        } else {
          if (e.shiftKey) { if (this.sel.has(seg.id)) this.sel.delete(seg.id); else this.sel.add(seg.id); }
          else if (!this.sel.has(seg.id)) { this.sel.clear(); this.sel.add(seg.id); }
          const orig = new Map(this.model.segs.filter((s) => this.sel.has(s.id)).map((s) => [s.id, s.pos]));
          drag = { kind: 'segs', x: e.clientX, orig, v, moved: false };
        }
        c.setPointerCapture(e.pointerId);
        c.classList.add('dragging');
        this.updateUi(); this.draw();
      });
      c.addEventListener('pointermove', (e) => {
        if (!drag) {
          if (this.tool === 'cut' && this.model && !this.live) { this.hoverT = this.tAt(e, this.view()); this.requestDraw(); }
          return;
        }
        if (drag.kind === 'marker') {
          this.marker = Math.max(0, this.tAt(e, drag.v));
          drag.moved = true;
          this.draw(drag.v);
          return;
        }
        const r = c.getBoundingClientRect();
        let dt = ((e.clientX - drag.x) / r.width) * (drag.v.end - drag.v.start);
        if (!e.altKey) dt = Math.round(dt * 200) / 200; // шаг 5 мс
        if (!drag.moved && Math.abs(e.clientX - drag.x) < 2) return;
        if (!drag.moved) { this.pushHist(); drag.moved = true; }
        if (drag.kind === 'segs') { for (const s of this.model.segs) if (drag.orig.has(s.id)) s.pos = drag.orig.get(s.id) + dt; }
        else this.model.params.offset = clamp(Math.round(drag.o + dt * 1000), -9000, 9000);
        this.updateUi();
        this.draw(drag.v);
      });
      const end = () => {
        if (!drag) return;
        const d = drag; drag = null;
        c.classList.remove('dragging');
        if (d.kind === 'marker') {
          this.draw();
          this.onMarker && this.onMarker();
        } else if (d.moved) {
          this.commit(d.kind === 'segs' ? 'move' : 'offset');
        } else {
          this.updateUi(); this.draw();
        }
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('pointerleave', () => { if (this.hoverT != null) { this.hoverT = null; this.requestDraw(); } });
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
        if (Math.abs(t - Math.round(t)) < 1e-6) g.fillText(Math.round(t) + tr('с', 's'), X + 2, 9);
      }
      g.fillStyle = 'rgba(' + THEME.rgb + ',.5)'; g.fillRect(Math.round(x(0)), ruler, 1, H - ruler);
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
      g.fillStyle = 'rgba(154,166,184,.06)'; g.fillRect(0, y1, W, laneH);
      if (this.ref) wave(y1, this.ref.samples, this.ref.samples.length, this.ref.sr, 0, '#9aa6b8');
      else { g.fillStyle = 'rgba(247,247,255,.28)'; g.font = '700 10px Nunito Variable, system-ui, sans-serif'; g.fillText(tr('Нет оригинала', 'No original'), 8, y1 + laneH / 2 + 3); }
      tag(y1, tr('ОРИГИНАЛ', 'ORIGINAL'), '#9aa6b8');
      // дорожка 2 — моя
      const y2 = ruler + 4 + laneH;
      g.fillStyle = 'rgba(' + THEME.mineRGB + ',.07)'; g.fillRect(0, y2, W, laneH);
      let winEnd = null;
      const m = this.model;
      if (this.live) {
        wave(y2, this.live.buf, this.live.len, this.live.sr, this.live.t0, '#ff4d5e');
        winEnd = this.live.winEnd;
        const xe = x(this.live.t0 + this.live.len / this.live.sr);
        g.fillStyle = '#ff4d5e'; g.fillRect(Math.round(xe), y2, 2, laneH);
        tag(y2, tr('● ЗАПИСЬ', '● REC'), '#ff4d5e');
      } else if (m && m.segs && m.segs.length) {
        const off = m.params.offset / 1000, multi = m.segs.length > 1;
        for (const s of m.segs) {
          const a = segAudio(m, s), selected = this.sel.has(s.id), p0 = s.pos + off;
          const xa = x(p0), xb = x(p0 + a.length / m.sr);
          g.fillStyle = selected ? 'rgba(' + THEME.mineRGB + ',.2)' : multi ? 'rgba(' + THEME.mineRGB + ',.08)' : 'rgba(' + THEME.mineRGB + ',0)';
          g.fillRect(xa, y2 + 1, xb - xa, laneH - 2);
          wave(y2, a, a.length, m.sr, p0, selected ? THEME.sel : THEME.mine);
          g.strokeStyle = selected ? THEME.sel : 'rgba(' + THEME.mineRGB + ',.75)'; g.lineWidth = selected ? 2 : 1;
          g.strokeRect(Math.round(xa) + 0.5, y2 + 0.5, Math.max(1, Math.round(xb - xa) - 1), laneH - 1);
        }
        winEnd = m.outLen / m.sr;
        tag(y2, tr('МОЯ', 'MINE') + (m.segs.length > 1 ? ' · ' + m.segs.length + ' ' + tr('кус.', 'pcs') : '') + (m.params.offset ? ' ' + fmtMs(m.params.offset) : ''), THEME.mine);
      } else {
        g.fillStyle = 'rgba(247,247,255,.28)'; g.font = '700 10px Nunito Variable, system-ui, sans-serif'; g.fillText(tr('Нет записи', 'No recording'), 8, y2 + laneH / 2 + 3);
        tag(y2, tr('МОЯ', 'MINE'), THEME.mine);
      }
      // окно, которое уходит в игру
      if (winEnd) {
        const xa = x(0), xb = x(winEnd);
        g.fillStyle = 'rgba(2,4,8,.62)';
        if (xa > 0) g.fillRect(0, y2, xa, laneH);
        if (xb < W) g.fillRect(xb, y2, W - xb, laneH);
        g.fillStyle = 'rgba(245,196,81,.8)'; g.fillRect(Math.round(xb), ruler, 1, H - ruler);
      }
      // линия ножниц
      if (this.tool === 'cut' && this.hoverT != null && !this.live) {
        const X = Math.round(x(this.hoverT)) + 0.5;
        g.strokeStyle = '#f7f7ff'; g.lineWidth = 1; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(X, y2); g.lineTo(X, y2 + laneH); g.stroke(); g.setLineDash([]);
      }
      if (this.playhead != null) { g.fillStyle = '#f7f7ff'; g.fillRect(Math.round(x(this.playhead)), ruler, 1.5, H - ruler); }
      if (this.marker != null && m) {
        const mx = Math.round(x(this.marker));
        g.save(); g.strokeStyle = THEME.acc; g.fillStyle = THEME.acc; g.lineWidth = 1.5; g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(mx + 0.5, 0); g.lineTo(mx + 0.5, H); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.moveTo(mx - 6, 0); g.lineTo(mx + 6, 0); g.lineTo(mx, 9); g.closePath(); g.fill(); g.restore();
      }
    }
  }
  const isDefaultModelEdit = (m) => segsPristine(m) && !m.params.offset;
  VXP.TrackEditor = TrackEditor;

  /* ================================================================== */
  /*  Тосты и стили                                                      */
  /* ================================================================== */
  let toastBox = null;
  function toast(msg, kind = '') {
    const hd = hostDoc();
    if (!hd.body) return;
    if (!toastBox || !toastBox.isConnected || toastBox.ownerDocument !== hd) { toastBox = h('div', { class: 'vxp-toasts' }); hd.body.append(toastBox); }
    const t = h('div', { class: 'vxp-toast ' + kind }, msg);
    toastBox.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }
  VXP.toast = toast;

  const CSS = `
.vxp-panel,.vxp-studio,.vxp-toasts,.vxp-count,.vxp-fxs{--vtr:#2b2b33;--vtr2:#1d1d23;--vh:#272730;--vcv:#07070a;--vcard:#0c0c10;--vp0:#131318;--vp1:#0b0b0e;--vov:rgba(3,3,5,.82);--va3:255,90,0;--vb:#0b0b0e;--v1:#121216;--v2:#18181d;--v3:#202026;--vl:rgba(255,255,255,.08);--vl2:rgba(255,255,255,.15);--vt:#f4f4f7;--vd:rgba(244,244,247,.58);--va:#ff5a00;--va2:#ff8a3d;--vok:#2ee59d;--vw:#ffb020;--vr:#ff4d5e;--vo:#9aa6b8}
.vxp-panel{display:grid;gap:10px;padding:12px;border:1px solid var(--vl);border-radius:14px;background:radial-gradient(120% 70% at 0 0,rgba(var(--va3),.08),transparent 55%),linear-gradient(180deg,var(--vp0),var(--vp1));color:var(--vt);font-family:inherit;min-width:0;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.vxp-brand{display:flex;align-items:center;gap:8px;min-width:0;padding:2px 2px 4px}
.vxp-logo{width:22px;height:22px;flex:none;background:var(--va);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2l8.66 5v10L12 22l-8.66-5V7z' fill='none' stroke='%23000' stroke-width='2' stroke-linejoin='round'/%3E%3Cpath d='M9.5 8.5h5M10.5 8.5v3.8L8.4 16.5h7.2l-2.1-4.2V8.5' fill='none' stroke='%23000' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2l8.66 5v10L12 22l-8.66-5V7z' fill='none' stroke='%23000' stroke-width='2' stroke-linejoin='round'/%3E%3Cpath d='M9.5 8.5h5M10.5 8.5v3.8L8.4 16.5h7.2l-2.1-4.2V8.5' fill='none' stroke='%23000' stroke-width='1.6' stroke-linejoin='round' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;filter:drop-shadow(0 0 6px rgba(var(--va3),.55))}
.vxp-brand b,.vxp-brand i{font-size:13px;font-weight:950;letter-spacing:.07em;font-style:normal;white-space:nowrap}
.vxp-brand i{color:var(--va)}
.vxp-ver{margin-left:auto;font-size:10px;font-weight:900;color:var(--vd);border:1px solid var(--vl2);border-radius:999px;padding:1px 8px;white-space:nowrap}
.vxp-brand.sm .vxp-logo{width:16px;height:16px}.vxp-brand.sm b,.vxp-brand.sm i{font-size:11px}
.vxp-sec{display:grid;gap:8px;min-width:0;padding:10px;border:1px solid var(--vl);border-radius:11px;background:var(--v1)}
.vxp-sec+.vxp-sec{padding-top:10px;border-top:1px solid var(--vl)}
.vxp-title{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;font-weight:950;letter-spacing:.09em;text-transform:uppercase;color:var(--vd);cursor:pointer;user-select:none}
.vxp-title>span:first-child::before{content:"";display:inline-block;width:6px;height:6px;border-radius:2px;background:var(--va);margin-right:8px;box-shadow:0 0 8px var(--va);vertical-align:1px}
.vxp-title .vxp-caret{color:var(--vd);font-size:10px;transition:transform .15s}
.vxp-sec.collapsed .vxp-caret{transform:rotate(-90deg)}
.vxp-sec.collapsed>:not(.vxp-title){display:none!important}
.vxp-badge{font-size:9px;font-weight:900;color:#1a0a00;background:var(--va);border-radius:999px;padding:1px 7px;letter-spacing:.04em}
.vxp-badge.warn{background:var(--vw)}
.vxp-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.vxp-btn{height:32px;min-height:0;min-width:0;padding:0 12px;border-radius:9px;border:1px solid var(--vl2);background:var(--v3);color:var(--vt);font-weight:800;font-size:12px;line-height:1;font-family:inherit;box-shadow:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;transition:border-color .12s,background .12s,transform .06s,box-shadow .12s}
.vxp-btn:hover:not([disabled]){border-color:var(--va);background:var(--vh)}
.vxp-btn:active:not([disabled]){transform:translateY(1px)}
.vxp-btn.icon{width:32px;padding:0}
.vxp-btn.primary{background:linear-gradient(180deg,var(--va2),var(--va));color:#1a0a00;border-color:transparent;box-shadow:0 4px 14px rgba(var(--va3),.28)}
.vxp-btn.primary:hover:not([disabled]){background:linear-gradient(180deg,#ffa05c,#ff6a14)}
.vxp-btn.rec{background:linear-gradient(180deg,#ff6b78,#d9283a);border-color:transparent;color:#fff;box-shadow:0 4px 14px rgba(255,77,94,.28)}
.vxp-btn.wide{flex:1 1 auto}
.vxp-btn.small{height:26px;padding:0 9px;font-size:11px}
.vxp-btn[disabled]{opacity:.42;cursor:default}
.vxp-editor{display:grid;gap:6px;min-width:0}
canvas.vxp-tracks{width:100%;height:112px;display:block;border-radius:9px;background:#07070a;border:1px solid var(--vl);cursor:grab;touch-action:none}
canvas.vxp-tracks.dragging{cursor:grabbing}
canvas.vxp-tracks.big{height:160px}
.vxp-editbar{display:grid;gap:6px}
.vxp-tools{justify-content:space-between;gap:4px}
.vxp-btn.active{border-color:var(--va);background:rgba(var(--va3),.14);color:var(--va2)}
canvas.vxp-tracks.cut{cursor:crosshair}
canvas.vxp-tracks:focus{outline:1px solid rgba(var(--va3),.5);outline-offset:1px}
.vxp-fxflags{display:flex;flex-wrap:wrap;gap:6px 14px}
.vxp-offset{min-width:62px;text-align:center;font-size:12px;font-weight:900;color:var(--va2);font-variant-numeric:tabular-nums}
.vxp-slider{display:grid;grid-template-columns:minmax(0,96px) 1fr 52px;gap:8px;align-items:center;font-size:12px;font-weight:800}
.vxp-slider>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vxp-slider input{width:100%;min-width:0;min-height:0;height:18px;margin:0}
.vxp-slider input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer}
.vxp-slider input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(90deg,var(--va) var(--p,50%),var(--vtr) var(--p,50%))}
.vxp-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:#fff;border:2px solid var(--va);box-shadow:0 0 0 3px rgba(var(--va3),.16)}
.vxp-slider input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--vtr)}
.vxp-slider input[type=range]::-moz-range-progress{height:4px;border-radius:2px;background:var(--va)}
.vxp-slider input[type=range]::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid var(--va)}
.vxp-slider output{text-align:right;font-variant-numeric:tabular-nums;color:var(--va2);font-weight:900;white-space:nowrap}
.vxp-meter{height:6px;border-radius:3px;background:var(--vtr2);overflow:hidden;position:relative}
.vxp-meter>i{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,var(--vok) 0%,var(--vok) 60%,var(--vw) 82%,var(--vr) 100%);background-size:var(--w,258px) 100%;transition:width .06s linear}
.vxp-meter.idle>i{width:0!important}
.vxp-check{display:flex;gap:9px;align-items:center;font-size:12px;font-weight:750;cursor:pointer;line-height:1.2}
.vxp-check input{-webkit-appearance:none;appearance:none;width:30px;height:17px;min-height:0;margin:0;flex:none;border-radius:999px;background:var(--vtr);border:0;position:relative;cursor:pointer;transition:background .15s}
.vxp-check input::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:transform .15s}
.vxp-check input:checked{background:var(--va)}
.vxp-check input:checked::after{transform:translateX(13px)}
.vxp-check.disabled{opacity:.45;cursor:default}
.vxp-select{height:28px;min-height:0;padding:0 8px;border-radius:8px;border:1px solid var(--vl2);background:var(--v3);color:var(--vt);font:inherit;font-size:12px;font-weight:800}
.vxp-inline{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:750}
.vxp-hint{font-size:11px;color:var(--vd);line-height:1.4}
.vxp-hint.warn{color:var(--vw)}
.vxp-themes{display:flex;flex-wrap:wrap;gap:8px}
.vxp-sw{width:26px;height:26px;min-height:0;padding:0;border-radius:50%;border:2px solid transparent;cursor:pointer;box-shadow:0 0 0 1px var(--vl2);transition:transform .1s}
.vxp-sw:hover{transform:scale(1.12)}
.vxp-sw.on{border-color:var(--vt);box-shadow:0 0 0 2px var(--va)}
.vxp-fxs{position:fixed;inset:0;z-index:2147483640;background:rgba(3,3,5,.84);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Nunito Variable","Arial Rounded MT Bold",system-ui,sans-serif;color:var(--vt)}
.vxp-fxcard{width:min(1040px,100%);max-height:calc(100vh - 32px);overflow:auto;display:grid;gap:12px;padding:16px;background:radial-gradient(90% 40% at 0 0,rgba(var(--va3),.1),transparent 60%),#0c0c10;border:1px solid var(--vl2);border-top:2px solid var(--va);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.7)}
.vxp-fxhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vxp-fxtitle{font-size:15px;font-weight:950;letter-spacing:.08em}
.vxp-eqwrap{border:1px solid var(--vl);border-radius:11px;overflow:hidden;background:#07070a}
canvas.vxp-eqcv{display:block;width:100%;height:300px;touch-action:none}
.vxp-bandrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vxp-bchip{width:26px;height:26px;border-radius:50%;border:2px solid var(--bc);background:transparent;color:var(--bc);font:900 11px system-ui;cursor:pointer;padding:0;opacity:.6}
.vxp-bchip.on{background:var(--bc);color:#101014;opacity:1}.vxp-bchip.sel{box-shadow:0 0 0 2px #fff;opacity:1}
.vxp-nl{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:var(--vd)}
.vxp-num{width:74px;height:28px;border-radius:8px;border:1px solid var(--vl2);background:var(--v3);color:var(--vt);font:800 12px inherit;padding:0 6px}
.vxp-dcards{display:grid;grid-template-columns:1.6fr 1fr .8fr;gap:10px}
@media (max-width:900px){.vxp-dcards{grid-template-columns:1fr}}
.vxp-dcard{display:grid;gap:10px;padding:12px;border:1px solid var(--vl);border-radius:11px;background:var(--v1)}
.vxp-dhead{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.vxp-dhead b{font-size:12px;font-weight:950;letter-spacing:.06em;text-transform:uppercase}.vxp-dhead small{display:block;color:var(--va2);font-size:9px;font-weight:900;letter-spacing:.1em}
.vxp-knobs{display:flex;flex-wrap:wrap;gap:10px 14px}
.vxp-knob{display:grid;justify-items:center;gap:2px;width:68px;user-select:none}
.vxp-knobcv{cursor:ns-resize;touch-action:none}
.vxp-kval{font-size:11px;font-weight:900;color:var(--va2);font-variant-numeric:tabular-nums;white-space:nowrap}
.vxp-klab{font-size:10px;font-weight:800;color:var(--vd);white-space:nowrap}
.vxp-gr{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;color:var(--vd)}
.vxp-gr>i{flex:1;height:7px;border-radius:4px;background:var(--vtr2);overflow:hidden;position:relative}
.vxp-gr>i>u{position:absolute;inset:0 0 0 auto;width:0;background:linear-gradient(270deg,var(--va),var(--va2));transition:width .05s}
.vxp-gr>span{min-width:58px;text-align:right;font-variant-numeric:tabular-nums;color:var(--va2)}
.vxp-diag{display:grid;gap:4px}
.vxp-diag>div{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:750}
.vxp-diag i{width:8px;height:8px;border-radius:50%;flex:none;background:var(--vw)}
.vxp-diag .ok i{background:var(--vok);box-shadow:0 0 6px var(--vok)}.vxp-diag .bad i{background:var(--vr);box-shadow:0 0 6px var(--vr)}
.vxp-diag .n{margin-left:auto;color:var(--vd);font-weight:600;text-align:right}
.vxp-nrstat{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;color:var(--vd)}
.vxp-nrstat>i{flex:1;height:5px;border-radius:3px;background:var(--vtr2);overflow:hidden;position:relative}
.vxp-nrstat>i>u{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,var(--va),var(--va2));transition:width .12s}
.vxp-nrstat>span{min-width:110px;text-align:right;font-variant-numeric:tabular-nums}
.vxp-nrstat.on>span{color:var(--va2)}
.vxp-lines{display:grid;gap:4px;max-height:200px;overflow:auto;padding-right:2px}
.vxp-line{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:7px 9px;border-radius:8px;background:var(--v2);border:1px solid transparent;font-size:12px;cursor:pointer;min-width:0}
.vxp-line:hover{border-color:rgba(var(--va3),.45)}
.vxp-line.active{border-color:var(--va);background:rgba(var(--va3),.1)}
.vxp-line .n{font-weight:900;color:var(--vd);font-variant-numeric:tabular-nums}
.vxp-line .c{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.vxp-chip{font-size:9px;font-weight:950;padding:2px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.vxp-chip.sent{background:rgba(46,229,157,.14);color:var(--vok)}
.vxp-chip.ready{background:rgba(255,176,32,.15);color:var(--vw)}
.vxp-chip.now{background:rgba(var(--va3),.2);color:var(--va2)}
.vxp-chip.todo{background:rgba(255,255,255,.07);color:var(--vd)}
.vxp-chip.sending{background:rgba(124,156,255,.18);color:#9fb4ff}
.vxp-status{font-size:12px;font-weight:750;color:var(--vt);line-height:1.35}
.vxp-status b{color:var(--vt)}
.vxp-toasts{position:fixed;right:16px;bottom:16px;display:grid;gap:8px;z-index:2147483646;pointer-events:none}
.vxp-toast{background:var(--vcard);border:1px solid rgba(var(--va3),.5);border-left:3px solid var(--va);color:var(--vt);padding:10px 14px;border-radius:10px;font:800 13px/1.3 "Nunito Variable",system-ui,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.5);transition:opacity .3s,transform .3s;max-width:340px}
.vxp-toast.err{border-color:rgba(255,77,94,.6);border-left-color:var(--vr)}
.vxp-toast.out{opacity:0;transform:translateY(6px)}
.vxp-count{position:fixed;z-index:2147483500;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:rgba(0,0,0,.5);border-radius:10px;cursor:pointer;font-family:"Nunito Variable",system-ui,sans-serif;color:#fff}
.vxp-count.in{position:absolute;inset:0}
.vxp-count b{font-size:clamp(64px,14vw,150px);line-height:1;font-weight:950;text-shadow:0 0 38px rgba(var(--va3),.9);animation:vxpPop .95s ease-out both}
.vxp-count small{font-size:12px;font-weight:800;color:rgba(255,255,255,.78)}
@keyframes vxpPop{0%{transform:scale(1.45);opacity:0}18%{opacity:1}100%{transform:scale(.92);opacity:.9}}
.vxp-studio{position:fixed;inset:0;z-index:2147483600;background:var(--vov);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Nunito Variable","Arial Rounded MT Bold",system-ui,sans-serif;color:var(--vt)}
.vxp-card{align-items:start;width:min(1100px,100%);max-height:calc(100vh - 32px);overflow:auto;background:radial-gradient(90% 40% at 0 0,rgba(var(--va3),.08),transparent 60%),var(--vcard);border:1px solid var(--vl2);border-top:2px solid var(--va);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.65);display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:14px;padding:16px}
.vxp-card-head{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:10px}
.vxp-card-head h3{margin:2px 0 0;font-size:17px;font-weight:950}
.vxp-card-head small{display:block;color:var(--va2);font-size:11px;font-weight:950;letter-spacing:.07em;text-transform:uppercase;margin-top:6px}
.vxp-stagebox{display:grid;gap:10px;min-width:0;align-content:start}
.vxp-video{position:relative;border:1px solid rgba(var(--va3),.5);border-radius:10px;background:#000;aspect-ratio:16/9;overflow:hidden;box-shadow:0 0 0 3px rgba(var(--va3),.08)}
.vxp-video video{width:100%;height:100%;object-fit:contain;display:block}
.vxp-cue{position:absolute;left:10px;top:10px;padding:4px 11px;border-radius:999px;font-size:11px;font-weight:950;letter-spacing:.07em;background:rgba(0,0,0,.65);display:none;z-index:2}
.vxp-cue.on{display:block}.vxp-cue.ready{color:var(--vw)}.vxp-cue.rec{color:var(--vr)}.vxp-cue.tail{color:var(--vw)}
.vxp-sub{border-top:1px solid rgba(var(--va3),.4);padding:8px 2px 0}
.vxp-sub span{display:block;color:var(--va2);font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.05em}
.vxp-sub p{margin:4px 0 0;font-size:17px;font-weight:900;line-height:1.3}
.vxp-side{display:grid;gap:10px;align-content:start;min-width:0}
.vxp-pst{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;font-family:"Nunito Variable","Arial Rounded MT Bold",system-ui,sans-serif}
.vxp-pst span{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:12px;font-weight:800;color:#e8e8ee;white-space:nowrap}
.vxp-pst span b{font-weight:900;color:var(--va,#ff8a3d)}
.vxp-pst span em{font-style:normal;opacity:.6;font-weight:700;font-size:11px}
.vxp-pst .g b{color:#2ee59d}.vxp-pst .w b{color:#ffb020}.vxp-pst .x b{color:#9aa6b8}
.vxp-pst.load span{opacity:.55}
.vxp-ifix{display:grid;gap:8px;padding:10px;border:1px solid var(--va,#ff5a00);border-radius:11px;background:var(--v1,#121216);min-width:0}
.vxp-steps{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.vxp-step{flex:1 1 0;min-width:96px;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--vl);border-radius:10px;background:var(--v1);color:var(--vd);font-size:12px;font-weight:800;transition:all .15s}
.vxp-step b{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--v3);color:var(--vt);font-size:12px;flex:none}
.vxp-step.now{border-color:var(--va);color:var(--vt);box-shadow:0 0 0 1px var(--va) inset,0 0 16px rgba(var(--va3),.25)}
.vxp-step.now b{background:var(--va);color:#fff}
.vxp-step.done{color:var(--vok);border-color:rgba(46,229,157,.35)}
.vxp-step.done b{background:var(--vok);color:#05110c}
.vxp-btn.big{padding:15px 18px;font-size:15px;font-weight:900;border-radius:13px;min-height:50px}
.vxp-btn.rec.live{animation:vxpPulse 1.1s ease-in-out infinite}
@keyframes vxpPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,77,94,.55)}50%{box-shadow:0 0 0 9px rgba(255,77,94,0)}}
.vxp-btn kbd{margin-left:8px;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.16);font:inherit;font-size:11px;font-weight:900;opacity:.85}
.vxp-navrow{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center}
.vxp-navrow .vxp-navmid{text-align:center;font-size:12px;font-weight:800;color:var(--vd)}
.vxp-help{display:grid;gap:4px;font-size:12px;color:var(--vd);line-height:1.5}
.vxp-help b{color:var(--vt)}
.vxp-side .vxp-lines{max-height:260px}
@media (max-width:860px){.vxp-card{grid-template-columns:1fr}.vxp-side .vxp-lines{max-height:160px}}
`;
  function injectCss() {
    if (qs('#vxp-style')) return;
    (document.head || document.documentElement).append(h('style', { id: 'vxp-style' }, CSS));
    applyTheme();
  }

  /* ================================================================== */
  /*  Общие виджеты: микрофон, обработка, отсчёт/буфер                   */
  /* ================================================================== */
  const widgets = new Set(); // элементы с ._sync()
  function syncWidgets() { for (const w of widgets) { if (!w.isConnected) { widgets.delete(w); continue; } try { w._sync(); } catch {} } }
  function slider({ label, min, max, step = 1, get, set, fmt, title, onCommit, def = 0 }) {
    const out = h('output');
    const range = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), title });
    const show = (v) => { out.textContent = fmt(v); range.style.setProperty('--p', clamp(((v - min) / (max - min)) * 100, 0, 100) + '%'); };
    range.addEventListener('input', () => { set(+range.value, false); show(+range.value); });
    range.addEventListener('change', () => { set(+range.value, true); onCommit && onCommit(+range.value); });
    range.addEventListener('dblclick', () => { range.value = String(def); set(def, true); show(def); onCommit && onCommit(def); });
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
    const meter = h('div', { class: 'vxp-meter idle', title: tr('Уровень микрофона (виден во время записи)', 'Mic level (shown while recording)') }, h('i'));
    meters.add(meter);
    return h('div', { style: 'display:grid;gap:7px' },
      slider({ label: tr('🎙 Микрофон', '🎙 Microphone'), min: -12, max: 12, get: () => settings.gainDb, set: (v) => { settings.gainDb = v; applyGainAll(); saveSettings(); }, fmt: (v) => fmtSigned(v, tr('дБ', 'dB')) || tr('0 дБ', '0 dB'), title: tr('Усиление микрофона — действует сразу, даже во время записи. Двойной клик — сброс', 'Mic gain — applies instantly, even while recording. Double-click — reset') }),
      meter,
      checkbox({ label: tr('Слушать себя при записи', 'Hear myself while recording'), get: () => settings.monitorSelf, set: (v) => { settings.monitorSelf = v; saveSettings(); updateMonitorAll(); }, title: tr('Свой голос в наушниках во время записи', 'Your own voice in headphones while recording') }),
    );
  }
  function timingControls() {
    return h('div', { style: 'display:grid;gap:6px' },
      selectRow({ label: tr('Отсчёт перед записью', 'Countdown before recording'), options: [[0, tr('нет', 'none')], [3, tr('3 с', '3 s')], [5, tr('5 с', '5 s')]], get: () => settings.countdown, set: (v) => { settings.countdown = v; }, title: tr('Обратный отсчёт 3-2-1 после нажатия «Записать»', '3-2-1 countdown after you press Record') }),
      selectRow({ label: tr('Буфер после реплики', 'Buffer after the line'), options: [[0, tr('нет', 'none')], [3, tr('3 с', '3 s')], [5, tr('5 с', '5 s')], [8, tr('8 с', '8 s')]], get: () => settings.tailSec, set: (v) => { settings.tailSec = v; }, title: tr('Запись продолжается после конца реплики — опоздавшую фразу можно перетащить влево', 'Recording continues after the line ends — drag a late phrase to the left') }),
      checkbox({ label: tr('Звук отсчёта', 'Countdown beeps'), get: () => settings.countBeep, set: (v) => { settings.countBeep = v; saveSettings(); } }),
    );
  }
  /** Прослушать дубль без шумодава / с ним (для сравнения). */
  function abPlay(target, withFx) {
    const t = target(); if (!t) return toast(tr('Нет записи', 'No take'), 'err');
    if (player.playing) return player.stop();
    const m = t.model, p = { ...m.params };
    if (withFx && !p.denoise) return toast(tr('Сначала поднимите «Шумодав» выше 0', 'Raise “Denoise” above 0 first'), 'err');
    if (!withFx) p.denoise = 0;
    const x = renderModel(Object.assign({}, m, { params: p, _rk: null, _r: null }));
    player.play({ tracks: [{ samples: x, sr: m.sr, startSec: 0, gain: 1 }], dur: x.length / m.sr + 0.1 });
  }
  /** Прослушать дорожку с подменой параметров (для модулей: «с эффектом» / «без»). */
  function abPatch(target, patch) {
    const t = target(); if (!t) return toast(tr('Нет записи', 'No take'), 'err');
    if (player.playing) return player.stop();
    const m = t.model, p = Object.assign({}, m.params, patch);
    const x = renderModel(Object.assign({}, m, { params: p, _rk: null, _r: null }));
    player.play({ tracks: [{ samples: x, sr: m.sr, startSec: 0, gain: 1 }], dur: x.length / m.sr + 0.1 });
  }
  /** Выбор «движка» шумодава: обычный или нейросеть (если подключён vxp-denoise.js). */
  function nnMode(commit) {
    const opts = [['', tr('Обычный', 'Classic')], ['gtcrn', tr('Нейросеть · сильная', 'Neural · strong')], ['rnnoise', tr('Нейросеть · лёгкая', 'Neural · light')]];
    const sel = h('select', { class: 'vxp-select', title: tr('Классический шумодав хорош против ровного шума. Нейросети отличают голос от шума по звуку: сильная лучше против клавиатуры, мышки и посторонних голосов, лёгкая быстрее', 'Classic suits steady noise. Neural nets tell voice from noise by sound: strong handles keyboard, mouse and other voices, light is faster') }, opts.map(([v, t]) => h('option', { value: v }, t)));
    sel.addEventListener('change', () => {
      settings.fx.nn = sel.value; saveSettings();
      if (sel.value && !nnReady(sel.value)) {
        if (VXP.nn) { toast(tr('Нейросеть ещё загружается, пока работает обычный шумодав. Повторите через несколько секунд', 'The neural net is still loading, classic denoise is used meanwhile. Try again in a few seconds'), 'warn'); VXP.nn.load(sel.value).then(() => { if (settings.fx.nn === sel.value) commit(); }); }
        else toast(tr('Модуль нейросети (vxp-denoise.js) не подключён', 'The neural module (vxp-denoise.js) is not installed'), 'err');
      }
      commit();
    });
    const el = h('label', { class: 'vxp-inline', title: sel.title }, h('span', null, tr('Режим шумодава', 'Denoise mode')), sel);
    el._sync = () => { sel.value = settings.fx.nn || ''; };
    el._sync(); widgets.add(el);
    return el;
  }
  const fmtSemi = (v) => (v ? fmtSigned(v, tr('пт', 'st')) : '0');
  /** Обработка: target() → {model, apply()} | null */
  function fxControls(target) {
    let timer = 0;
    const commit = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const t = target(); if (!t) return;
        for (const k of FX_KEYS) t.model.params[k] = cloneJ(settings.fx[k]);
        t.apply();
      }, 60);
    };
    const set = (k) => (v, done) => { settings.fx[k] = v; if (done) { saveSettings(); commit(); } };
    const flag = (k, label, title) => checkbox({ label, get: () => settings.fx[k], set: (v) => { settings.fx[k] = v; saveSettings(); commit(); }, title });
    const fxBtn = h('button', { class: 'vxp-btn primary wide', type: 'button', title: tr('Эквалайзер со спектром, компрессор, дэ-эссер и лимитер для вашей дорожки', 'Spectrum EQ, compressor, de-esser and limiter for your track'), onclick: () => openFxStudio(target, commit) }, '🎛 ORDAX FX · ' + tr('эквалайзер и динамика', 'EQ & dynamics'));
    const lowcut = flag('lowcut', tr('Срез низов', 'Low cut'), tr('Убирает гул и стук: фильтр высоких частот 90 Гц', 'Removes rumble and thumps: 90 Hz high-pass filter'));
    const spaceSet = (patch, done) => { settings.fx.space = Object.assign({}, settings.fx.space, patch); if (done) { saveSettings(); commit(); } };
    const typeBtns = [['room', tr('Комната', 'Room')], ['hall', tr('Зал', 'Hall')], ['echo', tr('Эхо', 'Echo')]].map(([t, l]) =>
      h('button', { class: 'vxp-btn small', type: 'button', 'data-t': t, title: { room: tr('Небольшое помещение — голос «живее»', 'A small room — a livelier voice'), hall: tr('Большой зал с длинным хвостом', 'A big hall with a long tail'), echo: tr('Повторы с затухающим тоном', 'Repeats that fade and darken') }[t], onclick: () => { spaceSet({ type: t }, true); if (!settings.fx.space.mix) spaceSet({ mix: 25 }, true); syncWidgets(); } }, l));
    const spaceBox = h('div', { style: 'display:grid;gap:7px' },
      h('div', { class: 'vxp-title', style: 'cursor:default' }, h('span', null, tr('Пространство', 'Space'))),
      h('div', { class: 'vxp-row' }, ...typeBtns),
      slider({ label: tr('🌌 Количество', '🌌 Amount'), min: 0, max: 100, step: 1, def: 0, get: () => settings.fx.space.mix, set: (v, d) => spaceSet({ mix: v }, d), fmt: (v) => (v ? v + '%' : tr('выкл', 'off')), title: tr('Сколько «пространства» добавить. Двойной клик — выключить', 'How much space to add. Double-click — off') }),
      slider({ label: tr('📐 Размер', '📐 Size'), min: 0, max: 100, step: 1, def: 50, get: () => settings.fx.space.size, set: (v, d) => spaceSet({ size: v }, d), fmt: (v) => v + '%', title: tr('Размер помещения / время между повторами', 'Room size / time between repeats') }));
    spaceBox._sync = () => { const sp = settings.fx.space; typeBtns.forEach((b) => b.classList.toggle('primary', b.dataset.t === sp.type && !!sp.mix)); };
    spaceBox._sync(); widgets.add(spaceBox);
    const extraHost = h('div', { style: 'display:grid;gap:7px' });
    extraHost._fill = () => { extraHost.textContent = ''; for (const e of VXP.fxExtras) { try { extraHost.appendChild(e.build({ commit, target, ab: (patch) => abPatch(target, patch) })); } catch (er) { console.warn('[Voxalike+OrdaxEd] fx extra', er); } } };
    extraHost._fill(); fxExtraHosts.add(extraHost);
    const reset = h('button', { class: 'vxp-btn small', type: 'button', onclick: () => { settings.fx = defFx(); saveSettings(); syncWidgets(); commit(); } }, tr('Сбросить', 'Reset'));
    return h('div', { style: 'display:grid;gap:7px' },
      slider({ label: tr('🔊 Громкость', '🔊 Volume'), min: -12, max: 12, get: () => settings.fx.gain, set: set('gain'), fmt: (v) => fmtSigned(v, tr('дБ', 'dB')) || tr('0 дБ', '0 dB'), title: tr('Громкость моей дорожки (с защитой от перегруза). Двойной клик — сброс', 'Volume of my track (overload-protected). Double-click — reset') }),
      slider({ label: tr('🎚 Питч', '🎚 Pitch'), min: -12, max: 12, step: 1, get: () => settings.fx.pitch, set: set('pitch'), fmt: fmtSemi, title: tr('Высота голоса в полутонах, длительность не меняется. Двойной клик — сброс', 'Voice pitch in semitones, duration unchanged. Double-click — reset') }),
      slider({ label: tr('⏩ Скорость', '⏩ Speed'), min: 0.5, max: 2, step: 0.05, def: 1, get: () => settings.fx.speed, set: set('speed'), fmt: (v) => '×' + (+v).toFixed(2), title: tr('Темп моей дорожки: быстрее — короче, медленнее — длиннее. Высота голоса не меняется. Двойной клик — сброс', 'Tempo of my track: faster — shorter, slower — longer. Pitch unchanged. Double-click — reset') }),
      slider({ label: tr('🧹 Шумодав', '🧹 Denoise'), min: 0, max: 100, step: 5, def: 0, get: () => settings.fx.denoise, set: set('denoise'), fmt: (v) => (v ? v + '%' : tr('выкл', 'off')), title: tr('Убирает постоянный фон с готовой записи: шипение, гул, вентилятор. Двойной клик — выключить', 'Removes steady background from the finished take: hiss, hum, fan. Double-click — off') }),
      nnMode(commit),
      h('div', { class: 'vxp-row' },
        h('button', { class: 'vxp-btn small', type: 'button', title: tr('Послушать мою дорожку без шумодава (повторный клик — стоп)', 'Listen to my track without denoise (click again to stop)'), onclick: () => abPlay(target, false) }, tr('▶ Без шумодава', '▶ No denoise')),
        h('button', { class: 'vxp-btn small', type: 'button', title: tr('Послушать мою дорожку с шумодавом', 'Listen to my track with denoise'), onclick: () => abPlay(target, true) }, tr('▶ С шумодавом', '▶ With denoise'))),
      h('div', { class: 'vxp-row' }, fxBtn),
      h('div', { class: 'vxp-fxflags' }, lowcut, flag('underwater', tr('Под водой', 'Underwater'), tr('Глухой «подводный» звук с лёгким плаванием', 'Muffled “underwater” sound with a slight wobble'))),
      spaceBox,
      extraHost,
      h('div', { class: 'vxp-inline', style: 'justify-content:flex-end' }, reset),
      h('div', { class: 'vxp-hint' }, tr('Обработка применяется к записи и сохраняется для следующих дублей.', 'Processing is applied to the take and kept for the next takes.')));
  }
  const fxExtraHosts = new Set();
  const meters = new Set();
  const nrStats = new Set();
  /** Шумодав микрофона: переключатель, сила, живой индикатор подавления. */
  function nrControls() {
    return h('div', { style: 'display:grid;gap:8px' },
      profileRow(),
      h('div', { class: 'vxp-hint' }, tr('Шумодав применяется к записанному дублю: сила настраивается в обработке («Шумодав»). «Запомнить шум» делает очистку точнее.', 'Denoise is applied to the recorded take: set its strength in processing (“Denoise”). “Learn noise” makes it more precise.')));
  }
  function profileRow() {
    const info = h('div', { class: 'vxp-hint' });
    info._sync = () => { info.textContent = settings.nrProf ? tr('Профиль шума: запомнен. Шумодав знает ваш фон с первой секунды.', 'Noise profile: learned. The suppressor knows your background from the first second.') : tr('Профиль шума: нет, фон определяется автоматически (на старте чуть хуже).', 'Noise profile: none, background is detected automatically (slightly worse at the start).'); };
    info._sync(); widgets.add(info);
    const learn = h('button', { class: 'vxp-btn small', type: 'button', title: tr('Молчите 2,5 секунды: шумодав запомнит ваш фон и будет убирать его точнее. Нужен доступ к микрофону', 'Stay silent for 2.5 s: the suppressor learns your background and removes it more precisely. Needs microphone access') }, tr('🎯 Запомнить шум', '🎯 Learn noise'));
    const clear = h('button', { class: 'vxp-btn small', type: 'button', title: tr('Забыть профиль', 'Forget the profile'), onclick: () => { settings.nrProf = null; saveSettings(); audioHook.setProf && audioHook.setProf(); syncWidgets(); toast(tr('Профиль шума сброшен', 'Noise profile cleared')); } }, tr('Сбросить', 'Clear'));
    learn.addEventListener('click', async () => {
      if (learn.disabled || !audioHook.learn) return;
      learn.disabled = true;
      const label = learn.textContent;
      toast(tr('Молчите 2,5 секунды…', 'Stay silent for 2.5 s…'));
      let left = 3, t = setInterval(() => { learn.textContent = '… ' + Math.max(0, --left) + ' ' + tr('с', 's'); }, 1000);
      learn.textContent = '… 3 ' + tr('с', 's');
      try {
        const r = await audioHook.learn(2.5);
        settings.nrProf = { sr: r.sr, p: r.prof.map((v) => +v.toPrecision(4)) };
        saveSettings(); audioHook.setProf && audioHook.setProf(); syncWidgets();
        toast(tr('Шум запомнен', 'Noise learned'));
      } catch (e) { toast(tr('Не удалось: нужен доступ к микрофону', 'Failed: microphone access is required'), 'err'); console.warn('[Voxalike+OrdaxEd] learn', e); }
      clearInterval(t); learn.textContent = label; learn.disabled = false;
    });
    return h('div', { style: 'display:grid;gap:6px' }, h('div', { class: 'vxp-row' }, learn, clear), info);
  }
  function tickNR() {
    const n = audioHook.last, on = !!(n && n.nrNode);
    for (const st of nrStats) {
      if (!st.isConnected) { nrStats.delete(st); continue; }
      st.classList.toggle('on', on);
      const red = on ? clamp(n.nrRed, 0, 30) : 0;
      st.firstChild.firstChild.style.width = (red / 30 * 100) + '%';
      st.lastChild.textContent = !settings.nr ? tr('выключен', 'off') : on ? tr('подавление −', 'reduction −') + red.toFixed(1) + ' ' + tr('дБ', 'dB') : tr('включится при записи', 'starts on recording');
    }
  }
  function tickMeters() {
    tickNR();
    const lvl = meterLevel();
    for (const m of meters) {
      if (!m.isConnected) { meters.delete(m); continue; }
      m.classList.toggle('idle', lvl == null);
      if (lvl != null) { m.firstChild.style.width = clamp(Math.sqrt(lvl) * 100, 0, 100) + '%'; m.style.setProperty('--w', m.clientWidth + 'px'); }
    }
    raf(tickMeters);
  }
  raf(tickMeters);

  /* ---------- отсчёт ---------- */
  /** Показывает 3-2-1 поверх rectEl (или внутри host). Возвращает true, если не отменён. */
  function countdown(secs, { rectEl, host } = {}) {
    return new Promise((resolve) => {
      if (!secs) return resolve(true);
      const num = h('b'), el = h('div', { class: 'vxp-count' + (host ? ' in' : ''), title: tr('Клик или Esc — отмена', 'Click or Esc — cancel') }, num, h('small', null, tr('Приготовьтесь · Esc — отмена', 'Get ready · Esc — cancel')));
      if (host) host.append(el);
      else {
        const r = (rectEl && rectEl.getBoundingClientRect()) || { left: innerWidth / 2 - 150, top: innerHeight / 2 - 100, width: 300, height: 200 };
        Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        hostDoc().body.append(el);
      }
      const hd = hostDoc();
      let n = secs, timer = 0, done = false;
      const finish = (ok) => { if (done) return; done = true; wct(timer); el.remove(); hd.removeEventListener('keydown', onKey, true); resolve(ok); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
      hd.addEventListener('keydown', onKey, true);
      el.addEventListener('click', () => finish(false));
      const tick = () => {
        if (n <= 0) { if (settings.countBeep) beep(1320, 0.18, 0.14); finish(true); return; }
        num.textContent = String(n);
        num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
        if (settings.countBeep) beep(880, 0.1, 0.1);
        n--; timer = wst(tick, 1000);
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
      initSegs(m);
      takeModels.set(pa, m);
    }
    return m;
  }
  function applyNative(entry) {
    const pa = entry && entry.playerAudio;
    if (!pa) return;
    const m = nativeModel(pa);
    pa.samples.set(isDefaultModel(m) ? origSamplesOf(pa) : renderModel(m));
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
    if (!segsPristine(m)) return false; // пользователь уже смонтировал дубль — не трогаем
    const big = resample(ext.samples, ext.sr, pa.sampleRate);
    const orig = origSamplesOf(pa);
    if (big.length < orig.length * 0.8) return false;
    const L = locate(orig, big, pa.sampleRate, expectSec); // orig[0] == big[L]
    const r1 = rms(orig), r2 = rms(big, Math.max(0, L), Math.min(big.length, L + orig.length));
    const k = r2 > 1e-5 ? clamp(r1 / r2, 0.25, 8) : 1;
    if (k !== 1) for (let i = 0; i < big.length; i++) big[i] *= k;
    m.base = big; m.t0 = -L / pa.sampleRate; m.ext = true; m.extTail = (big.length - L - orig.length) / pa.sampleRate;
    initSegs(m);
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
      try { this.cap = await Capture.open(tr.clone(), { noMonitor: true }); this.pre = true; this.phase = 'pre'; this.bindLive(); } catch (e) { console.warn('[Voxalike+OrdaxEd] pre capture', e); }
    },
    async onStart(stream) {
      this.takeBefore = (currentTake() || {}).playerAudio || null;
      this.anchorCtx = null;
      if (!(this.cap && this.pre && !this.cap.stopped && performance.now() - this.cap.openedPerf < 15000)) {
        this.reset();
        const tr = stream.getAudioTracks && stream.getAudioTracks()[0];
        if (!tr) return;
        try { this.cap = await Capture.open(tr.clone(), { noMonitor: true }); } catch (e) { console.warn('[Voxalike+OrdaxEd] capture', e); return; }
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
      wct(this.tailTimer);
      this.tailTimer = wst(() => this.finish(), tail * 1000);
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
      wct(this.tailTimer);
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
          if (t && t.playerAudio === pa && !isDefaultModel(nativeModel(pa))) applyNative(t);
          emit('native-ext', pa);
        }
      } catch (e) { console.warn('[Voxalike+OrdaxEd] attach', e); }
    },
    reset() {
      wct(this.tailTimer);
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

  /* ---------- очередь переживает F5: копия в IndexedDB ---------- */
  const qdb = {
    db: null,
    open() {
      if (this.p) return this.p;
      return (this.p = new Promise((res) => {
        try {
          const rq = indexedDB.open('vxp-queue', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('q', { keyPath: 'key' });
          rq.onsuccess = () => res((this.db = rq.result));
          rq.onerror = () => res(null);
        } catch { res(null); }
      }));
    },
    async tx(mode, fn) {
      const db = await this.open(); if (!db) return null;
      return new Promise((res) => {
        try {
          const t = db.transaction('q', mode), out = fn(t.objectStore('q'));
          t.oncomplete = () => res(out && 'result' in out ? out.result : true);
          t.onerror = t.onabort = () => res(null);
        } catch { res(null); }
      });
    },
    put(key, q, g) {
      const m = q.model;
      return this.tx('readwrite', (st) => st.put({
        key, roomId: room.state && room.state.roomId, startedAt: g && g.startedAt, playerId: myId(), index: q.index, clipId: q.clipId, savedAt: q.savedAt || Date.now(),
        model: { base: m.base, sr: m.sr, t0: m.t0, outLen: m.outLen, ext: !!m.ext, params: JSON.parse(JSON.stringify(m.params)), segs: (m.segs || []).map((x) => ({ ...x })) },
      }));
    },
    del(key) { return this.tx('readwrite', (st) => st.delete(key)); },
    all() { return this.tx('readonly', (st) => st.getAll()); },
  };
  const persistDel = (key) => { qdb.del(key).catch(() => {}); };
  const restoredGames = new Set();
  async function restoreQueue() {
    const g = room.state && room.state.game, me = myId();
    if (!g || !me || g.mode !== 'coop') return;
    const gk = gameKey(g);
    if (restoredGames.has(gk)) return;
    restoredGames.add(gk);
    const rows = await qdb.all();
    if (!Array.isArray(rows)) return;
    let n = 0;
    for (const r of rows) {
      if (Date.now() - (r.savedAt || 0) > 36e5 * 24) { persistDel(r.key); continue; }
      if (!r.key.startsWith(gk + '|')) continue;
      const done = g.completedAt || g.takes.some((t) => t.assignmentIndex === r.index);
      if (done || r.playerId !== me) { if (done) persistDel(r.key); continue; }
      if (queue.has(r.key)) continue;
      const m = r.model;
      m.params = Object.assign(defaultParams(), m.params);
      for (const sg of m.segs) segSeq = Math.max(segSeq, (sg.id || 0) + 1);
      m._segInit = segSig(m);
      queue.set(r.key, { index: r.index, clipId: r.clipId, model: m, status: 'ready', savedAt: r.savedAt, restored: true });
      n++;
    }
    if (n) { toast(tr('Восстановлено реплик из очереди: ' + n, 'Restored lines from the queue: ' + n)); emit('queue'); trySubmit(); }
  }
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
  const statusText = (st) => ({ sent: tr('Отправлено', 'Sent'), ready: tr('В очереди', 'Queued'), now: tr('Сейчас', 'Now'), todo: tr('Не записано', 'Not recorded'), sending: tr('Отправка…', 'Sending…') })[st];

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
      q.status = 'sent'; persistDel(qKey(g, i));
      toast(tr('✓ Реплика #' + (i + 1) + ' отправлена автоматически', '✓ Line #' + (i + 1) + ' sent automatically'));
    } catch (e) {
      q.status = 'ready'; q.error = e.message;
      toast(tr('Не удалось отправить #', 'Failed to send #') + (i + 1) + ': ' + e.message, 'err');
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
    restoreQueue().catch(() => {});
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
      titleTimer = setInterval(() => { document.title = (on = !on) ? tr('🎙 Ваш ход!', '🎙 Your turn!') : origTitle; }, 900);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && titleTimer) { clearInterval(titleTimer); titleTimer = 0; if (origTitle) document.title = origTitle; }
  });

  /* ================================================================== */
  /*  Панель на сцене озвучки                                            */
  /* ================================================================== */
  /** Выбор языка интерфейса (Авто / Русский / English). */
  function langControl() {
    const sel = h('select', { class: 'vxp-select', title: tr('Язык интерфейса мода', 'Mod interface language') },
      [['auto', tr('Авто', 'Auto')], ['ru', 'Русский'], ['en', 'English']].map(([v, t]) => h('option', { value: v }, t)));
    sel.value = settings.lang;
    sel.addEventListener('change', () => { settings.lang = sel.value; saveSettings(); relocalize(); });
    return h('label', { class: 'vxp-inline' }, h('span', null, '🌐 ' + tr('Язык', 'Language')), sel);
  }
  /** Пересобрать интерфейс на новом языке. */
  function relocalize() {
    let idx = null;
    if (studio) { idx = studio.index; if (studio.dirty && studio.model) studio.save(false); studio.close(); }
    const p = qs('#vxp-panel'); if (p) p.remove();
    panel.root = null;
    ensureMounted();
    if (idx != null) openStudio(idx);
  }
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
    const lab = h('label', { class: 'vxp-check' }, cb, tr('Слушать оригинал при записи', 'Hear the original while recording'));
    cb.addEventListener('change', () => {
      const nat = qs('.recording-guide-toggle');
      if (!nat || nat.disabled) { cb.checked = false; return; }
      if ((nat.getAttribute('aria-pressed') === 'true') !== cb.checked) nat.click();
    });
    lab._sync = () => {
      const nat = qs('.recording-guide-toggle'), ok = nat && !nat.disabled;
      cb.disabled = !ok; lab.classList.toggle('disabled', !ok);
      lab.title = ok ? tr('Во время записи в наушниках звучит оригинальная реплика', 'The original line plays in your headphones while recording') : tr('Сейчас недоступно (не ваш ход или режим игры не поддерживает)', 'Unavailable now (not your turn, or the game mode doesn\'t support it)');
      cb.checked = !!(nat && nat.getAttribute('aria-pressed') === 'true');
    };
    widgets.add(lab);
    return lab;
  }
  const nativeTarget = () => { const t = currentTake(); return t && t.playerAudio ? { model: nativeModel(t.playerAudio), apply: () => { applyNative(t); refreshPanel(true); } } : null; };

  function diagRows() {
    const deck = qs('.single-stage-control-deck'), rows = [];
    const add = (label, st, note) => rows.push([label, st, note || '']);
    const sess = app.session(), pack = app.pack(), take = currentTake(), mic = app.mic();
    add(tr('Панель игры', 'Game panel'), deck ? 'ok' : 'wait', deck ? '' : tr('откройте сцену озвучки', 'open the voice-over stage'));
    add(tr('Кнопка «Записать»', 'Record button'), qs('.stage-record-button') ? 'ok' : 'wait', '');
    add('React', fiberOf(deck || qs('main') || qs('#root > *')) ? 'ok' : 'bad', tr('если ✗ — сайт изменился', 'if ✗ — the site has changed'));
    add(tr('Сессия озвучки', 'Session'), sess ? 'ok' : 'wait', '');
    add(tr('Данные клипов', 'Clip data'), pack ? 'ok' : 'wait', '');
    add(tr('Микрофон игры', 'Game mic'), mic ? 'ok' : 'wait', '');
    add(tr('Мой дубль', 'My take'), take ? 'ok' : 'wait', take ? '' : tr('после записи', 'after recording'));
    add(tr('Перехват микрофона', 'Mic hook'), audioHook.nodes.size ? 'ok' : 'wait', audioHook.nodes.size ? '' : tr('при записи', 'while recording'));
    const wk = typeof AudioWorkletNode !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    add(tr('Шумодав (AudioWorklet)', 'Noise suppressor'), !wk ? 'bad' : (audioHook.last && audioHook.last.nrNode ? 'ok' : (settings.nr ? 'wait' : 'wait')), !wk ? tr('браузер не поддерживает', 'not supported') : settings.nr ? '' : tr('выключен', 'off'));
    add(tr('Комната (сеть)', 'Room'), room.state ? 'ok' : 'wait', '');
    return rows;
  }
  function diagControls() {
    const list = h('div', { class: 'vxp-diag' });
    const verdict = h('div', { class: 'vxp-hint' });
    let rows = [], last = 0;
    const sym = { ok: '✓', wait: '…', bad: '✗' };
    const render = () => {
      rows = diagRows();
      list.replaceChildren(...rows.map(([l, st, n]) => h('div', { class: st }, h('i'), h('span', null, l), h('span', { class: 'n' }, n))));
      const bad = rows.filter((r) => r[1] === 'bad').length;
      verdict.className = 'vxp-hint' + (bad ? ' warn' : '');
      verdict.textContent = bad ? tr('Что-то не найдено — вероятно, сайт обновился. Скопируйте отчёт и пришлите его.', 'Something was not found — the site has probably been updated. Copy the report and send it.') : tr('Всё нужное найдено (… — появится позже, это нормально).', 'Everything needed was found (… appears later, that is normal).');
    };
    const wrap = h('div', { style: 'display:grid;gap:7px' }, list, verdict,
      h('div', { class: 'vxp-row' }, h('button', { class: 'vxp-btn small', type: 'button', onclick: async () => {
        render();
        const txt = 'Voxalike+OrdaxEd v' + VERSION + '\n' + navigator.userAgent + '\n' + location.href + '\n' + rows.map(([l, st, n]) => sym[st] + ' ' + l + (n ? ' (' + n + ')' : '')).join('\n');
        try { await navigator.clipboard.writeText(txt); toast(tr('Отчёт скопирован', 'Report copied')); }
        catch { const ta = h('textarea', { style: 'position:fixed;opacity:0' }, txt); document.body.append(ta); ta.select(); try { document.execCommand('copy'); toast(tr('Отчёт скопирован', 'Report copied')); } catch {} ta.remove(); }
      } }, tr('📋 Скопировать отчёт', '📋 Copy report'))));
    wrap._sync = () => { if (wrap.closest('.vxp-sec.collapsed')) return; const now = performance.now(); if (now - last < 1500) return; last = now; render(); };
    widgets.add(wrap);
    return wrap;
  }
  function brandBar(small) {
    return h('div', { class: 'vxp-brand' + (small ? ' sm' : '') }, h('span', { class: 'vxp-logo' }), h('b', null, 'VOXALIKE+'), h('i', null, 'ORDAXED'), small ? null : h('span', { class: 'vxp-ver' }, 'v' + VERSION));
  }
  function buildPanel(deck) {
    const editor = new TrackEditor({
      onChange: () => { const t = currentTake(); if (t && t.playerAudio && panel.editor.model === takeModels.get(t.playerAudio)) applyNative(t); },
      onPlay: () => playNativeTogether(),
    });
    panel.editor = editor;
    panel.bufInfo = h('div', { class: 'vxp-hint' });
    panel.queueBox = h('div', { class: 'vxp-sec', 'data-sec': 'queue', style: 'display:none' });
    const root = h('div', { class: 'vxp-panel', id: 'vxp-panel' },
      brandBar(false),
      section('tracks', tr('Дорожки', 'Tracks'), editor.root, panel.bufInfo),
      section('fx', tr('Обработка', 'Processing'), fxControls(nativeTarget)),
      section('mic', tr('Запись', 'Recording'), micControls(), guideCheckbox(), timingControls()),
      section('nr', tr('Шумодав', 'Noise suppression'), nrControls()),
      panel.queueBox,
      section('diag', tr('Диагностика', 'Diagnostics'), diagControls()),
      section('app', tr('Настройки', 'Settings'), checkbox({ label: tr('Статистика игроков в лобби', 'Player stats in the lobby'), get: () => settings.lobbyStats, set: (v) => { settings.lobbyStats = v; saveSettings(); if (!v) qsa('.vxp-pst').forEach((x) => x.remove()); psScan(); }, title: tr('Co-op и PvP рядом с профилем игрока', 'Co-op and PvP next to the player profile') }), themeControl(), langControl(), ...VXP.settingsExtras.map((f) => { try { return f(); } catch { return null; } }), h('div', { class: 'vxp-hint' }, 'Voxalike+OrdaxEd v' + VERSION + tr(' · основано на Voxalike+ (BeshkekArt, MIT)', ' · based on Voxalike+ (BeshkekArt, MIT)'))));
    deck.append(root);
    panel.root = root;
    panel.lastQueueSig = '';
    refreshPanel(true);
  }

  function playNativeTogether() {
    if (player.playing) return player.stop();
    const ed = panel.editor;
    const startAt = ed.playStart();
    if (!ed.ref) return toast(tr('Нет оригинала', 'No original'));
    const t = currentTake();
    const tracks = [{ samples: ed.ref.samples, sr: ed.ref.sr, startSec: 0, gain: 0.55 }];
    let dur = ed.ref.samples.length / ed.ref.sr;
    if (t && t.playerAudio) { const pa = t.playerAudio; tracks.push({ samples: pa.samples, sr: pa.sampleRate, startSec: 0, gain: 1 }); dur = Math.max(dur, pa.samples.length / pa.sampleRate); }
    ed.setPlaying(true);
    player.play({ tracks, dur: dur + 0.1, startAt, onTick: (x) => { ed.playhead = x; ed.draw(); }, onEnd: () => { ed.playhead = null; ed.setPlaying(false); ed.draw(); } });
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
        if (isNew) { const m = nativeModel(pa); if (!isDefaultModel(m)) applyNative(t); }
        const m = pa ? nativeModel(pa) : null;
        panel.editor.set(refObj ? { samples: refObj.samples, sr: refObj.sampleRate } : null, m);
      }
    }
    // строка о буфере
    let info = '', warn = false;
    if (nativeRec.phase === 'tail') { info = tr('● Буфер: дописываю ещё ', '● Buffer: still recording ') + Math.max(0, Math.ceil((nativeRec.tailEnd - performance.now()) / 1000)) + tr(' с — можно продолжать говорить', ' s — you can keep talking'); warn = true; }
    else if (pa && takeModels.get(pa) && takeModels.get(pa).ext) info = tr('Буфер +', 'Buffer +') + Math.round(takeModels.get(pa).extTail) + tr(' с: опоздавшую фразу тяните влево, в светлое окно.', ' s: drag a late phrase left, into the light window.');
    else info = tr('Тяните свою дорожку мышью. В игру уходит то, что в светлом окне.', 'Drag your track with the mouse. What goes into the game is what is in the light window.');
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
  onBus('native-ext', () => { panel.takeRef = null; refreshPanel(true); toast(tr('Буфер записи добавлен к дублю', 'Recording buffer added to the take')); });

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
        h('span', null, tr('Мои реплики', 'My lines') + ' ', h('span', { class: 'vxp-badge' }, done + '/' + mine.length)), h('span', { class: 'vxp-caret' }, '▾')),
      h('div', { class: 'vxp-status' }, cur ? (cur.playerId === myId() ? h('b', null, tr('Сейчас ваш ход', 'It\'s your turn')) : [tr('Ход: ', 'Turn: '), h('b', null, cur.playerName || tr('игрок', 'player')), tr(' · реплика ', ' · line ') + (g.currentAssignmentIndex + 1) + '/' + g.assignments.length]) : ''),
      h('div', { class: 'vxp-lines' }, mine.map((a) => {
        const st = lineStatus(g, a);
        return h('div', { class: 'vxp-line' + (st === 'now' ? ' active' : ''), title: a.caption, onclick: () => { if (st !== 'sent') openStudio(a.index); } },
          h('span', { class: 'n' }, '#' + (a.index + 1)), h('span', { class: 'c' }, a.caption || a.title || a.clipId), h('span', { class: 'vxp-chip ' + st }, statusText(st)));
      })),
      h('div', { class: 'vxp-row' },
        h('button', { class: 'vxp-btn primary wide', type: 'button', disabled: !left.length, onclick: () => openStudio(left[0] && left[0].index) }, left.length ? tr('🎙 Записать все заранее (', '🎙 Record all in advance (') + left.length + ')' : tr('✓ Все реплики готовы', '✓ All lines ready'))),
      h('label', { class: 'vxp-check', title: tr('Когда подходит ваша очередь, заранее записанная реплика отправляется сама', 'When your turn comes, a pre-recorded line is submitted automatically') }, cb, tr('Авто-отправка в мой ход', 'Auto-submit on my turn')));
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
      try { buildPanel(deck); } catch (e) { console.warn('[Voxalike+OrdaxEd] panel', e); }
    } else if (deck && panel.root && deck.lastElementChild !== panel.root) {
      deck.append(panel.root); // элементы игры всегда выше панели мода
    }
    if (!deck && nativeRec.phase !== 'idle' && nativeRec.phase !== 'tail') nativeRec.reset();
  }
  // setTimeout, а не rAF: в фоновой вкладке rAF не срабатывает
  const mo = new MutationObserver(() => { if (!mountScheduled) { mountScheduled = true; setTimeout(ensureMounted, 30); } });
  const startObserver = () => { mo.observe(document.documentElement, { childList: true, subtree: true }); ensureMounted(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver); else startObserver();
  setInterval(() => { try { refreshPanel(false); } catch (e) { console.warn('[Voxalike+OrdaxEd]', e); } }, 400);

  /* ================================================================== */
  /*  ORDAX FX: окно эквалайзера и динамики                              */
  /* ================================================================== */
  const F_MIN = 20, F_MAX = 20000, EQ_RANGE = 18;
  const BAND_COL = ['#ff5a5a', '#ffa23a', '#e8e23a', '#4be36a', '#3dc4ff', '#b17aff'];
  const logX = (f, W) => (W * Math.log(f / F_MIN)) / Math.log(F_MAX / F_MIN);
  const xLog = (x, W) => F_MIN * Math.pow(F_MAX / F_MIN, x / W);
  const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' ' + tr('кГц', 'kHz') : Math.round(f) + ' ' + tr('Гц', 'Hz'));
  const fmtDb = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' ' + tr('дБ', 'dB');
  const eqTypeName = (t) => ({ hp: tr('Срез НЧ', 'High-pass'), lowshelf: tr('Полка НЧ', 'Low shelf'), bell: tr('Колокол', 'Bell'), highshelf: tr('Полка ВЧ', 'High shelf'), lp: tr('Срез ВЧ', 'Low-pass') }[t] || t);

  /** Круглая ручка: тянуть по вертикали, колесо, двойной клик — сброс. */
  function knob(o) {
    const S = 56, cv = h('canvas', { width: S * 2, height: S * 2, class: 'vxp-knobcv' });
    cv.style.width = S + 'px'; cv.style.height = S + 'px';
    const val = h('div', { class: 'vxp-kval' }), lab = h('div', { class: 'vxp-klab' }, o.label);
    const el = h('div', { class: 'vxp-knob', title: o.title || '' }, cv, val, lab);
    const to01 = (v) => clamp(o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min), 0, 1);
    const from01 = (t) => { t = clamp(t, 0, 1); let v = o.log ? o.min * Math.pow(o.max / o.min, t) : o.min + t * (o.max - o.min); if (o.step) v = Math.round(v / o.step) * o.step; return clamp(v, o.min, o.max); };
    const draw = () => {
      const g = cv.getContext('2d'), W = S * 2, c = W / 2, r = W * 0.36, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, t = to01(o.get());
      g.clearRect(0, 0, W, W); g.lineCap = 'round';
      g.lineWidth = 7; g.strokeStyle = '#2b2b33'; g.beginPath(); g.arc(c, c, r, a0, a1); g.stroke();
      g.strokeStyle = THEME.acc; g.shadowColor = THEME.acc; g.shadowBlur = 10; g.beginPath(); g.arc(c, c, r, a0, a0 + (a1 - a0) * t); g.stroke(); g.shadowBlur = 0;
      const grad = g.createRadialGradient(c - 8, c - 10, 4, c, c, r * 0.8); grad.addColorStop(0, '#34343d'); grad.addColorStop(1, '#16161b');
      g.fillStyle = grad; g.beginPath(); g.arc(c, c, r * 0.72, 0, Math.PI * 2); g.fill();
      const ang = a0 + (a1 - a0) * t; g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.moveTo(c + Math.cos(ang) * r * 0.25, c + Math.sin(ang) * r * 0.25); g.lineTo(c + Math.cos(ang) * r * 0.62, c + Math.sin(ang) * r * 0.62); g.stroke();
      val.textContent = o.fmt(o.get());
    };
    let dragY = null, startT = 0;
    cv.addEventListener('pointerdown', (e) => { dragY = e.clientY; startT = to01(o.get()); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener('pointermove', (e) => { if (dragY == null) return; const k = e.shiftKey ? 900 : 180; o.set(from01(startT + (dragY - e.clientY) / k), false); draw(); });
    const up = () => { if (dragY == null) return; dragY = null; o.set(o.get(), true); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); o.set(from01(to01(o.get()) + (e.deltaY < 0 ? 0.02 : -0.02) * (e.shiftKey ? 0.25 : 1)), true); draw(); }, { passive: false });
    cv.addEventListener('dblclick', () => { o.set(o.def, true); draw(); });
    el._draw = draw; draw();
    return el;
  }

  const FX_PRESETS = () => [
    ['clean', tr('Чистый голос', 'Clean voice'), (f) => {
      Object.assign(f.eq[0], { on: true, f: 80 }); Object.assign(f.eq[2], { on: true, f: 280, g: -2.5, q: 1 }); Object.assign(f.eq[3], { on: true, f: 3200, g: 2, q: 0.9 }); Object.assign(f.eq[5], { on: true, f: 11000, g: 2.5 });
      Object.assign(f.comp, { on: true, thr: -22, ratio: 3, att: 12, rel: 120, knee: 8, makeup: 4 }); Object.assign(f.deess, { on: true, f: 6500, thr: -34, amt: 6 }); Object.assign(f.lim, { on: true, ceil: -1, gain: 1.5 });
    }],
    ['podcast', tr('Подкаст', 'Podcast'), (f) => {
      Object.assign(f.eq[0], { on: true, f: 90 }); Object.assign(f.eq[1], { on: true, f: 140, g: 2.5 }); Object.assign(f.eq[2], { on: true, f: 320, g: -3, q: 1.1 }); Object.assign(f.eq[3], { on: true, f: 4200, g: 3, q: 0.8 });
      Object.assign(f.comp, { on: true, thr: -26, ratio: 4, att: 8, rel: 150, knee: 6, makeup: 6 }); Object.assign(f.deess, { on: true, f: 7000, thr: -32, amt: 8 }); Object.assign(f.lim, { on: true, ceil: -1.5, gain: 3 });
    }],
    ['radio', tr('Рация / телефон', 'Radio / phone'), (f) => {
      Object.assign(f.eq[0], { on: true, f: 420 }); Object.assign(f.eq[3], { on: true, f: 1700, g: 4, q: 1.1 }); Object.assign(f.eq[5], { on: true, type: 'lp', f: 3400, q: 0.8 });
      Object.assign(f.comp, { on: true, thr: -20, ratio: 6, att: 4, rel: 90, knee: 4, makeup: 6 }); Object.assign(f.lim, { on: true, ceil: -1, gain: 3 });
    }],
    ['deess', tr('Только дэ-эссер', 'De-esser only'), (f) => { Object.assign(f.deess, { on: true, f: 6800, thr: -36, amt: 9 }); }],
  ];

  /** Окно ORDAX FX. target() → { model, apply } | null; commitFx() — применить к дублю. */
  function openFxStudio(target, commitFx) {
    if (qs('.vxp-fxs', hostDoc())) return;
    const fx = settings.fx;
    const st = { sr: 48000, inSpec: null, outSpec: null, live: null, ph: null, sel: 0, tr: null, x: null, drag: null };
    const model = () => { const t = target && target(); return t ? t.model : null; };
    const params = (patch) => { const m = model(); const p = { ...(m ? m.params : {}) }; for (const k of FX_KEYS) p[k] = cloneJ(fx[k]); return Object.assign(p, patch || {}); };
    const OFF = () => ({ eq: fx.eq.map((b) => ({ ...b, on: false })), comp: { ...fx.comp, on: false }, deess: { ...fx.deess, on: false }, lim: { ...fx.lim, on: false } });
    const knobs = [];
    const changed = (done) => { saveSettings(); if (done) { scheduleCommit(); } drawAll(); };
    let commitTimer = 0;
    function scheduleCommit() {
      clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        try { commitFx && commitFx(); } catch (e) { console.warn('[Voxalike+OrdaxEd] fx commit', e); }
        recompute();
        if (player.playing) playMine(true);
      }, 140);
    }
    // ---------- спектр ----------
    function recompute() {
      const m = model();
      if (!m) { st.inSpec = st.outSpec = null; drawAll(); return; }
      st.sr = m.sr;
      try {
        const a = Object.assign({}, m, { params: params(OFF()), _rk: null, _r: null });
        const b = Object.assign({}, m, { params: params(), _rk: null, _r: null });
        st.inSpec = avgSpectrum(renderModel(a)); st.x = renderModel(b); st.tr = b._tr || null; st.outSpec = avgSpectrum(st.x);
      } catch (e) { console.warn('[Voxalike+OrdaxEd] fx spectrum', e); }
      drawAll();
    }
    // ---------- воспроизведение ----------
    function playMine(withFx) {
      const m = model(); if (!m) return toast(tr('Нет записи — сначала запишите дубль', 'No take — record one first'), 'err');
      if (player.playing && withFx !== true) return player.stop();
      const cp = Object.assign({}, m, { params: withFx === false ? params(OFF()) : params(), _rk: null, _r: null });
      const x = renderModel(cp); st.x = x; st.tr = cp._tr || null; st.sr = m.sr;
      player.play({ tracks: [{ samples: x, sr: m.sr, startSec: 0, gain: 1 }], dur: x.length / m.sr + 0.1,
        onTick: (t) => { st.ph = t; drawAll(); }, onEnd: () => { st.ph = null; st.live = null; drawAll(); } });
    }
    // ---------- эквалайзер ----------
    const cvEq = h('canvas', { class: 'vxp-eqcv', title: tr('Тяните точки: влево-вправо — частота, вверх-вниз — усиление. Колесо — добротность. Двойной клик — включить/добавить полосу', 'Drag the dots: left-right — frequency, up-down — gain. Wheel — Q. Double-click — toggle/add a band') });
    const yOfDb = (d, H) => H / 2 - (d / EQ_RANGE) * (H / 2) * 0.88;
    const dbOfY = (y, H) => clamp(-((y - H / 2) / ((H / 2) * 0.88)) * EQ_RANGE, -EQ_RANGE, EQ_RANGE);
    const ySpec = (d, H) => H - clamp((d + 100) / 85, 0, 1) * H * 0.9 - 4;
    function specPath(g, spec, W, H) {
      const nb = spec.length, binHz = st.sr / 2 / nb; let first = true;
      for (let x = 0; x <= W; x += 2) {
        const f = xLog(x, W), c = f / binHz, lo = Math.max(1, Math.floor(c * 0.94)), hi = Math.min(nb - 1, Math.max(lo, Math.ceil(c * 1.06)));
        let s = 0, n = 0; for (let k = lo; k <= hi; k++) { s += spec[k]; n++; }
        const y = ySpec(n ? s / n : -120, H);
        if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
      }
    }
    function drawEq() {
      const cv = cvEq, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d0d12'); bg.addColorStop(1, '#07070a'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.font = '700 10px system-ui,sans-serif'; g.textBaseline = 'top';
      for (const f of [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(logX(f, W)) + 0.5; g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x, 0, 1, H); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, H - 14); }
      for (const d of [-12, -6, 0, 6, 12]) { const y = Math.round(yOfDb(d, H)) + 0.5; g.fillStyle = d === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)'; g.fillRect(0, y, W, 1); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillText((d > 0 ? '+' : '') + d, 4, y + 2); }
      if (st.outSpec) { g.beginPath(); specPath(g, st.outSpec, W, H); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); const fg = g.createLinearGradient(0, 0, 0, H); fg.addColorStop(0, 'rgba(' + THEME.rgb + ',.34)'); fg.addColorStop(1, 'rgba(' + THEME.rgb + ',.02)'); g.fillStyle = fg; g.fill(); }
      if (st.inSpec) { g.beginPath(); specPath(g, st.inSpec, W, H); g.strokeStyle = 'rgba(154,166,184,.55)'; g.lineWidth = 1.2; g.stroke(); }
      if (st.live) { g.beginPath(); specPath(g, st.live, W, H); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.2; g.stroke(); }
      // суммарная кривая
      const pts = []; for (let x = 0; x <= W; x += 3) { const f = xLog(x, W); let d = 0; for (const b of fx.eq) d += eqBandDb(b, f, st.sr); pts.push([x, yOfDb(clamp(d, -EQ_RANGE * 1.2, EQ_RANGE * 1.2), H)]); }
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.lineTo(W, yOfDb(0, H)); g.lineTo(0, yOfDb(0, H)); g.closePath(); g.fillStyle = 'rgba(' + THEME.rgb + ',.13)'; g.fill();
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = THEME.acc; g.lineWidth = 2.6; g.lineJoin = 'round'; g.shadowColor = THEME.acc; g.shadowBlur = 12; g.stroke(); g.shadowBlur = 0;
      // точки
      fx.eq.forEach((b, i) => {
        const x = logX(b.f, W), y = (b.type === 'hp' || b.type === 'lp') ? yOfDb(0, H) : yOfDb(b.g, H), col = BAND_COL[i];
        g.beginPath(); g.arc(x, y, i === st.sel ? 9 : 7, 0, Math.PI * 2);
        if (b.on) { g.fillStyle = col; g.shadowColor = col; g.shadowBlur = i === st.sel ? 14 : 6; g.fill(); g.shadowBlur = 0; } else { g.fillStyle = 'rgba(0,0,0,.5)'; g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); }
        if (i === st.sel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = b.on ? '#101014' : col; g.font = '900 9px system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(String(i + 1), x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'top';
      });
    }
    function hit(e) {
      const r = cvEq.getBoundingClientRect(), W = r.width, H = r.height, px = e.clientX - r.left, py = e.clientY - r.top;
      let best = -1, bd = 14;
      fx.eq.forEach((b, i) => { const x = logX(b.f, W), y = (b.type === 'hp' || b.type === 'lp') ? yOfDb(0, H) : yOfDb(b.g, H), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } });
      return { i: best, px, py, W, H };
    }
    cvEq.addEventListener('pointerdown', (e) => {
      const k = hit(e); if (k.i < 0) return;
      st.sel = k.i; st.drag = k.i; fx.eq[k.i].on = true; cvEq.setPointerCapture(e.pointerId); syncBand(); changed(false); e.preventDefault();
    });
    cvEq.addEventListener('pointermove', (e) => {
      if (st.drag == null) { cvEq.style.cursor = hit(e).i >= 0 ? 'grab' : 'default'; return; }
      const r = cvEq.getBoundingClientRect(), b = fx.eq[st.drag];
      b.f = Math.round(clamp(xLog(clamp(e.clientX - r.left, 0, r.width), r.width), F_MIN, F_MAX));
      if (b.type !== 'hp' && b.type !== 'lp') b.g = Math.round(dbOfY(e.clientY - r.top, r.height) * 10) / 10;
      syncBand(); changed(false);
    });
    const endDrag = () => { if (st.drag == null) return; st.drag = null; changed(true); };
    cvEq.addEventListener('pointerup', endDrag); cvEq.addEventListener('pointercancel', endDrag);
    cvEq.addEventListener('wheel', (e) => {
      const k = hit(e); const i = k.i >= 0 ? k.i : st.sel; e.preventDefault();
      const b = fx.eq[i]; b.q = Math.round(clamp(b.q * (e.deltaY < 0 ? 1.1 : 0.9), 0.2, 12) * 100) / 100; if (k.i >= 0) { st.sel = i; b.on = true; }
      syncBand(); changed(true);
    }, { passive: false });
    cvEq.addEventListener('dblclick', (e) => {
      const k = hit(e);
      if (k.i >= 0) { fx.eq[k.i].on = !fx.eq[k.i].on; st.sel = k.i; }
      else { const i = fx.eq.findIndex((b) => !b.on); if (i >= 0) { const b = fx.eq[i]; b.on = true; b.f = Math.round(clamp(xLog(k.px, k.W), F_MIN, F_MAX)); if (b.type !== 'hp' && b.type !== 'lp') b.g = Math.round(dbOfY(k.py, k.H) * 10) / 10 || 3; st.sel = i; } }
      syncBand(); changed(true);
    });
    // строка выбранной полосы
    const chips = fx.eq.map((b, i) => h('button', { class: 'vxp-bchip', type: 'button', style: '--bc:' + BAND_COL[i], onclick: () => { st.sel = i; syncBand(); drawAll(); } }, String(i + 1)));
    const typeSel = h('select', { class: 'vxp-select' }, ['hp', 'lowshelf', 'bell', 'highshelf', 'lp'].map((t) => h('option', { value: t }, eqTypeName(t))));
    const num = (key, step, min, max) => h('input', { class: 'vxp-num', type: 'number', step: String(step), min: String(min), max: String(max) });
    const inF = num('f', 1, F_MIN, F_MAX), inG = num('g', 0.1, -EQ_RANGE, EQ_RANGE), inQ = num('q', 0.05, 0.2, 12);
    const onCb = h('input', { type: 'checkbox' }); const onLab = h('label', { class: 'vxp-check' }, onCb, tr('Вкл', 'On'));
    typeSel.addEventListener('change', () => { fx.eq[st.sel].type = typeSel.value; fx.eq[st.sel].on = true; syncBand(); changed(true); });
    const numChange = (inp, key, lo, hi) => inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) { fx.eq[st.sel][key] = clamp(v, lo, hi); fx.eq[st.sel].on = true; } syncBand(); changed(true); });
    numChange(inF, 'f', F_MIN, F_MAX); numChange(inG, 'g', -EQ_RANGE, EQ_RANGE); numChange(inQ, 'q', 0.2, 12);
    onCb.addEventListener('change', () => { fx.eq[st.sel].on = onCb.checked; syncBand(); changed(true); });
    function syncBand() {
      const b = fx.eq[st.sel];
      chips.forEach((c, i) => { c.classList.toggle('sel', i === st.sel); c.classList.toggle('on', !!fx.eq[i].on); });
      typeSel.value = b.type; inF.value = Math.round(b.f); inG.value = b.g.toFixed(1); inQ.value = b.q.toFixed(2); onCb.checked = !!b.on;
      inG.disabled = b.type === 'hp' || b.type === 'lp';
    }
    const bandRow = h('div', { class: 'vxp-bandrow' }, h('div', { class: 'vxp-row' }, ...chips), typeSel,
      h('label', { class: 'vxp-nl' }, tr('Гц', 'Hz'), inF), h('label', { class: 'vxp-nl' }, tr('дБ', 'dB'), inG), h('label', { class: 'vxp-nl' }, 'Q', inQ), onLab);

    // ---------- динамика ----------
    const grBar = (cls) => { const u = h('u'), t = h('span', null, '0.0 ' + tr('дБ', 'dB')); const el = h('div', { class: 'vxp-gr ' + (cls || '') }, h('i', null, u), t); el._set = (v) => { u.style.width = clamp((-v / 24) * 100, 0, 100) + '%'; t.textContent = (v ? '−' + Math.abs(v).toFixed(1) : '0.0') + ' ' + tr('дБ', 'dB'); }; return el; };
    const grComp = grBar(), grDe = grBar(), grLim = grBar();
    const DEF_BY = defFx();
    const K = (grp, key, o) => { const k = knob({ get: () => fx[grp][key], set: (v, done) => { fx[grp][key] = v; changed(!!done); }, def: DEF_BY[grp][key], ...o }); knobs.push(k); return k; };
    const sw = (grp, label) => { const cb = h('input', { type: 'checkbox' }); cb.checked = !!fx[grp].on; cb.addEventListener('change', () => { fx[grp].on = cb.checked; changed(true); }); const el = h('label', { class: 'vxp-check' }, cb, label); el._sync = () => { cb.checked = !!fx[grp].on; }; return el; };
    const swC = sw('comp', tr('Вкл', 'On')), swD = sw('deess', tr('Вкл', 'On')), swL = sw('lim', tr('Вкл', 'On'));
    const dcard = (title, sub, swEl, knobsEl, gr) => h('div', { class: 'vxp-dcard' }, h('div', { class: 'vxp-dhead' }, h('div', null, h('b', null, title), h('small', null, sub)), swEl), h('div', { class: 'vxp-knobs' }, ...knobsEl), gr);
    const cards = h('div', { class: 'vxp-dcards' },
      dcard(tr('Компрессор', 'Compressor'), 'ORDAX COMP', swC, [
        K('comp', 'thr', { label: tr('Порог', 'Thresh'), min: -60, max: 0, fmt: (v) => v.toFixed(0) + ' ' + tr('дБ', 'dB'), title: tr('Выше этого уровня звук начинает сжиматься', 'Above this level the sound starts to be compressed') }),
        K('comp', 'ratio', { label: tr('Степень', 'Ratio'), min: 1, max: 20, log: true, fmt: (v) => v.toFixed(1) + ':1' }),
        K('comp', 'att', { label: tr('Атака', 'Attack'), min: 0.1, max: 100, log: true, fmt: (v) => v.toFixed(1) + ' ' + tr('мс', 'ms') }),
        K('comp', 'rel', { label: tr('Спад', 'Release'), min: 10, max: 1000, log: true, fmt: (v) => v.toFixed(0) + ' ' + tr('мс', 'ms') }),
        K('comp', 'knee', { label: tr('Колено', 'Knee'), min: 0, max: 24, fmt: (v) => v.toFixed(0) + ' ' + tr('дБ', 'dB') }),
        K('comp', 'makeup', { label: tr('Усиление', 'Makeup'), min: 0, max: 24, fmt: (v) => '+' + v.toFixed(1) })], grComp),
      dcard(tr('Дэ-эссер', 'De-esser'), 'ORDAX DE-ESS', swD, [
        K('deess', 'f', { label: tr('Частота', 'Freq'), min: 3000, max: 12000, log: true, fmt: (v) => fmtHz(v), title: tr('Где живут свистящие «с» и «ш»', 'Where the sibilant “s” and “sh” live') }),
        K('deess', 'thr', { label: tr('Порог', 'Thresh'), min: -60, max: -10, fmt: (v) => v.toFixed(0) + ' ' + tr('дБ', 'dB') }),
        K('deess', 'amt', { label: tr('Подавление', 'Reduction'), min: 0, max: 18, fmt: (v) => v.toFixed(1) + ' ' + tr('дБ', 'dB') })], grDe),
      dcard(tr('Лимитер', 'Limiter'), 'ORDAX LIMIT', swL, [
        K('lim', 'gain', { label: tr('Усиление', 'Gain'), min: 0, max: 18, fmt: (v) => '+' + v.toFixed(1) + ' ' + tr('дБ', 'dB') }),
        K('lim', 'ceil', { label: tr('Потолок', 'Ceiling'), min: -12, max: 0, fmt: (v) => v.toFixed(1) + ' ' + tr('дБ', 'dB'), title: tr('Громче этого уровня звук не уйдёт', 'The sound will not go above this level') })], grLim));

    // ---------- шапка, пресеты, кнопки ----------
    const presetSel = h('select', { class: 'vxp-select', title: tr('Готовые настройки: подставят значения во все блоки', 'Ready-made settings: fill in all blocks') }, h('option', { value: '' }, tr('Пресеты…', 'Presets…')), FX_PRESETS().map(([id, name]) => h('option', { value: id }, name)));
    function refreshAll() { syncBand(); knobs.forEach((k) => k._draw()); [swC, swD, swL].forEach((s) => s._sync()); drawAll(); }
    presetSel.addEventListener('change', () => {
      const p = FX_PRESETS().find((x) => x[0] === presetSel.value); presetSel.value = ''; if (!p) return;
      const d = defFx(); fx.eq = d.eq; fx.comp = d.comp; fx.deess = d.deess; fx.lim = d.lim; p[2](fx);
      fx.eq.forEach((b) => { if (b.type === 'hp') b.g = 0; });
      refreshAll(); changed(true);
    });
    const btnReset = h('button', { class: 'vxp-btn small', type: 'button', onclick: () => { const d = defFx(); fx.eq = d.eq; fx.comp = d.comp; fx.deess = d.deess; fx.lim = d.lim; refreshAll(); changed(true); } }, tr('Сбросить всё', 'Reset all'));
    const kw = W();
    const close = () => { clearTimeout(commitTimer); player.stop(); kw.removeEventListener('keydown', onKey, true); ro.disconnect(); off(); root.remove(); };
    const onKey = (e) => {
      if (e.target && /^(input|select|textarea)$/i.test(e.target.tagName) && e.key !== 'Escape') return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); playMine(true); }
      else e.stopPropagation();
    };
    kw.addEventListener('keydown', onKey, true);
    const root = h('div', { class: 'vxp-fxs', role: 'dialog', 'aria-label': 'ORDAX FX' },
      h('div', { class: 'vxp-fxcard' },
        h('div', { class: 'vxp-fxhead' }, brandBar(true), h('b', { class: 'vxp-fxtitle' }, 'ORDAX FX'), presetSel,
          h('div', { class: 'vxp-row', style: 'margin-left:auto' },
            h('button', { class: 'vxp-btn small primary', type: 'button', title: tr('Послушать мою дорожку с обработкой (Пробел)', 'Listen to my track with processing (Space)'), onclick: () => playMine(true) }, tr('▶ С обработкой', '▶ Processed')),
            h('button', { class: 'vxp-btn small', type: 'button', title: tr('Послушать без эквалайзера и динамики', 'Listen without EQ and dynamics'), onclick: () => playMine(false) }, tr('▶ Без неё', '▶ Bypassed')),
            btnReset, h('button', { class: 'vxp-btn icon small', type: 'button', title: tr('Закрыть (Esc)', 'Close (Esc)'), onclick: close }, '✕'))),
        h('div', { class: 'vxp-eqwrap' }, cvEq), bandRow, cards,
        h('div', { class: 'vxp-hint' }, tr('Серая линия — звук до обработки, цветная заливка — после, белая — живой спектр при воспроизведении. Изменения сразу идут в дубль; кнопка «Без неё» только для сравнения.', 'Grey line — sound before processing, colored fill — after, white — live spectrum during playback. Changes go into the take right away; “Bypassed” is for comparison only.'))));
    hostDoc().body.append(root);
    const ro = new ResizeObserver(() => drawAll()); ro.observe(cvEq);
    const off = (() => { const f = () => { knobs.forEach((k) => k._draw()); drawAll(); }; bus.addEventListener('theme', f); return () => bus.removeEventListener('theme', f); })();
    // живой спектр и GR
    function drawAll() {
      if (!root.isConnected) return;
      if (st.ph != null && st.x) { try { st.live = spectrumAt(st.x, Math.floor(st.ph * st.sr) - 1024); } catch {} }
      drawEq();
      const tr_ = st.tr; let gc = 0, gd = 0, gl = 0;
      if (tr_) {
        const at = (a) => { if (!a) return 0; if (st.ph != null) { const i = Math.floor((st.ph * st.sr) / TR_STEP); let v = 0; for (let j = Math.max(0, i - 2); j <= Math.min(a.length - 1, i + 2); j++) v = Math.min(v, a[j]); return v; } let v = 0; for (const q of a) if (q < v) v = q; return v; };
        gc = at(tr_.comp); gd = at(tr_.deess); gl = at(tr_.lim);
      }
      grComp._set(gc); grDe._set(gd); grLim._set(gl);
    }
    refreshAll(); recompute();
    raf(drawAll);
    return root;
  }
  VXP.openFxStudio = openFxStudio;

  /* ================================================================== */
  /*  Студия: запись реплик заранее                                      */
  /* ================================================================== */
  let studio = null;
  /* Отдельное окно студии (одного источника с игрой — поэтому доступ к микрофону и состоянию игры общий). */
  function openStagePopup() {
    let w = null;
    try { w = window.open('', 'vxp-studio-window'); } catch {}
    if (!w) return null;
    try {
      w.document.open();
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Voxalike+ OrdaxEd — ' + tr('студия', 'studio') + '</title></head><body style="margin:0;background:#07070a;overflow:hidden"></body></html>');
      w.document.close();
      for (const id of ['vxp-style', 'vxp-theme']) { const e = qs('#' + id); if (e) w.document.head.append(e.cloneNode(true)); }
      w.focus();
    } catch { try { w.close(); } catch {} return null; }
    return w;
  }
  /* «Тишина на сайте»: пока студия открыта, глушим чужие звуки на вкладке игры. */
  const quiet = { t: 0, saved: new Map() };
  const MUTED = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
  /* Глушим по-настоящему, но «желание» сайта запоминаем: если сайт сам включил звук, пока студия была открыта,
     после закрытия возвращаем именно его выбор, а не то, что было в момент первого глушения. */
  function quietHold(m) {
    if (quiet.saved.has(m)) return;
    let want = MUTED.get.call(m);
    try { Object.defineProperty(m, 'muted', { configurable: true, get() { return want; }, set(v) { want = !!v; } }); } catch { quiet.saved.set(m, { get: () => want, own: false }); MUTED.set.call(m, true); return; }
    quiet.saved.set(m, { get: () => want, own: true });
    MUTED.set.call(m, true);
  }
  function quietOn() {
    if (quiet.t || !settings.quietSite) return;
    const sweep = () => { for (const m of qsa('audio,video')) { if (m.closest('.vxp-studio,.vxp-panel,.vxp-fxs')) continue; quietHold(m); MUTED.set.call(m, true); } };
    sweep(); quiet.t = setInterval(sweep, 300);
  }
  function quietOff() {
    clearInterval(quiet.t); quiet.t = 0;
    for (const [m, rec] of quiet.saved) { try { if (rec.own) delete m.muted; MUTED.set.call(m, !!rec.get()); } catch {} }
    quiet.saved.clear();
  }
  VXP._quiet = { on: quietOn, off: quietOff };
  function openStudio(index, opts) {
    syncRoomFromApp();
    const g = room.state && room.state.game, pack = app.pack();
    if (!g) return toast(tr('Игра ещё не началась', 'The game hasn\'t started yet'), 'err');
    if (!pack) return toast(tr('Мод с клипами не загружен на этой странице', 'Clip data isn\'t loaded on this page'), 'err');
    if (studio) studio.close();
    const want = false; // отдельная вкладка отключена по просьбе пользователя
    let popup = null;
    if (want) {
      popup = openStagePopup();
      if (!popup) toast(tr('Браузер заблокировал новую вкладку — разрешите всплывающие окна для сайта. Открываю прямо на странице.', 'The browser blocked the new tab — allow pop-ups for this site. Opening in the page instead.'), 'err');
    }
    stageWin = popup;
    studio = new Studio(pack, popup);
    quietOn();
    studio.select(index != null ? index : (myLines()[0] || {}).index);
  }
  VXP.openStudio = openStudio;

  function studioSec(id, title, ...kids) {
    const key = 'st_' + id;
    const sec = h('div', { class: 'vxp-sec' + (settings.collapsed[key] ? ' collapsed' : '') });
    sec.append(h('div', { class: 'vxp-title', onclick: () => { settings.collapsed[key] = !settings.collapsed[key]; sec.classList.toggle('collapsed', settings.collapsed[key]); saveSettings(); } },
      h('span', null, title), h('span', { class: 'vxp-caret' }, '▾')), ...kids);
    return sec;
  }

  class Studio {
    constructor(pack, popup) {
      this.popup = popup || null; this.doc = popup ? popup.document : document;
      this.pack = pack; this.index = null; this.clip = null; this.ref = null; this.model = null; this.rec = null; this.dirty = false;
      this.saving = false; this.starting = false;
      this.video = h('video', { playsinline: true, preload: 'auto' });
      this.video.muted = true;
      this.backing = pack.backingTrackUrl ? h('audio', { preload: 'auto', src: pack.backingTrackUrl }) : null;
      this.guideEl = h('audio', { preload: 'auto' });
      this.cue = h('div', { class: 'vxp-cue' });
      this.videoBox = h('div', { class: 'vxp-video' }, this.video, this.cue);
      this.subSpeaker = h('span'); this.subText = h('p');
      this.editor = new TrackEditor({
        onChange: () => { if (this.model) this.dirty = true; },
        onPlay: () => this.playMine(true),
      });
      this.editor.canvas.classList.add('big');
      
      this.btnRecord = h('button', { class: 'vxp-btn rec wide big', title: tr('Запись / стоп (клавиша R)', 'Record / stop (R key)'), type: 'button', onclick: () => this.doRecord(false) }, tr('● Записать', '● Record'));
      this.btnRerecord = h('button', { class: 'vxp-btn wide big', title: tr('Перезаписать реплику с начала (Shift+R)', 'Re-record the line from the start (Shift+R)'), type: 'button', onclick: () => this.doRecord(true) }, tr('⟲ Перезаписать', '⟲ Re-record'));
      
      this.btnOrig = h('button', { class: 'vxp-btn', type: 'button', onclick: () => this.playOriginal() }, tr('▶ Оригинал', '▶ Original'));
      this.btnMine = h('button', { class: 'vxp-btn', type: 'button', onclick: () => this.playMine(false) }, tr('▶ Моя запись', '▶ My take'));
      
      this.punchInfo = h('span', { class: 'vxp-hint', style: 'align-self:center' });
      this.punchRow = h('div', { class: 'vxp-row', style: 'align-items:center;flex-wrap:wrap;justify-content:center' }, this.btnRecord, this.btnRerecord, this.punchInfo,
        checkbox({ label: tr('Заменять то, что под записью', 'Replace what is under the recording'), get: () => settings.punchReplace, set: (v) => { settings.punchReplace = v; saveSettings(); }, title: tr('Вкл — старый звук под новым куском вырезается; выкл — новый кусок накладывается сверху', 'On — the old sound under the new piece is cut out; off — the new piece is layered on top') }));
      
      this.editor.onMarker = () => this.updateButtons();
      this.btnSave = h('button', { class: 'vxp-btn primary wide big', title: tr('Отправить в очередь и перейти к следующей реплике (Enter)', 'Queue it and go to the next line (Enter)'), type: 'button', onclick: () => this.save(true) }, tr('✓ Сохранить → далее', '✓ Save → next'));
      this.btnDel = h('button', { class: 'vxp-btn', type: 'button', title: tr('Удалить из очереди', 'Remove from queue'), onclick: () => this.remove() }, '🗑');
      this.title = h('h3'); this.kicker = h('small');
      this.stepEls = [tr('Запиши', 'Record'), tr('Послушай', 'Listen'), tr('Сохрани', 'Save')].map((t, i) => h('div', { class: 'vxp-step' }, h('b', null, String(i + 1)), t));
      this.steps = h('div', { class: 'vxp-steps' }, ...this.stepEls);
      this.btnPrev = h('button', { class: 'vxp-btn', type: 'button', title: tr('Предыдущая моя реплика', 'Previous line of mine'), onclick: () => this.go(-1) }, tr('◀ Назад', '◀ Prev'));
      this.btnNext = h('button', { class: 'vxp-btn', type: 'button', title: tr('Следующая моя реплика', 'Next line of mine'), onclick: () => this.go(1) }, tr('Дальше ▶', 'Next ▶'));
      this.navMid = h('div', { class: 'vxp-navmid' });
      this.navRow = h('div', { class: 'vxp-navrow' }, this.btnPrev, this.navMid, this.btnNext);
      this.list = h('div', { class: 'vxp-lines' });
      const guide = checkbox({ label: tr('Слушать оригинал при записи', 'Hear the original while recording'), get: () => settings.studioGuide, set: (v) => { settings.studioGuide = v; saveSettings(); }, title: 'Нужны наушники' });
      const fx = fxControls(() => this.model ? { model: this.model, apply: () => { this.dirty = true; this.refreshEditor(); } } : null);
      this.root = h('div', { class: 'vxp-studio', role: 'dialog', 'aria-label': tr('Запись реплик заранее', 'Record lines in advance') },
        h('div', { class: 'vxp-card' },
          h('div', { class: 'vxp-card-head' },
            h('div', null, brandBar(true), this.kicker, this.title),
            h('div', { class: 'vxp-row' },
              h('button', { class: 'vxp-btn icon', type: 'button', title: tr('Закрыть (Esc)', 'Close (Esc)'), onclick: () => this.close() }, '✕'))),
          h('div', { class: 'vxp-stagebox' },
            this.navRow,
            this.videoBox,
            h('div', { class: 'vxp-sub' }, this.subSpeaker, this.subText),
            this.steps,
            this.editor.root,
            h('div', { class: 'vxp-row' }, this.btnOrig, this.btnMine),
            this.punchRow,
            h('div', { class: 'vxp-row' }, this.btnSave, this.btnDel),
            h('div', { class: 'vxp-hint', title: tr('Горячие клавиши', 'Hotkeys') }, tr('Клавиши: R — запись/стоп · Shift+R — перезапись · Пробел — моя запись · Enter — сохранить и далее · [ ] — сдвиг · A — авто · Esc — закрыть', 'Keys: R — record/stop · Shift+R — re-record · Space — my take · Enter — save and next · [ ] — shift · A — auto · Esc — close'))),
          h('div', { class: 'vxp-side' },
            h('div', { class: 'vxp-sec' }, h('div', { class: 'vxp-title' }, h('span', null, tr('Мои реплики', 'My lines'))), this.list),
            h('div', { class: 'vxp-sec' }, h('div', { class: 'vxp-title' }, h('span', null, tr('Обработка', 'Processing'))), fx),
            studioSec('rec', tr('Запись', 'Recording'), micControls(), guide, timingControls()),
            studioSec('nr', tr('Шумодав', 'Noise suppression'), nrControls()),
            studioSec('set', tr('Настройки', 'Settings'),
              checkbox({ label: tr('Тишина на сайте, пока студия открыта', 'Silence the site while the studio is open'), get: () => settings.quietSite, set: (v) => { settings.quietSite = v; saveSettings(); v ? quietOn() : quietOff(); }, title: tr('Глушит чужие аудио и видео на вкладке игры (звук из игры через Web Audio не затрагивается)', 'Mutes other audio/video on the game tab (Web Audio output of the game is not affected)') }),
              themeControl(), langControl()),
            h('div', { class: 'vxp-sec' }, h('div', { class: 'vxp-hint' },
              tr('Записанные реплики ждут в очереди и отправляются сами, как только подходит ваш ход. Очередь сохраняется на диск и переживает F5, но вкладку лучше не закрывать до конца игры.', 'Recorded lines wait in the queue and are sent automatically when your turn comes. The queue is kept on disk and survives F5, but keep the tab open until the game ends.'))))));
      this.keyHandler = (e) => this.onKey(e);
      this.doc.addEventListener('keydown', this.keyHandler, true);
      this.doc.body.append(this.root);
      if (this.popup) {
        this.themeSync = setInterval(() => { try { const a = qs('#vxp-theme'), b = this.doc.getElementById('vxp-theme'); if (a && b && b.textContent !== a.textContent) b.textContent = a.textContent; } catch {} }, 400);
        this.popup.addEventListener('pagehide', () => { if (studio === this && !this.closing) this.close(); });
        this.popup.addEventListener('focus', () => {});
      }
      this.renderList();
    }
    moveTo(popout) {
      const idx = this.index;
      if (this.dirty && this.model) this.save(false);
      this.close();
      openStudio(idx, { popout });
    }
    close() {
      if (this.closing) return; this.closing = true;
      this.stopRec(true); player.stop();
      this.saving = false; this.starting = false;
      clearInterval(this.themeSync);
      this.doc.removeEventListener('keydown', this.keyHandler, true);
      this.root.remove();
      if (studio === this) studio = null;
      if (!studio) quietOff();
      const pw = this.popup; stageWin = null;
      if (pw) { try { pw.close(); } catch {} }
      emit('queue');
    }
    onKey(e) {
      if (isTyping(e.target) || this.counting) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey, ed = this.editor;
      if (k === 'Escape' && (ed.sel.size || ed.tool !== 'move')) { ed.handleKey(e); e.preventDefault(); }
      else if (k === 'Escape') { e.preventDefault(); this.close(); }
      else if (ctrl) { if (ed.handleKey(e)) e.preventDefault(); else return; }
      else if ('rRкК'.includes(k)) { e.preventDefault(); this.doRecord(e.shiftKey); }
      else if (k === ' ') { e.preventDefault(); this.playMine(false); }
      else if (k === 'Enter') { e.preventDefault(); this.save(true); }
      else if (k === '[' || k === 'х') { e.preventDefault(); this.editor.nudge(e.shiftKey ? -50 : -10); }
      else if (k === ']' || k === 'ъ') { e.preventDefault(); this.editor.nudge(e.shiftKey ? 50 : 10); }
      else if (this.editor.handleKey(e)) { e.preventDefault(); }
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
          h('span', { class: 'n' }, '#' + (a.index + 1)), h('span', { class: 'c' }, a.caption || a.clipId), h('span', { class: 'vxp-chip ' + st }, statusText(st)));
      }));
      const done = mine.filter((a) => ['sent', 'ready'].includes(lineStatus(g, a))).length;
      this.kicker.textContent = tr('Запись заранее · готово ', 'Recording ahead · done ') + done + '/' + mine.length;
    }
    refreshEditor() { this.editor.set(this.ref, this.model); this.updateButtons(); }
    async select(index) {
      const g = room.state && room.state.game; if (!g || index == null) return;
      if (this.dirty && this.model) this.save(false);
      this.stopRec(true); player.stop();
      const a = g.assignments[index]; if (!a) return;
      this.index = index; this.assignment = a;
      this.clip = this.pack.clips.find((c) => c.id === a.clipId);
      if (!this.clip) { toast(tr('Клип ' + a.clipId + ' не найден в моде', 'Clip ' + a.clipId + ' not found in the mod'), 'err'); return; }
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
      } catch (e) { console.warn('[Voxalike+OrdaxEd] ref decode', e); }
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
      const busy = this.saving || this.starting;
      this.btnRecord.classList.toggle('live', recOn);
      this.btnRerecord.classList.toggle('live', recOn);
      { const g0 = room.state && room.state.game, queued = !!(g0 && queue.has(qKey(g0, this.index)) && !this.dirty);
        const cur = recOn || !this.model ? 0 : queued ? 3 : 1;
        this.stepEls.forEach((e, i) => { e.classList.toggle('now', i === cur); e.classList.toggle('done', i < cur || (queued && i === 2)); });
        const mine = myLines().filter((a) => lineStatus(g0, a) !== 'sent'); const pos = mine.findIndex((a) => a.index === this.index);
        this.navMid.textContent = mine.length ? tr('Реплика ', 'Line ') + (pos + 1 || '–') + ' / ' + mine.length : '';
        this.btnPrev.disabled = recOn || busy || mine.length < 2; this.btnNext.disabled = recOn || busy || mine.length < 2; }
      
      if (recOn) {
        this.btnRecord.textContent = tr('■ Стоп', '■ Stop');
        this.btnRecord.disabled = false;
        this.btnRerecord.textContent = tr('■ Стоп', '■ Stop');
        this.btnRerecord.disabled = true;
      } else {
        this.btnRecord.textContent = this.model ? tr('➕ Запись с метки', '➕ Record at marker') : tr('● Записать', '● Record');
        this.btnRecord.disabled = busy || this.counting;
        this.btnRerecord.textContent = tr('⟲ Перезаписать', '⟲ Re-record');
        this.btnRerecord.disabled = busy || this.counting || !this.model;
      }
      
      this.btnMine.disabled = recOn || busy || this.counting || !this.model;
      this.btnOrig.disabled = recOn || busy || this.counting;
      this.btnSave.disabled = recOn || busy || this.counting || !this.model;
      
      this.punchInfo.textContent = this.editor.marker == null ? tr('метка: клик/тяните линейку', 'marker: click/drag ruler') : tr('метка ', 'marker ') + this.editor.marker.toFixed(2) + tr(' с', ' s');
      
      const g = room.state && room.state.game;
      this.btnDel.disabled = recOn || busy || !(g && queue.has(qKey(g, this.index)));
    }
    playOriginal() {
      if (player.playing) return player.stop();
      const c = this.clip; if (!c) return;
      const dur = (c.videoEndSeconds || c.videoStartSeconds + this.clipDur()) - c.videoStartSeconds;
      const ed = this.editor, label = this.btnOrig.textContent;
      this.btnOrig.textContent = tr('■ Стоп', '■ Stop');
      // Звук оригинала берём из отдельных дорожек мода (vocal + backing), а не из видео:
      // в модах, где аудио вырезано из видеоряда, у <video> звука нет. Видео играет без звука.
      // Если вокальная дорожка не декодировалась — запасной вариант: звук самого видео.
      const useTracks = !!(this.ref && this.ref.samples);
      const media = [{ el: this.video, from: c.videoStartSeconds, muted: useTracks, vol: 1 }];
      if (useTracks && this.backing) media.push({ el: this.backing, from: c.videoStartSeconds, vol: 0.6 });
      const tracks = useTracks ? [{ samples: this.ref.samples, sr: this.ref.sr, startSec: 0, gain: 1 }] : [];
      player.play({ tracks, media, dur, startAt: ed.playStart(),
        onTick: (t) => { ed.playhead = t; ed.draw(); },
        onEnd: () => { ed.playhead = null; ed.draw(); this.btnOrig.textContent = tr('▶ Оригинал', '▶ Original'); this.video.pause(); this.video.muted = true; try { this.video.currentTime = c.videoStartSeconds; } catch {} } });
    }
    playMine(withRef) {
      if (player.playing) { player.stop(); return; }
      if (!this.model) return;
      const startAt = this.editor.playStart();
      const c = this.clip, ed = this.editor, out = renderModel(this.model);
      const dur = Math.max(out.length / this.model.sr, (c.videoEndSeconds || 0) - c.videoStartSeconds);
      const media = [{ el: this.video, from: c.videoStartSeconds, muted: true }];
      if (!withRef && this.backing) media.push({ el: this.backing, from: c.videoStartSeconds, vol: 0.6 });
      const tracks = [{ samples: out, sr: this.model.sr, startSec: 0, gain: 1 }];
      if (withRef && this.ref) tracks.push({ samples: this.ref.samples, sr: this.ref.sr, startSec: 0, gain: 0.55 });
      ed.setPlaying(withRef);
      this.btnMine.textContent = withRef ? tr('▶ Моя запись', '▶ My take') : tr('■ Стоп', '■ Stop');
      player.play({ tracks, media, dur, startAt,
        onTick: (t) => { ed.playhead = t; ed.draw(); },
        onEnd: () => { ed.playhead = null; ed.setPlaying(false); ed.draw(); this.btnMine.textContent = tr('▶ Моя запись', '▶ My take'); this.video.pause(); try { this.video.currentTime = c.videoStartSeconds; } catch {} } });
    }
    async doRecord(isRerecord) {
      if (this.counting || this.starting || this.saving) return;
      if (this.rec) { this.stopRec(false); return; }
      this.starting = true;
      this.updateButtons();
      try {
        if (isRerecord) {
          await this.startRec(null);
        } else {
          if (!this.model) {
            await this.startRec(null);
          } else {
            const ed = this.editor;
            if (ed.marker == null) {
              this.starting = false;
              this.updateButtons();
              return toast(tr('Поставьте метку на линейке, чтобы дозаписать', 'Set a marker on the ruler to punch-in'), 'warn');
            }
            const pos = clamp(ed.marker - this.model.params.offset / 1000, 0, Math.max(0, this.clipDur() - 0.1));
            await this.startRec(pos);
          }
        }
      } finally {
        this.starting = false;
        this.updateButtons();
      }
    }
    async startRec(punchPos) {
      if (!this.clip) return;
      player.stop();
      let track;
      try {
        const m = app.mic();
        const gameTrack = m && m.stream && m.stream.getAudioTracks && m.stream.getAudioTracks()[0];
        if (gameTrack && gameTrack.readyState === 'live') {
          track = gameTrack.clone();
        } else {
          const dev = app.mic(); const id = dev && dev.selectedDeviceId;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id && id !== 'default' ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
          track = stream.getAudioTracks()[0];
        }
      } catch (e) { toast(tr('Микрофон недоступен: ', 'Microphone unavailable: ') + e.message, 'err'); return; }
      let cap;
      try { cap = await Capture.open(track, { noMonitor: false }); } catch (e) { track.stop(); toast(tr('Не удалось начать запись: ', 'Could not start recording: ') + e.message, 'err'); return; }
      const c = this.clip, dur = this.clipDur(), C = settings.countdown, vOff = punchPos != null ? punchPos : 0, start = (c.videoStartSeconds || 0) + vOff;
      const rec = this.rec = { cap, videoCtx: null, timers: [], punch: punchPos != null, punchPos, vOff };
      const winEndTL = dur + 0.4, winEnd = Math.max(0.5, winEndTL - vOff);
      const plannedPerf = performance.now() + C * 1000;
      const liveT0 = () => (cap.startCtx == null ? vOff : vOff + cap.startCtx - (rec.videoCtx != null ? rec.videoCtx : cap.perfToCtx(plannedPerf)));
      cap.onData = () => this.editor.setLive({ buf: cap.buf, len: cap.len, sr: cap.sr, t0: liveT0(), winEnd: winEndTL });
      this.editor.setLive({ buf: cap.buf, len: 0, sr: cap.sr, t0: vOff - C, winEnd: winEndTL });
      this.updateButtons();
      this.video.muted = true;
      // предпрокрутка видео во время отсчёта
      const from = Math.max(0, start - C), delay = Math.max(0, C - (start - from));
      try { this.video.currentTime = from; } catch {}
      const mark = (perf) => {
        if (rec.videoCtx != null || this.rec !== rec) return;
        rec.videoCtx = cap.perfToCtx(perf);
        this.cue.className = 'vxp-cue on rec'; this.cue.textContent = tr('● ЗАПИСЬ', '● REC');
        if (settings.studioGuide && c.audioUrl) { this.guideEl.currentTime = vOff; this.guideEl.volume = settings.guideVol; this.guideEl.play().catch(() => {}); }
        const tail = settings.tailSec;
        rec.timers.push(wst(() => {
          if (this.rec !== rec) return;
          if (!tail) return this.stopRec(false);
          const tEnd = performance.now() + tail * 1000;
          this.cue.className = 'vxp-cue on tail';
          const upd = () => { if (this.rec !== rec) return; const s = Math.ceil((tEnd - performance.now()) / 1000); this.cue.textContent = tr('● БУФЕР ', '● BUFFER ') + s + tr(' с · R — стоп', ' s · R — stop'); if (s > 0) rec.timers.push(wst(upd, 250)); };
          upd();
          rec.timers.push(wst(() => this.stopRec(false), tail * 1000));
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
          rec.timers.push(wst(() => mark(p + Math.max(0, start - t) * 1000), Math.max(0, (start - t) * 1000) + 120));
        }, { once: true });
      };
      rec.timers.push(wst(() => { if (this.rec !== rec) return; watchStart(); this.video.play().catch(() => {}); }, delay * 1000));
      this.counting = true;
      const ok = await countdown(C, { host: this.videoBox });
      this.counting = false;
      if (!ok) { this.stopRec(true); return; }
      if (rec.videoCtx == null && this.rec === rec) { this.cue.className = 'vxp-cue on rec'; this.cue.textContent = tr('● ЗАПИСЬ', '● REC'); }
    }
    stopRec(discard) {
      const rec = this.rec; if (!rec) return;
      this.rec = null;
      if (!discard) this.saving = true;
      rec.timers.forEach(wct);
      rec.cap.onData = null; // последний кусок после остановки не должен включать живой режим
      this.video.pause(); this.guideEl.pause();
      this.cue.className = 'vxp-cue';
      this.editor.setLive(null);
      this.updateButtons();
      rec.cap.stop().then((res) => {
        if (!discard) this.saving = false;
        if (this.rec !== null) return; // если началась новая запись, игнорируем старую
        if (discard || rec.videoCtx == null || res.startCtx == null || !res.samples.length) {
          if (!discard && rec.videoCtx == null) toast(tr('Запись отменена (слишком рано остановлена)', 'Recording cancelled (stopped too early)'), 'warn');
          this.refreshEditor(); return;
        }
        if (rec.punch && this.model) { this.punchMerge(res, rec); return; }
        const fx = settings.fx;
        this.model = {
          base: normalizeTake(res.samples), sr: res.sr, t0: res.startCtx - rec.videoCtx,
          outLen: Math.round((this.clipDur() + 0.4) * res.sr),
          params: defaultParams(),
        };
        initSegs(this.model);
        this.dirty = true;
        this.refreshEditor();
        try { this.video.currentTime = this.clip.videoStartSeconds; } catch {}
      });
    }
    punchMerge(res, rec) {
      const m = this.model, ed = this.editor, sr = m.sr;
      if (res.sr !== sr) { toast(tr('Частота записи не совпала с дублем — дозапись отменена', 'Sample rate differs from the take — punch-in cancelled'), 'err'); this.refreshEditor(); return; }
      const pos0 = (res.startCtx - rec.videoCtx) + rec.vOff;
      const idx = Math.max(0, Math.round((rec.punchPos - pos0) * sr));
      const nw = normalizeTake(res.samples).subarray(idx);
      if (nw.length < sr * 0.05) { toast(tr('Дозапись слишком короткая', 'The punch-in is too short'), 'err'); this.refreshEditor(); return; }
      if (peakOf(nw) < 0.005) { toast(tr('Дозапись пустая: микрофон молчит', 'Punch-in is empty: mic is silent'), 'err'); this.refreshEditor(); return; }
      ed.pushHist();
      const old = m.base, base = new Float32Array(old.length + nw.length);
      base.set(old); base.set(nw, old.length);
      m.base = base;
      ensureSegs(m);
      const pos = pos0 + idx / sr, dur = nw.length / sr / (m.params.speed || 1);
      if (settings.punchReplace) m.segs = carveSegs(m, pos, pos + dur);
      const seg = { id: segSeq++, a: old.length, b: base.length, pos };
      m.segs.push(seg);
      ed.sel.clear(); ed.sel.add(seg.id);
      this.dirty = true;
      this.refreshEditor();
      toast(tr('Дозапись вставлена в дубль', 'Punch-in added to the take'));
      try { this.video.currentTime = this.clip.videoStartSeconds; } catch {}
    }
    save(next) {
      const g = room.state && room.state.game;
      if (!g || !this.model || this.index == null) return;
      if (g.takes.some((t) => t.assignmentIndex === this.index)) { toast(tr('Эта реплика уже отправлена', 'This line has already been sent'), 'err'); return; }
      { const key = qKey(g, this.index), q = { index: this.index, clipId: this.assignment.clipId, model: this.model, status: 'ready', savedAt: Date.now() };
        queue.set(key, q); qdb.put(key, q, g).then((ok) => { if (ok === null && !qdb.warned) { qdb.warned = true; toast(tr('Браузер не даёт сохранить очередь на диск — после F5 она пропадёт', 'The browser won\'t store the queue on disk — it will be lost on F5'), 'err'); } }); }
      this.dirty = false;
      emit('queue');
      trySubmit();
      if (!next) return;
      toast(tr('Реплика #' + (this.index + 1) + ' в очереди', 'Line #' + (this.index + 1) + ' queued'));
      const mine = myLines().filter((a) => ['todo', 'now'].includes(lineStatus(g, a)) && a.index !== this.index);
      const nxt = mine.find((a) => a.index > this.index) || mine[0];
      if (nxt) this.select(nxt.index); else { toast(tr('Все ваши реплики готовы — ждём остальных 🎉', 'All your lines are ready — waiting for the others 🎉')); this.close(); }
    }
    go(dir) {
      const g = room.state && room.state.game; if (!g || this.rec || this.saving || this.starting) return;
      const mine = myLines().filter((a) => lineStatus(g, a) !== 'sent'); if (mine.length < 2) return;
      const pos = mine.findIndex((a) => a.index === this.index);
      this.select(mine[(pos + dir + mine.length) % mine.length].index);
    }
    remove() {
      const g = room.state && room.state.game; if (!g) return;
      queue.delete(qKey(g, this.index)); persistDel(qKey(g, this.index));
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
    if (e.key === '[' || e.key === 'х') { ed.nudge(e.shiftKey ? -50 : -10); e.preventDefault(); }
    else if (e.key === ']' || e.key === 'ъ') { ed.nudge(e.shiftKey ? 50 : 10); e.preventDefault(); }
  }, true);

  /* ================================================================== */
  /*  Статистика мультиплеера игроков в лобби                            */
  /* ================================================================== */
  /* Берём id игрока из аватарки карточки (/auth/avatar/usr_…), читаем публичную страницу профиля
     (/workshop/creators/usr_…) и ставим рядом с ником значки: Co-op и PvP. Результат кешируется. */
  const PS_TTL = 10 * 60 * 1000;
  const psCache = new Map(), psQueue = [];
  let psBusy = false;
  const RX = {
    head: /multiplayer stats|статистика мультиплеера/i,
    coopGames: /completed games|заверш[её]нные игры/i,
    coopAvg: /average line score|средняя оценка реплик/i,
    pvpAvg: /average battle score|средний боевой балл/i,
    val: /^(\d+(?:[.,]\d+)?|[—–-])$/,
  };
  function parseProfile(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const leaves = [];
    const walk = (el) => {
      if (!el.children.length) { const t = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (t) leaves.push(t); return; }
      for (const n of el.childNodes) { if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, ' ').trim(); if (t) leaves.push(t); } else if (n.nodeType === 1 && !/^(script|style|noscript)$/i.test(n.tagName)) walk(n); }
    };
    walk(doc.body || doc.documentElement);
    let from = leaves.findIndex((t) => RX.head.test(t)); if (from < 0) from = 0;
    const val = (i) => { for (let k = i + 1; k < Math.min(leaves.length, i + 4); k++) if (RX.val.test(leaves[k])) return leaves[k]; return null; };
    const conv = (v) => (v == null ? null : /^[—–-]$/.test(v) ? 0 : +v.replace(',', '.'));
    const games = [], out = { coopGames: null, coopAvg: null, pvpGames: null, pvpAvg: null };
    for (let i = from; i < leaves.length; i++) {
      const t = leaves[i];
      if (RX.coopGames.test(t)) games.push(conv(val(i)));
      else if (RX.coopAvg.test(t) && out.coopAvg == null) out.coopAvg = val(i);
      else if (RX.pvpAvg.test(t) && out.pvpAvg == null) out.pvpAvg = val(i);
    }
    out.coopGames = games[0] == null ? null : games[0]; out.pvpGames = games[1] == null ? null : games[1];
    if (out.coopGames == null && out.pvpGames == null && out.coopAvg == null && out.pvpAvg == null) return null;
    return out;
  }
  async function psLoad(id) {
    const r = await origFetch.call(window, '/workshop/creators/' + encodeURIComponent(id), { credentials: 'same-origin', headers: { accept: 'text/html' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return parseProfile(await r.text());
  }
  function psGet(id, cb) {
    const c = psCache.get(id);
    if (c && (c.data || c.err) && Date.now() - c.t < (c.err ? 60000 : PS_TTL)) return cb(c);
    if (c && c.pending) { c.cbs.push(cb); return; }
    const e = { pending: true, cbs: [cb], t: Date.now() }; psCache.set(id, e);
    psQueue.push(id); psPump();
  }
  async function psPump() {
    if (psBusy) return; psBusy = true;
    while (psQueue.length) {
      const id = psQueue.shift(), e = psCache.get(id);
      try { e.data = await psLoad(id); e.err = e.data ? null : 'parse'; } catch (x) { e.data = null; e.err = String(x.message || x); }
      e.pending = false; e.t = Date.now();
      const cbs = e.cbs.splice(0); cbs.forEach((f) => { try { f(e); } catch {} });
      await sleep(250);
    }
    psBusy = false;
  }
  const fmtAvg = (v) => (v == null || /^[—–-]$/.test(String(v)) ? '—' : String(v).replace(',', '.'));
  const avgCls = (v) => { const n = parseFloat(v); return isNaN(n) ? 'x' : n >= 85 ? 'g' : n >= 70 ? '' : 'w'; };
  function psRender(box, e) {
    box.textContent = '';
    box.classList.toggle('load', !!e.pending);
    if (e.pending) { box.append(h('span', null, '…')); return; }
    const d = e.data;
    if (!d) { box.append(h('span', { class: 'x', title: tr('Не удалось получить статистику: ', 'Could not get the stats: ') + (e.err || '') }, tr('статистика недоступна', 'stats unavailable'))); return; }
    box.append(
      h('span', { class: avgCls(d.coopAvg), title: tr('Co-op: завершённые игры · средняя оценка реплик', 'Co-op: completed games · average line score') }, h('em', null, 'Co-op'), h('b', null, d.coopGames == null ? '—' : d.coopGames), '·', h('b', null, '★ ' + fmtAvg(d.coopAvg))),
      h('span', { class: avgCls(d.pvpAvg), title: tr('PvP: завершённые игры · средний боевой балл', 'PvP: completed games · average battle score') }, h('em', null, 'PvP'), h('b', null, d.pvpGames == null ? '—' : d.pvpGames), '·', h('b', null, '★ ' + fmtAvg(d.pvpAvg))));
  }
  const AV = 'a[href*="/workshop/creators/usr_"] img, img[src*="/auth/avatar/usr_"]';
  const AVID = (img) => { const a = img.closest('a[href*="/workshop/creators/usr_"]'); const m = /usr_[\w-]+/.exec((a && a.getAttribute('href')) || img.getAttribute('src') || ''); return m ? m[0] : null; };
  const cardCtxs = [], cardHooks = [];
  function psEnsureBox(ctx) {
    if (!settings.lobbyStats) { if (ctx.box) { ctx.box.remove(); ctx.box = null; } return; }
    if (ctx.box && ctx.box.isConnected) return;
    const box = h('div', { class: 'vxp-pst', 'data-id': ctx.id });
    try { const cs = getComputedStyle(ctx.host); if (cs.display.includes('flex') && cs.flexDirection.startsWith('row')) { ctx.host.style.flexWrap = 'wrap'; box.style.flex = '0 0 100%'; } } catch {}
    ctx.host.append(box); ctx.box = box;
    psRender(box, { pending: true });
    psGet(ctx.id, (e) => { if (box.isConnected) psRender(box, e); });
  }
  function psScan() {
    if (document.hidden || /^\/workshop\/creators\//.test(location.pathname)) return;
    for (let k = cardCtxs.length - 1; k >= 0; k--) if (!cardCtxs[k].host.isConnected) cardCtxs.splice(k, 1);
    for (const img of qsa(AV)) {
      if (img.closest('.vxp-studio,.vxp-panel,.vxp-fxs')) continue;
      const id = AVID(img); if (!id) continue;
      const w = img.getBoundingClientRect().width; if (w < 36) continue;
      const old = img._vxpCtx;
      if (old && old.slot.isConnected && old.id === id) { psEnsureBox(old); continue; }
      // верхний предок, в котором только эта картинка и нет текста (ссылка-аватарка, обёртка)
      let wrap = img;
      while (wrap.parentElement && wrap.parentElement !== document.body && qsa(AV, wrap.parentElement).length === 1 && !(wrap.parentElement.textContent || '').trim()) wrap = wrap.parentElement;
      let host = wrap.nextElementSibling && (wrap.nextElementSibling.textContent || '').trim() ? wrap.nextElementSibling : wrap.parentElement;
      if (!host || (host.textContent || '').trim().length > 120 || qsa(AV, host).length > 1) continue;
      qsa('.vxp-pst,.vxp-slot', host).forEach((x) => x.remove());
      const slot = h('div', { class: 'vxp-slot' });
      host.append(slot);
      const ctx = { id, img, host, slot, box: null, card: (host.parentElement && host.parentElement.closest('article,[class*="player-card"]')) || host.parentElement };
      try { const cs = getComputedStyle(host); if (cs.display.includes('flex') && cs.flexDirection.startsWith('row')) { host.style.flexWrap = 'wrap'; slot.style.flex = '0 0 100%'; } } catch {}
      img._vxpCtx = ctx; cardCtxs.push(ctx);
      psEnsureBox(ctx);
      for (const f of cardHooks) { try { f(ctx); } catch (e) { console.warn('[Voxalike+OrdaxEd] module', e); } }
    }
  }
  setInterval(() => { try { psScan(); } catch (e) { console.warn('[Voxalike+OrdaxEd] stats', e); } }, 1500);
  VXP.pstats = { cache: psCache, parse: parseProfile, scan: psScan };

  /* ================================================================== */
  /*  Разъём для модулей (отдельные файлы, например vxp-fx.js)        */
  /* ================================================================== */
  /* Модуль подключается отдельным скриптом в том же окружении, что и основной файл.
     Порядок загрузки не важен: если модуль пришёл раньше, он ждёт в window.__VXP_PLUGINS__. */
  VXP.modules = {}; VXP.settingsExtras = []; VXP.fxExtras = [];
  VXP.api = {
    version: VERSION, h, tr, qs, qsa, toast, settings, saveSettings, checkbox, onBus, emit,
    fetch: (...a) => origFetch.apply(window, a),
    /** cb({id, host, slot, card, img}) — для каждой карточки игрока в лобби (и для уже найденных). slot — свободный блок под ник. */
    onPlayerCard(cb) { cardHooks.push(cb); for (const c of cardCtxs) { try { cb(c); } catch (e) { console.warn('[Voxalike+OrdaxEd] module', e); } } },
    /** fn() → элемент для раздела «Настройки» панели. */
    addSettings(fn) { VXP.settingsExtras.push(fn); },
    slider, syncWidgets, widgets, hostDoc, dsp: VXP.dsp,
    /** {id, build(ctx) → элемент}: блок в панели «Обработка» (ctx: commit(), ab(patch)). */
    addFxExtra(e) { VXP.fxExtras.push(e); for (const hst of fxExtraHosts) { if (!hst.isConnected) { fxExtraHosts.delete(hst); continue; } hst._fill(); } },
  };
  VXP.registerModule = (name, init) => {
    if (VXP.modules[name]) return;
    VXP.modules[name] = { name, at: Date.now() };
    try { init(VXP.api); } catch (e) { VXP.modules[name].error = String(e && e.message || e); console.warn('[Voxalike+OrdaxEd] module ' + name, e); }
  };
  for (const m of (window.__VXP_PLUGINS__ || [])) VXP.registerModule(m.name, m.init);

  console.info('%cVoxalike+OrdaxEd ' + VERSION + ' loaded', 'color:#ff5a00;font-weight:bold');
})();