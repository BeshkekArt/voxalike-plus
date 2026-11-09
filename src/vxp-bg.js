/*!
 * Voxalike+OrdaxEd — модуль «Свои фоны» 1.2.3
 * Отдельный файл: подключается к основному моду (vxp-main.js) и работает только вместе с ним.
 * Свои картинки на фон сайта: галерея с предпросмотром, подгонка под экран,
 * затемнение (в том числе по мере прокрутки), прозрачность интерфейса.
 * Картинки хранятся в самом браузере (IndexedDB) и никуда не отправляются.
 */
(() => {
  'use strict';
  const NAME = 'bg', VERSION = '1.3.3';
  const KEY = 'vxp-bg:v1';
  const EXT = /\.(jpe?g|png|webp|avif|gif|bmp)$/i;
  const MAX_BYTES = 40 * 1024 * 1024;

  const init = (api) => {
    const { h, tr, checkbox } = api;
    const DEF = { enabled: true, current: '', mode: 'auto', dim: 20, dimScroll: 50, ui: 0, blur: 0 };
    const st = Object.assign({}, DEF);
    try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
    const num = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
    st.dim = num(st.dim, 0, 90, DEF.dim); st.dimScroll = num(st.dimScroll, 0, 90, DEF.dimScroll);
    st.ui = num(st.ui, 0, 90, 0); st.blur = num(st.blur, 0, 24, 0);
    if (!['auto', 'cover', 'fit', 'stretch'].includes(st.mode)) st.mode = 'auto';

    /* ---------- хранилище (IndexedDB) ---------- */
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('vxp-bg', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('imgs', { keyPath: 'id' }); d.createObjectStore('meta'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); let out; try { out = fn(s); } catch (e) { rej(e); return; } t.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
    const dbAll = () => tx('imgs', 'readonly', (s) => s.getAll()).then((r) => r || []);
    const dbGet = (id) => tx('imgs', 'readonly', (s) => s.get(id));
    const dbPut = (rec) => tx('imgs', 'readwrite', (s) => s.put(rec));
    const dbDel = (id) => tx('imgs', 'readwrite', (s) => s.delete(id));
    const metaGet = (k) => tx('meta', 'readonly', (s) => s.get(k));
    const metaPut = (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k));

    let items = [];              // [{id,name,w,h,added,src,thumbUrl,...}]
    const urls = new Map();      // id -> {full, thumb}
    const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const itemUrl = (it, kind) => { const u = urls.get(it.id) || {}; if (!u[kind]) { const b = kind === 'thumb' ? it.thumb : it.blob; if (b) u[kind] = URL.createObjectURL(b); urls.set(it.id, u); } return u[kind] || ''; };
    const freeUrls = (id) => { const u = urls.get(id); if (u) { for (const k of ['full', 'thumb']) if (u[k]) URL.revokeObjectURL(u[k]); urls.delete(id); } };
    function rebind() {
      if (!st.current || items.some((x) => x.id === st.current)) return;
      const m = st.currentName && items.find((x) => x.name === st.currentName);
      st.current = m ? m.id : ''; save();
    }
    async function reload() { items = (await dbAll()).sort((a, b) => b.added - a.added); rebind(); }

    async function makeThumb(blob) {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width, hgt = bmp.height, tw = 320, th = 180;
      const c = document.createElement('canvas'); c.width = tw; c.height = th;
      const g = c.getContext('2d'); const k = Math.max(tw / w, th / hgt);
      g.drawImage(bmp, (tw - w * k) / 2, (th - hgt * k) / 2, w * k, hgt * k);
      try { bmp.close(); } catch {}
      const thumb = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
      return { w, h: hgt, thumb };
    }
    async function addBlob(blob, name, src, extra) {
      if (!blob || blob.size > MAX_BYTES) throw new Error(tr('файл больше 40 МБ', 'file is larger than 40 MB'));
      const t = await makeThumb(blob);
      const rec = Object.assign({ id: uid(), name: String(name || 'image').slice(0, 120), blob, thumb: t.thumb, w: t.w, h: t.h, added: Date.now(), src: src || 'upload' }, extra || {});
      await dbPut(rec); return rec;
    }
    async function addFiles(files) {
      let ok = 0, bad = 0;
      for (const f of [...files]) {
        if (!(f.type || '').startsWith('image/') && !EXT.test(f.name || '')) { bad++; continue; }
        try { await addBlob(f, f.name, 'upload'); ok++; } catch (e) { bad++; console.warn('[Voxalike+OrdaxEd] bg add', e); }
      }
      await reload(); renderGrid();
      if (ok) api.toast(tr('Фонов добавлено: ', 'Backgrounds added: ') + ok);
      if (bad) api.toast(tr('Не удалось добавить файлов: ', 'Could not add files: ') + bad, 'warn');
      return ok;
    }

    /* ---------- слой фона ---------- */
    let root = null, layers = [], shade = null, front = 0, shownId = '';
    function ensureRoot() {
      if (root && root.isConnected) return;
      if (!document.getElementById('vxp-bgf')) { // фильтр «чёрное → прозрачное» для больших картинок сайта с чёрным фоном
        const f = document.createElement('div'); f.id = 'vxp-bgf'; f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
        f.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><filter id="vxp-keyblack" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  6 6 6 0 -0.15"/></filter></svg>';
        (document.body || document.documentElement).append(f);
      }
      const mk = () => h('div', { class: 'vxp-bgl' }, h('div', { class: 'fill' }), h('div', { class: 'fit' }));
      layers = [mk(), mk()]; shade = h('div', { class: 'vxp-bgshade' });
      root = h('div', { id: 'vxp-bg', 'aria-hidden': 'true' }, layers[0], layers[1], shade);
      (document.body || document.documentElement).prepend(root);
    }
    function paint(layer, it) {
      const url = itemUrl(it, 'full'); const f = layer.querySelector('.fill'), t = layer.querySelector('.fit');
      const sr = innerWidth / Math.max(1, innerHeight), ar = it.w / Math.max(1, it.h);
      let mode = st.mode; if (mode === 'auto') mode = ar / sr > 0.72 && ar / sr < 1.45 ? 'cover' : 'fit';
      f.style.backgroundImage = mode === 'fit' ? 'url("' + url + '")' : 'none';
      t.style.backgroundImage = 'url("' + url + '")';
      t.style.backgroundSize = mode === 'cover' ? 'cover' : mode === 'fit' ? 'contain' : '100% 100%';
      layer.dataset.id = it.id; layer.dataset.mode = mode;
    }
    function show(it) {
      ensureRoot();
      const on = !!(it && st.enabled);
      document.documentElement.classList.toggle('vxp-bgon', on);
      if (!on) { root.classList.remove('on'); shownId = ''; scanSoon(); return; }
      if (shownId === it.id && layers[front].dataset.mode) { repaintMode(); root.classList.add('on'); return; }
      const next = 1 - front; paint(layers[next], it);
      layers[next].classList.add('vis'); layers[front].classList.remove('vis'); front = next; shownId = it.id;
      root.classList.add('on'); scanSoon();
    }
    function repaintMode() { const it = items.find((x) => x.id === shownId); if (it) paint(layers[front], it); }
    const cur = () => items.find((x) => x.id === st.current) || null;
    const apply = () => show(cur());

    /* затемнение и прокрутка */
    let prog = 0;
    function applyShade() {
      if (!shade) return;
      const base = st.dim / 100, extra = st.dimScroll / 100;
      shade.style.opacity = String(Math.min(0.96, base + extra * prog));
    }
    function onScroll(e) {
      const t = e.target; let y = 0;
      if (t === document || t === document.documentElement || t === document.body) y = window.scrollY || document.documentElement.scrollTop || 0;
      else if (t && t.nodeType === 1) { const r = t.getBoundingClientRect(); if (r.width < innerWidth * 0.6 || r.height < innerHeight * 0.6) return; y = t.scrollTop; }
      else return;
      prog = Math.max(0, Math.min(1, y / (innerHeight * 0.6))); applyShade();
    }
    document.addEventListener('scroll', onScroll, true);
    addEventListener('resize', () => { repaintMode(); scanSoon(); });

    /* ---------- прозрачность интерфейса ---------- */
    const SKIP = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'AUDIO', 'PATH', 'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE']);
    const marked = new WeakSet();
    const alphaOf = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(/[ ,\/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
    const ours = (el) => el.closest && el.closest('#vxp-bg,.vxp-bgui,[class^="vxp-"]');
    let scanT = 0;
    const scanSoon = () => { if (!scanT) scanT = setTimeout(() => { scanT = 0; try { scan(); } catch (e) { console.warn('[Voxalike+OrdaxEd] bg scan', e); } }, 350); };
    function scan() {
      const active = st.enabled && !!shownId;
      document.documentElement.style.setProperty('--vxp-bgk', String(1 - st.ui / 100));
      document.documentElement.style.setProperty('--vxp-bgblur', st.blur + 'px');
      document.documentElement.classList.toggle('vxp-bgglass', active && (st.ui > 0 || st.blur > 0));
      if (!active) { document.querySelectorAll('[data-vxp-clr],[data-vxp-pn],[data-vxp-clrb],[data-vxp-bl]').forEach((e) => { e.removeAttribute('data-vxp-bl'); e.removeAttribute('data-vxp-clr'); e.removeAttribute('data-vxp-pn'); e.removeAttribute('data-vxp-clrb'); e.style.removeProperty('--vxp-pc'); marked.delete(e); }); return; }
      for (const host of [document.documentElement, document.body]) {
        if (!host || marked.has(host)) continue;
        for (const ps of ['::before', '::after']) { const p = getComputedStyle(host, ps); if (p.content !== 'none' && (p.position === 'fixed' || p.position === 'absolute') && ((p.backgroundImage && p.backgroundImage !== 'none') || alphaOf(p.backgroundColor) > 0.3)) { host.setAttribute('data-vxp-clrb', ''); marked.add(host); } }
      }
      const vw = innerWidth, vh = innerHeight;
      const all = document.body ? document.body.querySelectorAll('*') : [];
      let budget = 4000;
      for (const el of all) {
        if (--budget < 0) break;
        const tn = el.tagName.toUpperCase();
        if (marked.has(el) || ours(el)) continue;
        if (tn === 'IMG' || tn === 'CANVAS' || tn === 'SVG' || tn === 'VIDEO') { // крупные картинки сайта с чёрным фоном: смешиваем так, что чёрное становится прозрачным
          const rr = el.getBoundingClientRect(); if (rr.width >= vw * 0.5 && rr.height >= vh * 0.4) { el.setAttribute('data-vxp-bl', ''); marked.add(el); }
          continue;
        }
        if (SKIP.has(tn)) continue;
        const r = el.getBoundingClientRect(); if (r.width < 80 || r.height < 30) continue;
        const cs = getComputedStyle(el);
        const big = r.width >= vw * 0.95 && r.height >= vh * 0.9;
        const hasImg = cs.backgroundImage && cs.backgroundImage !== 'none';
        if (big) {
          if (hasImg || alphaOf(cs.backgroundColor) > 0) { el.setAttribute('data-vxp-clr', ''); marked.add(el); }
          for (const ps of ['::before', '::after']) { const p = getComputedStyle(el, ps); if (p.content !== 'none' && (p.position === 'fixed' || p.position === 'absolute') && p.backgroundImage && p.backgroundImage !== 'none') { el.setAttribute('data-vxp-clrb', ''); marked.add(el); } }
          continue;
        }
        if (hasImg) { if (r.width >= vw * 0.8 && r.height >= vh * 0.4) { el.setAttribute('data-vxp-bl', ''); marked.add(el); } continue; }
        const a = alphaOf(cs.backgroundColor);
        if (a >= 0.2) { el.style.setProperty('--vxp-pc', cs.backgroundColor); el.setAttribute('data-vxp-pn', ''); marked.add(el); }
      }
      // запасной проход: смотрим, что реально лежит поверх экрана, и убираем сплошные заливки / «выключаем» чёрное у картинок
      try {
        const seen = new Set();
        for (let gx = 1; gx <= 7; gx++) for (let gy = 1; gy <= 5; gy++) {
          for (const el of document.elementsFromPoint(vw * gx / 8, vh * gy / 6)) {
            if (seen.has(el)) continue; seen.add(el);
            if (el === document.documentElement || el === document.body || ours(el)) continue;
            const r = el.getBoundingClientRect(); if (r.width * r.height < vw * vh * 0.22) continue;
            for (const ps of ['::before', '::after']) { const p = getComputedStyle(el, ps); if (p.content !== 'none' && ((p.backgroundImage && p.backgroundImage !== 'none') || alphaOf(p.backgroundColor) > 0.3) && !el.hasAttribute('data-vxp-clrb')) { el.setAttribute('data-vxp-clrb', ''); marked.add(el); } }
            const tn = el.tagName.toUpperCase();
            if (tn === 'IMG' || tn === 'CANVAS' || tn === 'SVG' || tn === 'VIDEO') { if (!el.hasAttribute('data-vxp-bl')) { el.setAttribute('data-vxp-bl', ''); marked.add(el); } continue; }
            const cs = getComputedStyle(el);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') { if (!el.hasAttribute('data-vxp-bl')) { el.setAttribute('data-vxp-bl', ''); marked.add(el); } continue; }
            if (alphaOf(cs.backgroundColor) > 0 && !el.hasAttribute('data-vxp-clr')) { el.removeAttribute('data-vxp-pn'); el.setAttribute('data-vxp-clr', ''); marked.add(el); }
          }
        }
      } catch (e) {}
    }
    try { new MutationObserver(() => { if (st.enabled && shownId) scanSoon(); }).observe(document.documentElement, { subtree: true, childList: true }); } catch {}
    setInterval(() => { if (st.enabled && shownId) scanSoon(); }, 2500);

    /* ---------- папка (Chromium): мод сам создаёт «Voxalike Backgrounds» и берёт картинки оттуда ---------- */
    const FOLDER = 'Voxalike Backgrounds';
    let dirParent = null, dirSelf = false, dirHandle = null, dirNeed = false, dirBusy = false;
    const canDir = typeof window.showDirectoryPicker === 'function';
    async function loadDir() {
      try { dirParent = (await metaGet('dir')) || null; dirSelf = !!(await metaGet('self')); } catch { dirParent = null; }
    }
    async function resolveDir(create) {
      if (!dirParent) return null;
      if (dirSelf) return dirParent;
      try { return await dirParent.getDirectoryHandle(FOLDER, { create: !!create }); }
      catch (e) { if (e && e.name === 'NotFoundError' && !create) return null; throw e; }
    }
    async function syncDir(interactive, silent) {
      if (!dirParent || dirBusy) return 0;
      dirBusy = true;
      try {
        let perm = 'granted';
        try { perm = await dirParent.queryPermission({ mode: 'readwrite' }); if (perm !== 'granted' && interactive) perm = await dirParent.requestPermission({ mode: 'readwrite' }); } catch {}
        if (perm !== 'granted') { dirNeed = true; updateDirUi(); if (!silent) api.toast(tr('Нужно разрешить доступ к папке для фонов — нажми «Синхронизировать»', 'Folder access is needed — press “Sync”'), 'warn'); return 0; }
        dirNeed = false;
        let sub = await resolveDir(false), recreated = false;
        if (!sub) { sub = await resolveDir(true); recreated = true; }
        dirHandle = sub;
        const seen = new Set(); let added = 0;
        const known = new Map(items.filter((x) => x.src === 'folder').map((x) => [x.fkey, x]));
        for await (const ent of sub.values()) {
          if (ent.kind !== 'file' || !EXT.test(ent.name)) continue;
          try {
            const f = await ent.getFile(); const fkey = ent.name + '|' + f.size + '|' + f.lastModified; seen.add(fkey);
            if (known.has(fkey)) continue;
            await addBlob(f, ent.name, 'folder', { fkey }); added++;
          } catch (e) { console.warn('[Voxalike+OrdaxEd] bg folder file', e); }
        }
        let removed = 0;
        if (!recreated) for (const it of items) if (it.src === 'folder' && !seen.has(it.fkey)) { await dbDel(it.id); freeUrls(it.id); removed++; }
        await reload(); renderGrid(); apply(); updateDirUi();
        if (recreated) api.toast(tr('Папка «' + FOLDER + '» не нашлась — создал заново', 'Folder “' + FOLDER + '” was missing — created again'), 'warn');
        else if (added || removed) api.toast(tr('Папка: добавлено ', 'Folder: added ') + added + (removed ? tr(', убрано ', ', removed ') + removed : ''));
        else if (!silent) api.toast(tr('Папка: без изменений', 'Folder: no changes'));
        return added;
      } catch (e) {
        console.warn('[Voxalike+OrdaxEd] bg folder', e);
        if (!silent) api.toast(tr('Папка недоступна: ', 'Folder unavailable: ') + (e.message || e), 'err');
        return 0;
      } finally { dirBusy = false; }
    }
    async function pickDir() {
      try {
        let base;
        try { base = await window.showDirectoryPicker({ id: 'vxp-bg', mode: 'readwrite', startIn: dirParent || 'documents' }); }
        catch (e) { if (e && e.name === 'TypeError') base = await window.showDirectoryPicker({ mode: 'readwrite' }); else throw e; }
        dirParent = base; dirSelf = base.name === FOLDER;
        try { await metaPut('dir', base); await metaPut('self', dirSelf); } catch (e) { console.warn('[Voxalike+OrdaxEd] bg dir save', e); }
        if (!dirSelf) await resolveDir(true);
        await syncDir(true); updateDirUi();
        api.toast(tr('Готово. Складывай картинки в папку «' + FOLDER + '»', 'Done. Put pictures into the “' + FOLDER + '” folder'));
      } catch (e) { if (e && e.name !== 'AbortError') api.toast(tr('Не удалось создать папку: ', 'Could not create the folder: ') + (e.message || e), 'err'); }
    }
    async function forgetDir() { dirParent = null; dirHandle = null; dirNeed = false; try { await tx('meta', 'readwrite', (s) => { s.delete('dir'); s.delete('self'); }); } catch {} updateDirUi(); }
    const autoSync = () => { if (dirParent && document.visibilityState === 'visible') syncDir(false, true).catch(() => {}); };
    addEventListener('focus', () => setTimeout(autoSync, 400));
    setInterval(autoSync, 45000);

    /* ---------- увеличенный просмотр при наведении ---------- */
    let zoomEl = null, zoomT = 0;
    function zoomHide() { clearTimeout(zoomT); if (zoomEl) { zoomEl.remove(); zoomEl = null; } }
    function zoomShow(it, anchor) {
      clearTimeout(zoomT);
      zoomT = setTimeout(() => {
        zoomHide(); if (!it || !anchor || !anchor.isConnected) return;
        const r = anchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
        const w = Math.min(460, Math.round(vw * 0.42)), hh = Math.max(80, Math.min(Math.round(vh * 0.6), Math.round(w * it.h / Math.max(1, it.w))));
        let left = r.right + 14; if (left + w > vw - 8) left = r.left - 14 - w; left = Math.max(8, Math.min(vw - w - 8, left));
        const top = Math.max(8, Math.min(vh - hh - 8, r.top + r.height / 2 - hh / 2));
        zoomEl = h('div', { class: 'vxp-bgzoom', style: 'left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + hh + 'px' },
          h('img', { src: itemUrl(it, 'full'), alt: '' }), h('span', null, it.name.replace(/\.[^.]+$/, '') + ' · ' + it.w + '×' + it.h));
        document.body.append(zoomEl);
      }, 90);
    }
    addEventListener('scroll', zoomHide, true);

    /* ---------- быстрый выбор в настройках мода ---------- */
    const strips = new Set(), STRIP_N = 5;
    function renderStrips() {
      strips.forEach((el) => { if (!el.isConnected && Date.now() - el._t > 5000) strips.delete(el); else fillStrip(el); });
    }
    function fillStrip(el) {
      {
        el.textContent = '';
        const none = h('button', { class: 'vxp-bgq none' + (!st.current ? ' sel' : ''), type: 'button', title: tr('Как на сайте', 'Site default'), onclick: () => select('') }, '∅');
        el.append(none);
        for (const it of items.slice(0, STRIP_N)) {
          const q = h('button', { class: 'vxp-bgq' + (it.id === st.current ? ' sel' : ''), type: 'button', title: it.name, onclick: () => select(it.id) }, h('img', { src: itemUrl(it, 'thumb'), alt: '', draggable: 'false' }));
          q.addEventListener('mouseenter', () => zoomShow(it, q)); q.addEventListener('mouseleave', zoomHide);
          el.append(q);
        }
        for (let i = items.length; i < STRIP_N; i++) el.append(h('button', { class: 'vxp-bgq empty', type: 'button', title: tr('Добавить картинку', 'Add a picture'), onclick: () => fileInput.click() }, '+'));
      }
    }

    /* ---------- галерея ---------- */
    let drawer = null, grid = null, dirInfo = null, hoverT = 0;
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
    fileInput.addEventListener('change', async () => { const f = [...fileInput.files]; fileInput.value = ''; if (f.length) await addFiles(f); });
    function select(id) { st.current = id; const it = items.find((x) => x.id === id); st.currentName = it ? it.name : ''; save(); apply(); renderGrid(); }
    function renderGrid() {
      renderStrips();
      if (!grid) return;
      grid.textContent = '';
      const none = h('button', { class: 'vxp-bgt none' + (!st.current ? ' sel' : ''), type: 'button', title: tr('Как на сайте', 'Site default'), onclick: () => select('') }, h('span', null, tr('Без своего фона', 'No custom background')));
      grid.append(none);
      for (const it of items) {
        const t = h('div', { class: 'vxp-bgt' + (it.id === st.current ? ' sel' : ''), title: it.name + ' · ' + it.w + '×' + it.h, role: 'button', tabindex: '0' },
          h('img', { src: itemUrl(it, 'thumb'), alt: '', draggable: 'false' }),
          h('span', { class: 'nm' }, it.name.replace(/\.[^.]+$/, '')),
          h('button', { class: 'x', type: 'button', title: tr('Удалить', 'Delete'), onclick: async (e) => { e.stopPropagation(); await dbDel(it.id); freeUrls(it.id); if (st.current === it.id) { st.current = ''; save(); } await reload(); renderGrid(); apply(); } }, '×'));
        t.addEventListener('click', () => select(it.id));
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(it.id); } });
        t.addEventListener('mouseenter', () => zoomShow(it, t)); t.addEventListener('mouseleave', zoomHide);
        grid.append(t);
      }
      if (!items.length) grid.append(h('div', { class: 'vxp-bgempty' }, tr('Пока пусто. Добавь картинки кнопкой выше или перетащи их сюда.', 'Nothing here yet. Add pictures with the button above or drop them here.')));
    }
    function preview(it) { clearTimeout(hoverT); hoverT = setTimeout(() => show(it || null), 140); }
    function updateDirUi() {
      if (!dirInfo) return;
      dirInfo.textContent = '';
      if (!canDir) { dirInfo.append(tr('Папка работает в Chrome, Edge, Яндекс.Браузере и Opera. Здесь добавляй картинки кнопкой.', 'Folders work in Chrome, Edge, Yandex Browser and Opera. Add pictures with the button here.')); return; }
      if (dirParent) {
        dirInfo.append(h('div', null, tr('Папка «' + FOLDER + '» — внутри «' + (dirParent.name || '…') + '». Кидай картинки туда: они подхватываются сами.', 'Folder “' + FOLDER + '” inside “' + (dirParent.name || '…') + '”. Drop pictures there — they are picked up automatically.')),
          dirNeed ? h('div', null, tr('Нужно разрешение браузера — нажми «Синхронизировать».', 'Browser permission needed — press “Sync”.')) : null,
          h('div', { class: 'row' }, h('button', { class: 'vxp-bgb sm', type: 'button', onclick: () => syncDir(true) }, tr('Синхронизировать', 'Sync')), h('button', { class: 'vxp-bgb sm', type: 'button', onclick: forgetDir }, tr('Отключить', 'Disconnect'))));
      } else dirInfo.append(tr('Нажми «Создать папку для фонов» и выбери папку, где лежат файлы мода (vxp-main.js и остальные) — мод сам создаст в ней папку «' + FOLDER + '» и будет брать картинки оттуда.', 'Press “Create backgrounds folder” and pick the folder where the mod files live (vxp-main.js etc.) — the mod creates “' + FOLDER + '” in it and reads pictures from it.'));
    }
    function slider(label, key, min, max, unit, onchange) {
      const out = h('b', null, st[key] + unit);
      const inp = h('input', { type: 'range', min, max, step: 1, value: st[key] });
      inp.addEventListener('input', () => { st[key] = Number(inp.value); out.textContent = st[key] + unit; onchange(); save(); });
      return h('label', { class: 'vxp-bgsl' }, h('span', null, label, out), inp);
    }
    function openDrawer() {
      if (drawer && drawer.isConnected) { drawer.remove(); drawer = null; return; }
      grid = h('div', { class: 'vxp-bggrid' }); dirInfo = h('div', { class: 'vxp-bgdir' });
      const modeSel = h('select', { class: 'vxp-bgmode' },
        h('option', { value: 'auto' }, tr('Авто (умная подгонка)', 'Auto (smart fit)')),
        h('option', { value: 'cover' }, tr('Заполнить экран', 'Fill the screen')),
        h('option', { value: 'fit' }, tr('Вписать целиком (размытые поля)', 'Fit whole (blurred edges)')),
        h('option', { value: 'stretch' }, tr('Растянуть', 'Stretch')));
      modeSel.value = st.mode;
      modeSel.addEventListener('change', () => { st.mode = modeSel.value; save(); repaintMode(); });
      const reset = h('button', { class: 'vxp-bgb sm', type: 'button', onclick: () => { Object.assign(st, { dim: DEF.dim, dimScroll: DEF.dimScroll, ui: 0, blur: 0, mode: 'auto' }); save(); applyShade(); scan(); repaintMode(); drawer.remove(); drawer = null; openDrawer(); } }, tr('Сбросить настройки', 'Reset settings'));
      drawer = h('div', { class: 'vxp-bgui' },
        h('div', { class: 'hd' }, h('b', null, tr('Свои фоны', 'Custom backgrounds')), h('button', { class: 'cl', type: 'button', title: tr('Закрыть', 'Close'), onclick: () => { drawer.remove(); drawer = null; show(cur()); } }, '×')),
        h('div', { class: 'bar' },
          h('button', { class: 'vxp-bgb pri', type: 'button', onclick: () => fileInput.click() }, '＋ ' + tr('Добавить картинки', 'Add pictures')),
          canDir && !dirParent ? h('button', { class: 'vxp-bgb', type: 'button', onclick: pickDir }, '📁 ' + tr('Создать папку для фонов', 'Create backgrounds folder')) : null),
        dirInfo, grid,
        h('div', { class: 'set' },
          h('label', { class: 'vxp-bgsl' }, h('span', null, tr('Подгонка под экран', 'Fit to screen')), modeSel),
          slider(tr('Затемнение фона', 'Background dimming'), 'dim', 0, 90, '%', applyShade),
          slider(tr('Доп. затемнение при прокрутке вниз', 'Extra dimming when scrolling down'), 'dimScroll', 0, 90, '%', applyShade),
          slider(tr('Прозрачность интерфейса', 'Interface transparency'), 'ui', 0, 90, '%', scan),
          slider(tr('Размытие за панелями', 'Blur behind panels'), 'blur', 0, 24, ' px', scan),
          h('div', { class: 'row' }, reset)),
        fileInput);
      drawer.addEventListener('dragover', (e) => { e.preventDefault(); drawer.classList.add('drop'); });
      drawer.addEventListener('dragleave', () => drawer.classList.remove('drop'));
      drawer.addEventListener('drop', async (e) => { e.preventDefault(); drawer.classList.remove('drop'); const f = e.dataTransfer && e.dataTransfer.files; if (f && f.length) await addFiles(f); });
      document.body.append(drawer);
      renderGrid(); updateDirUi();
    }

    /* ---------- настройки мода ---------- */
    api.addSettings(() => {
      const strip = h('div', { class: 'vxp-bgstrip' }); strip._t = Date.now();
      strips.add(strip);
      const el = h('div', { class: 'vxp-bgset' },
        checkbox({ label: tr('Свой фон сайта', 'Custom site background'), get: () => st.enabled, set: (v) => { st.enabled = v; save(); apply(); }, title: tr('Картинки из галереи вместо стандартного фона', 'Pictures from the gallery instead of the default background') }),
        strip,
        h('div', { class: 'vxp-row' }, h('button', { class: 'vxp-btn small', type: 'button', onclick: openDrawer }, '🖼 ' + tr('Галерея и настройки фона…', 'Gallery and background settings…')),
          canDir ? h('button', { class: 'vxp-btn small', type: 'button', title: tr('Папка для фонов: создать или обновить', 'Backgrounds folder: create or refresh'), onclick: () => (dirParent ? syncDir(true) : pickDir()) }, dirParent ? '↻ ' + tr('Папка', 'Folder') : '📁 ' + tr('Создать папку', 'Create folder')) : null));
      fillStrip(strip); return el;
    });

    /* ---------- стили ---------- */
    (document.head || document.documentElement).append(h('style', { id: 'vxp-bg-style' }, `
.vxp-bgstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0}
.vxp-bgq{position:relative;aspect-ratio:16/10;border-radius:9px;overflow:hidden;border:2px solid transparent;background:#1a1e29;padding:0;cursor:pointer;color:#cdd3e4;font:700 18px/1 system-ui;display:grid;place-items:center;transition:border-color .15s,transform .15s}
.vxp-bgq:hover{border-color:rgba(255,255,255,.55);transform:translateY(-1px)}
.vxp-bgq.sel{border-color:#35e0c0;box-shadow:0 0 0 2px rgba(53,224,192,.28)}
.vxp-bgq img{width:100%;height:100%;object-fit:cover;display:block}
.vxp-bgq.none,.vxp-bgq.empty{background:transparent;border:2px dashed rgba(255,255,255,.28)}
.vxp-bgq.none.sel{border-style:solid;border-color:#35e0c0}
.vxp-bgq.empty{opacity:.6}
.vxp-bgzoom{position:fixed;z-index:2147483002;pointer-events:none;border-radius:14px;overflow:hidden;background:#0a0c12;border:1px solid rgba(255,255,255,.25);box-shadow:0 20px 70px rgba(0,0,0,.65);animation:vxpZoomIn .14s ease-out}
.vxp-bgzoom img{width:100%;height:100%;object-fit:contain;display:block;background:#05070b}
.vxp-bgzoom span{position:absolute;left:0;right:0;bottom:0;padding:18px 12px 8px;background:linear-gradient(transparent,rgba(0,0,0,.8));color:#fff;font:700 12px/1.2 system-ui}
@keyframes vxpZoomIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
#vxp-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:0;transition:opacity .4s}
#vxp-bg.on{opacity:1}
.vxp-bgl{position:absolute;inset:0;opacity:0;transition:opacity .6s ease;overflow:hidden}
.vxp-bgl.vis{opacity:1}
.vxp-bgl .fill{position:absolute;inset:-6%;background-size:cover;background-position:center;filter:blur(38px) brightness(.78) saturate(1.1)}
.vxp-bgl .fit{position:absolute;inset:0;background-position:center;background-repeat:no-repeat}
.vxp-bgshade{position:absolute;inset:0;background:#000;opacity:.2;transition:opacity .25s linear}
html.vxp-bgon{background:#05070b!important}
html.vxp-bgon body,html.vxp-bgon #root,html.vxp-bgon #root>main,html.vxp-bgon .app-shell{background:none!important;background-color:transparent!important}
html.vxp-bgon [data-vxp-bl]{filter:url(#vxp-keyblack)!important}
html.vxp-bgon .menu-shell,html.vxp-bgon .menu-home-scroll,html.vxp-bgon .menu-playfield,html.vxp-bgon .halloween-home{background:none!important;background-color:transparent!important}
html.vxp-bgon .menu-shell::before,html.vxp-bgon .menu-shell::after,html.vxp-bgon .menu-home-scroll::before,html.vxp-bgon .menu-home-scroll::after,html.vxp-bgon .menu-playfield::before,html.vxp-bgon .menu-playfield::after{background:none!important;background-image:none!important;content:none!important}
html.vxp-bgon [data-vxp-clr]{background:none!important;background-color:transparent!important}
html.vxp-bgon [data-vxp-clrb]::before,html.vxp-bgon [data-vxp-clrb]::after{background:none!important;background-image:none!important}
html.vxp-bgglass [data-vxp-pn]{background-color:color-mix(in srgb,var(--vxp-pc) calc(var(--vxp-bgk,1)*100%),transparent)!important}
html.vxp-bgglass [data-vxp-pn]{-webkit-backdrop-filter:blur(var(--vxp-bgblur,0px));backdrop-filter:blur(var(--vxp-bgblur,0px))}
html.vxp-bgon header.hero.workshop-hero{min-height:clamp(240px,34vh,380px)!important;padding:30px 36px!important;filter:none!important;display:flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;background-image:none!important;background-color:transparent!important;background:radial-gradient(ellipse at 50% 50%,rgba(6,9,15,calc(var(--vxp-bgk,.8)*.1*var(--vxp-wkh,1))),rgba(6,9,15,calc(var(--vxp-bgk,.8)*.34*var(--vxp-wkh,1))))!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:18px!important;-webkit-backdrop-filter:blur(var(--vxp-bgblur,0px));backdrop-filter:blur(var(--vxp-bgblur,0px));box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 10px 40px rgba(0,0,0,.22)}
html.vxp-bgon header.hero.workshop-hero::before,html.vxp-bgon header.hero.workshop-hero::after{background:none!important;background-image:none!important}
html.vxp-bgon header.hero.workshop-hero .hero-copy{text-align:center!important;margin:0 auto!important}
html.vxp-bgon header.hero.workshop-hero h1{font-size:clamp(40px,5vw,72px)!important;line-height:1.05!important;letter-spacing:.01em;text-align:center!important;text-shadow:0 3px 26px rgba(0,0,0,.75),0 1px 3px rgba(0,0,0,.5)}
html.vxp-bgon header.hero.workshop-hero .hero-copy>*{text-shadow:0 2px 16px rgba(0,0,0,.75);text-align:center!important}
html.vxp-bgon header.hero.workshop-hero .hero-copy>:first-child{display:flex;align-items:center;justify-content:center;gap:14px}
html.vxp-bgon header.hero.workshop-hero .hero-copy>:first-child::before,html.vxp-bgon header.hero.workshop-hero .hero-copy>:first-child::after{content:"";display:block;width:44px;height:1px;background:linear-gradient(90deg,transparent,#35e0c0)}
html.vxp-bgon header.hero.workshop-hero .hero-copy>:first-child::after{background:linear-gradient(90deg,#35e0c0,transparent)}
html:not(.vxp-bgon) .vxp-wkbox{display:none!important}
.vxp-wkbox{margin-top:14px;padding:14px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(8,11,18,.5);color:#e8ecf7;font:600 13px/1.3 system-ui,sans-serif;display:grid;gap:10px;position:relative;z-index:2}
.vxp-wkbox.float{position:fixed;left:16px;bottom:16px;width:260px;z-index:2147482000;background:rgba(8,11,18,.78);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.vxp-wkbox .t{font:800 11px/1 system-ui;letter-spacing:.06em;text-transform:uppercase;color:#35e0c0;display:flex;justify-content:space-between;align-items:center}
.vxp-wkbox .t button{background:none;border:0;color:#9aa4bd;cursor:pointer;font:600 11px system-ui;padding:0}
.vxp-wkbox .t button:hover{color:#fff}
.vxp-wkbox label{display:grid;gap:4px}
.vxp-wkbox label>span{display:flex;justify-content:space-between;gap:8px}
.vxp-wkbox label>span b{color:#9aa4bd;font-weight:700}
.vxp-wkbox input[type=range]{width:100%;accent-color:#35e0c0;margin:0}
.vxp-bgui{position:fixed;top:14px;right:14px;bottom:14px;width:min(440px,92vw);z-index:2147483000;display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;background:rgba(10,12,18,.88);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 60px rgba(0,0,0,.55);color:#f3f5fb;font:600 13px/1.35 "Nunito Variable","Arial Rounded MT Bold",system-ui,sans-serif;overflow:auto}
.vxp-bgui.drop{outline:2px dashed #35e0c0;outline-offset:-6px}
.vxp-bgui .hd{display:flex;align-items:center;justify-content:space-between;font-size:16px}
.vxp-bgui .cl{background:none;border:0;color:inherit;font-size:24px;line-height:1;cursor:pointer;padding:0 6px}
.vxp-bgui .bar{display:flex;gap:8px;flex-wrap:wrap}
.vxp-bgdir{font-size:12px;opacity:.85;display:grid;gap:6px}
.vxp-bgdir .row{display:flex;gap:6px;flex-wrap:wrap}
.vxp-bggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(122px,1fr));gap:8px;min-height:90px;max-height:46vh;overflow:auto;padding:2px}
.vxp-bgt{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:2px solid transparent;background:#1a1e29;cursor:pointer;padding:0;color:inherit}
.vxp-bgt img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s}
.vxp-bgt.sel{border-color:#35e0c0;box-shadow:0 0 0 2px rgba(53,224,192,.3)}
.vxp-bgt .nm{position:absolute;left:0;right:0;bottom:0;padding:14px 6px 4px;background:linear-gradient(transparent,rgba(0,0,0,.75));font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vxp-bgt .x{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;opacity:0;transition:opacity .15s;line-height:1;font-size:16px;padding:0}
.vxp-bgt:hover .x{opacity:1}
.vxp-bgt.none{display:grid;place-items:center;text-align:center;font-size:12px;border:2px dashed rgba(255,255,255,.25);background:transparent}
.vxp-bgt.none.sel{border-style:solid;border-color:#35e0c0}
.vxp-bgempty{grid-column:1/-1;opacity:.7;text-align:center;padding:14px 8px}
.vxp-bgui .set{display:grid;gap:10px}
.vxp-bgsl{display:grid;gap:4px}
.vxp-bgsl>span{display:flex;justify-content:space-between;gap:8px}
.vxp-bgsl input[type=range]{width:100%;accent-color:#35e0c0}
.vxp-bgsl select{background:#151925;color:inherit;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 8px;font:inherit}
.vxp-bgui .row{display:flex;gap:8px}
.vxp-bgb{background:#1b2130;color:#f3f5fb;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:8px 12px;font:700 13px/1 inherit;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s}
.vxp-bgb:hover{background:#252d42;border-color:#35e0c0}
.vxp-bgb.pri{background:#35e0c0;color:#04120f;border-color:#35e0c0}
.vxp-bgb.pri:hover{background:#5df0d6}
.vxp-bgb.sm{padding:5px 9px;font-size:12px}
`));


    /* ---------- Мастерская: свои регуляторы прозрачности ---------- */
    const WKKEY = 'vxp-bg:ws:v1';
    const wk = { hero: 0, tiles: 28, panels: 0 };
    try { Object.assign(wk, JSON.parse(localStorage.getItem(WKKEY)) || {}); } catch {}
    const wkSave = () => { try { localStorage.setItem(WKKEY, JSON.stringify(wk)); } catch {} };
    const wkApply = () => {
      const r = document.documentElement.style;
      r.setProperty('--vxp-wkh', String(1 - wk.hero / 100));
      wkPaintSoon();
    };
    // Плитки и панели красим из скрипта: классов на сайте мы не знаем, поэтому ищем крупные блоки с фоном
    const wkAlpha = (c) => {
      let m = /\/\s*([\d.]+%?)\s*\)/.exec(c);
      if (!m) m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(c);
      if (!m) return 1;
      return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    };
    let wkPaintT = 0;
    const wkPaintSoon = () => { if (!wkPaintT) wkPaintT = setTimeout(wkPaint, 60); };
    const wkPaint = () => {
      wkPaintT = 0;
      const browser = document.querySelector('.workshop-browser');
      const on = document.documentElement.classList.contains('vxp-bgon');
      const clear = () => document.querySelectorAll('[data-vxp-wk]').forEach((e) => { e.style.removeProperty('background-color'); e.style.removeProperty('background-image'); e.removeAttribute('data-vxp-wk'); });
      if (!browser || !on || !/\/workshop/.test(location.pathname)) { clear(); return; }
      const list = [];
      for (const el of browser.querySelectorAll('*')) {
        if (el.closest('.vxp-wkbox') || el.tagName === 'IMG' || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'SPAN' || el.tagName === 'svg') continue;
        const w = el.offsetWidth, hh = el.offsetHeight;
        if (w < 200 || hh < 50) continue;
        list.push(el);
      }
      for (const el of list) { el.style.removeProperty('background-color'); el.style.removeProperty('background-image'); }
      const todo = [];
      for (const el of list) {
        const cs = getComputedStyle(el);
        const col = cs.backgroundColor, bi = cs.backgroundImage;
        const grad = bi && bi !== 'none' && /gradient/.test(bi) && !/url\(/.test(bi);
        if (!grad && wkAlpha(col) < 0.05) { el.removeAttribute('data-vxp-wk'); continue; }
        todo.push([el, col, grad, !!el.querySelector('img')]);
      }
      for (const [el, col, grad, tile] of todo) {
        const k = 1 - (tile ? wk.tiles : wk.panels) / 100;
        const base = wkAlpha(col) < 0.05 ? 'rgba(14,18,28,.8)' : col;
        el.setAttribute('data-vxp-wk', tile ? 't' : 'p');
        el.style.setProperty('background-color', 'color-mix(in srgb,' + base + ' ' + Math.round(k * 100) + '%,transparent)', 'important');
        if (grad) el.style.setProperty('background-image', 'none', 'important');
      }
    };
    document.documentElement.style.setProperty('--vxp-wkh', String(1 - wk.hero / 100));
    const WK_ROWS = [
      ['hero', tr('Шапка', 'Header')],
      ['tiles', tr('Плитки модов', 'Mod tiles')],
      ['panels', tr('Панели и фильтры', 'Panels and filters')]
    ];
    const WK_DEF = { hero: 0, tiles: 28, panels: 0 };
    let wkBox = null;
    const wkBuild = () => {
      const outs = {};
      const rows = WK_ROWS.map(([key, label]) => {
        const out = h('b', {}, wk[key] + '%');
        const inp = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(wk[key]) });
        inp.addEventListener('input', () => { wk[key] = +inp.value; out.textContent = wk[key] + '%'; wkApply(); wkSave(); });
        outs[key] = [inp, out];
        return h('label', {}, h('span', {}, label, out), inp);
      });
      const reset = h('button', { type: 'button' }, tr('Сбросить', 'Reset'));
      reset.addEventListener('click', () => { Object.assign(wk, WK_DEF); for (const k in outs) { outs[k][0].value = String(wk[k]); outs[k][1].textContent = wk[k] + '%'; } wkApply(); wkSave(); });
      return h('div', { class: 'vxp-wkbox' }, h('div', { class: 't' }, h('span', {}, 'ORDAX · ' + tr('Прозрачность', 'Transparency')), reset), ...rows);
    };
    // боковая колонка: поднимаемся от списка «Язык/Роли» вверх, пока рядом нет картинок плиток и строки поиска
    const wkSide = (browser) => {
      const sel = browser.querySelector('select');
      if (!sel) return null;
      let el = sel.parentElement;
      while (el && el.parentElement && el.parentElement !== browser) {
        const up = el.parentElement;
        if (up.querySelector('img') || up.querySelector('input[type=search],input[type=text],input:not([type])')) break;
        el = up;
      }
      return el && el !== browser ? el : null;
    };
    let wkTimer = 0;
    const wkEnsure = () => {
      wkTimer = 0;
      if (!/\/workshop/.test(location.pathname)) { if (wkBox && wkBox.isConnected) wkBox.remove(); return; }
      const browser = document.querySelector('.workshop-browser');
      if (!browser) return;
      if (!wkBox) wkBox = wkBuild();
      const side = wkSide(browser);
      if (side) {
        wkBox.classList.remove('float');
        if (wkBox.parentElement !== side || wkBox !== side.lastElementChild) side.appendChild(wkBox);
      } else if (!wkBox.isConnected || !wkBox.classList.contains('float')) {
        wkBox.classList.add('float'); document.body.appendChild(wkBox);
      }
    };
    new MutationObserver((muts) => { if (!wkTimer) wkTimer = setTimeout(() => { wkEnsure(); wkPaintSoon(); }, 250); }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.body) { wkEnsure(); wkPaintSoon(); } else document.addEventListener('DOMContentLoaded', () => { wkEnsure(); wkPaintSoon(); }, { once: true });
    window.addEventListener('resize', wkPaintSoon);
    // стекло включилось/сдвинулся его ползунок или блоку поставили метку панели — перекрашиваем заново
    new MutationObserver(wkPaintSoon).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    new MutationObserver(wkPaintSoon).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-vxp-pn'] });

    /* ---------- запуск ---------- */
    window.__VXP__.bg = { version: VERSION, addFiles, open: openDrawer, items: () => items.map((x) => ({ id: x.id, name: x.name, w: x.w, h: x.h, src: x.src })), select, state: st, rescan: scan, syncDir, debug: () => document.elementsFromPoint(innerWidth / 2, innerHeight / 2).slice(0, 8).map((e) => { const c = getComputedStyle(e); return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + ' | bg=' + c.backgroundColor + ' img=' + (c.backgroundImage || '').slice(0, 40) + ' pos=' + c.position + ' z=' + c.zIndex; }) };
    (async () => {
      try { await reload(); await loadDir(); } catch (e) { console.warn('[Voxalike+OrdaxEd] bg db', e); return; }
      if (dirParent) setTimeout(autoSync, 1500);
      const go = () => { ensureRoot(); apply(); applyShade(); };
      if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
    })();
  };

  if (window.__VXP__ && window.__VXP__.registerModule) window.__VXP__.registerModule(NAME, init);
  else (window.__VXP_PLUGINS__ = window.__VXP_PLUGINS__ || []).push({ name: NAME, init });
})();