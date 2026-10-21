// Окно расширения: язык (по языку браузера), проверка обновлений и перезагрузка.
// Внешний файл — требование CSP MV3. Сеть используется только по нажатию «Проверить обновления»
// (один GET-запрос к api.github.com; никакие данные о вас не отправляются).
(function () {
  var api = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  var REPO = 'BeshkekArt/voxalike-plus';
  var EN = {
    k1: 'Dual tracks on the dubbing stage and shifting your take',
    k2: 'Mic gain and level meter',
    k3: '“Hear original” and “hear myself” while recording',
    k4: 'Record all your lines in advance with auto-submit',
    k5: 'Pitch, speed, volume, underwater, echo, low cut',
    k6: 'Montage: scissors, move and delete pieces',
    k7: '3-2-1 countdown, live waveform, 5 s buffer',
    k8: 'Notification when your turn comes',
    k9: 'Open Voxalike',
    k10: '💡 Idea / bug',
    k11: '❤️ Support',
    k12: 'Unofficial mod: runs on top of voxalike.com on the original servers and is not affiliated with the game\'s developers. Provided “as is”, without warranty — use at your own risk.',
    k13: '🔄 Check for updates',
    k14: '↻ Reload extension'
  };
  var MSG = {
    ru: {
      checking: 'Проверяю…',
      latest: function (v) { return '✓ У вас последняя версия (' + v + ').'; },
      newer: function (v, cur) { return 'Доступна версия ' + v + ' (у вас ' + cur + '). '; },
      dl: 'Скачать',
      how: ' Замените файлы в папке расширения и нажмите «Перезагрузить».',
      err: 'Не удалось проверить (нет сети или лимит GitHub). Попробуйте позже.',
      reloaded: 'Перезагружаю…'
    },
    en: {
      checking: 'Checking…',
      latest: function (v) { return '✓ You have the latest version (' + v + ').'; },
      newer: function (v, cur) { return 'Version ' + v + ' is available (you have ' + cur + '). '; },
      dl: 'Download',
      how: ' Replace the files in the extension folder, then press “Reload”.',
      err: 'Could not check (offline or GitHub rate limit). Try again later.',
      reloaded: 'Reloading…'
    }
  };
  var isRu = /^(ru|uk|be|kk)\b/.test((navigator.language || '').toLowerCase());
  var M = isRu ? MSG.ru : MSG.en;
  if (!isRu) {
    document.documentElement.lang = 'en';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = EN[el.getAttribute('data-i18n')];
      if (v) el.textContent = v;
    });
  }

  var cur = (api.runtime.getManifest() || {}).version || '';
  var ver = document.getElementById('ver'); if (ver && cur) ver.textContent = 'v' + cur;
  var msg = document.getElementById('updMsg');
  var btnCheck = document.getElementById('btnCheck'), btnReload = document.getElementById('btnReload');

  function cmp(a, b) { // semver a ? b
    var x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number);
    for (var i = 0; i < 3; i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }
  function setMsg(nodes, cls) {
    msg.className = cls || ''; msg.textContent = '';
    [].concat(nodes).forEach(function (n) { msg.append(typeof n === 'string' ? document.createTextNode(n) : n); });
  }

  btnCheck.addEventListener('click', function () {
    btnCheck.disabled = true; setMsg(M.checking);
    fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (rel) {
        var tag = rel.tag_name || '';
        if (cmp(tag, cur) > 0) {
          var a = document.createElement('a');
          a.href = rel.html_url || ('https://github.com/' + REPO + '/releases/latest');
          a.target = '_blank'; a.rel = 'noopener'; a.textContent = M.dl + ' ' + tag;
          setMsg([M.newer(tag, 'v' + cur), a, M.how]);
        } else setMsg(M.latest('v' + cur), 'ok');
      })
      .catch(function () { setMsg(M.err); })
      .then(function () { btnCheck.disabled = false; });
  });

  btnReload.addEventListener('click', function () {
    setMsg(M.reloaded, 'ok');
    setTimeout(function () { api.runtime.reload(); }, 150);
  });
})();
