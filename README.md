# Voxalike+

**Неофициальный клиентский мод для браузерной игры-озвучки [Voxalike](https://voxalike.com).**
Работает поверх оригинального сайта и на оригинальных серверах — как «надстройка» в вашем браузере.

> ⚠️ **Проект не связан с разработчиками Voxalike и не одобрен ими.** Мод распространяется «как есть», **без каких-либо гарантий**, в том числе работоспособности и безопасности. Вы устанавливаете и используете его **на свой страх и риск** и сами отвечаете за соблюдение правил игры. Подробно — в [DISCLAIMER.md](DISCLAIMER.md).

[📦 Скачать последнюю версию](https://github.com/BeshkekArt/voxalike-plus/releases/latest) · [💡 Предложить идею](https://github.com/BeshkekArt/voxalike-plus/issues/new/choose) · [❤️ Поддержать на Boosty](https://boosty.to/el_beshuele/donate)

---

## Возможности

**Две дорожки на сцене озвучки** (правая колонка)
- Сверху оригинал, снизу ваша запись. **Светлое окно** — часть записи, которая уходит в игру.
- **Сдвиг** своей дорожки мышью (шаг 5 мс, с Alt — плавно), кнопками ◀ ▶ (±10 мс, Shift ±50 мс) или клавишами `[` `]`.
- **«Авто»** — автоподгонка под оригинал. **«▶ Вместе»** — прослушать обе дорожки.
- **Волна в реальном времени** во время записи.

**Монтаж своей дорожки**
- ✂ **Ножницы** (клавиша `S`) — клик по своей дорожке режет её в этом месте.
- ↔ **Выбор** (`V`) — клик по куску выделяет его, `Shift`+клик — несколько, `Ctrl+A` — все. Выделенные куски **перетаскиваются мышью** и сдвигаются кнопками ◀ ▶.
- 🗑 **Удалить выбранные** (`Delete`), ↶ **Отменить** (`Ctrl+Z`), ⟲ **Сбросить монтаж**.
- Монтаж неразрушающий: исходная запись хранится, всё можно вернуть.

**Обработка** (неразрушающая, запоминается для следующих дублей)
- 🔊 **Громкость дорожки** −12…+12 дБ с защитой от перегруза.
- 🎚 **Питч** −12…+12 полутонов — длительность и темп не меняются.
- ⏩ **Скорость** ×0.5…×2 — темп дорожки, высота голоса не меняется (удобно, чтобы фраза влезла в реплику).
- 🌊 **Под водой** — глухой «подводный» звук с лёгким плаванием.
- 🔁 **Эхо** — небольшое эхо.
- **Срез низов** — убирает гул и стук.

**Язык интерфейса**
- 🌐 **Русский и English.** По умолчанию язык выбирается по языку браузера; поменять можно в любой момент в блоке **«Настройки»** внизу панели (и в окне студии): Авто / Русский / English.

**Запись**
- 🎙 **Усиление микрофона** −12…+12 дБ в реальном времени + индикатор уровня.
- ☑ **Слушать оригинал** и ☑ **слушать себя** во время записи (в наушниках).
- ☑ **Чистый микрофон** — без эхо- и шумоподавления браузера, из-за которых голос «проваливается».
- **Отсчёт 3-2-1** перед записью (0 / 3 / 5 с, со звуком или без).
- **Буфер после реплики** (0 / 3 / 5 / 8 с): не успели договорить — запись продолжается, опоздавшую фразу можно перетащить в окно.

**Сетевая игра «Совместно» — без ожидания друг друга**
- Блок **«Мои реплики»** со статусами и кнопка **«Записать все заранее»** — студия с видео нужного фрагмента.
- Когда подходит ваша очередь, реплика **отправляется автоматически**. Финальное видео игра показывает как обычно.
- Сигнал и мигающий заголовок вкладки, когда наступил ваш ход.

## Установка

Скачайте файлы со страницы [Releases](https://github.com/BeshkekArt/voxalike-plus/releases/latest).

### Chrome, Edge, Яндекс Браузер, Opera, Brave
1. Распакуйте `voxalike-plus-chrome-vX.Y.Z.zip` в постоянную папку.
2. Откройте `chrome://extensions` (Яндекс: `browser://extensions`, Edge: `edge://extensions`).
3. Включите **«Режим разработчика»** → **«Загрузить распакованное расширение»** → выберите папку.
4. Обновите страницу voxalike.com.

### Firefox 128+
- **Рекомендуется:** [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) или Tampermonkey → открыть `voxalike-plus.user.js` → «Установить».
- **Как дополнение:** `about:debugging` → «Этот Firefox» → «Загрузить временное дополнение» → `voxalike-plus-firefox-vX.Y.Z.xpi` (без подписи Mozilla работает до перезапуска браузера).

### Юзерскрипт в любом браузере
Tampermonkey / Violentmonkey → `voxalike-plus.user.js`. Не ставьте одновременно расширение и юзерскрипт.

### Обновление
Расширение, установленное из папки, не обновляется само. Нажмите на значок Voxalike+ → **«🔄 Проверить обновления»**: окно сравнит вашу версию с последним релизом на GitHub и даст ссылку. Скачайте архив, **замените файлы в папке расширения** и нажмите **«↻ Перезагрузить расширение»** (затем обновите вкладку voxalike.com). Единственный сетевой запрос мода вне игры — этот GET к `api.github.com`, и только по вашему нажатию. Юзерскрипт обновляется средствами Tampermonkey/Violentmonkey.

## Что мод делает и чего не делает

| Делает | Не делает |
|---|---|
| Добавляет интерфейс на страницу voxalike.com в вашем браузере | Не работает на других сайтах (только `voxalike.com`) |
| Обрабатывает звук **локально**, у вас в браузере | Не отправляет данные третьим лицам, нет аналитики и трекеров |
| Отправляет ваши реплики **на сервер игры теми же запросами**, что и сама игра | Не подменяет и не взламывает сервер, не обходит ограничения игры |
| Хранит настройки в `localStorage` сайта | Не запрашивает дополнительных разрешений браузера |

Код открыт и умещается в один файл — [`src/vxp-main.js`](src/vxp-main.js). Его можно прочитать и проверить перед установкой.

## Ограничения
- Очередь заранее записанных реплик хранится в памяти вкладки — не закрывайте её, пока реплики не уйдут.
- Запись заранее — в режиме «Совместно» с распределением «По очереди» или «Выбор роли».
- Реплики, отправленные модом заранее, приходят без игровой оценки (баллов).
- Мод опирается на внутреннюю структуру сайта: после обновлений игры часть функций может перестать работать. Сама игра при этом продолжит работать — достаточно отключить мод.

## Идеи и ошибки — через тикеты
Есть идея по улучшению или нашли ошибку? [Создайте тикет](https://github.com/BeshkekArt/voxalike-plus/issues/new/choose) и опишите, что хотите. Если функция окажется полезной и логичной — добавим. Подробнее: [CONTRIBUTING.md](CONTRIBUTING.md).

## Поддержать проект
Если мод вам пригодился и хотите поддержать автора — [boosty.to/el_beshuele](https://boosty.to/el_beshuele/donate). Это добровольно: мод бесплатный и останется бесплатным.

## Сборка из исходников
```bash
./build.sh   # нужен Node.js и zip → dist/: chrome .zip, firefox .xpi, .user.js
```
```
src/vxp-main.js                 — весь код мода
extension/manifest.json         — манифест Chrome (MV3)
extension/manifest.firefox.json — манифест Firefox (MV3)
```

## Лицензия
[MIT](LICENSE) © 2026 BeshkekArt. «Voxalike» — название оригинальной игры, оно принадлежит её владельцам и используется здесь только для указания совместимости.

---

### English
**Voxalike+** is an unofficial, open-source client-side mod for the browser dubbing game [Voxalike](https://voxalike.com). It runs on top of the original site and talks only to the original game servers.

**Interface language:** English and Russian. It follows your browser language by default; switch it any time in the **Settings** block at the bottom of the mod panel (also in the studio window): Auto / Русский / English.

**Features**
- Two tracks on the dubbing stage (original + yours), drag to shift your take (5 ms steps, Alt = smooth), ◀ ▶ nudge buttons, `[` `]` keys, **Auto** align, **Together** playback, live waveform while recording.
- **Montage:** ✂ scissors (`S`), select/move pieces (`V`, Shift+click, `Ctrl+A`), delete (`Delete`), undo (`Ctrl+Z`), reset. Non-destructive.
- **Processing:** track volume, pitch ±12 semitones, speed ×0.5–×2 (pitch preserved), underwater, echo, low cut.
- **Recording:** mic gain with level meter, hear the original / hear myself, “clean mic” (no browser echo cancellation / noise suppression, fixes dropouts), 3-2-1 countdown, 0–8 s recording buffer after the line.
- **Co-op rooms:** record all your lines in advance — the mod submits each one automatically when your turn comes. The final video is shown as usual.

**Update:** click the Voxalike+ icon → *Check for updates* (one request to `api.github.com`, only on click), replace the files in the extension folder, then *Reload extension*.

**Install:** download from [Releases](https://github.com/BeshkekArt/voxalike-plus/releases/latest). Chrome/Edge/Brave/Opera: unzip `voxalike-plus-chrome-vX.Y.Z.zip` → `chrome://extensions` → Developer mode → *Load unpacked*. Firefox 128+: install `voxalike-plus.user.js` with Violentmonkey/Tampermonkey (recommended) or load the `.xpi` temporarily via `about:debugging`. Don't use the extension and the userscript at the same time.

**Not affiliated with or endorsed by the Voxalike developers. Provided “as is”, without warranty of any kind (including security) — use at your own risk** (see [DISCLAIMER.md](DISCLAIMER.md)).

**Ideas and bugs:** open an [Issue](https://github.com/BeshkekArt/voxalike-plus/issues/new/choose) — if a feature is useful and fits the project, we’ll add it. **Support:** voluntary, [boosty.to/el_beshuele](https://boosty.to/el_beshuele/donate) — the mod is free and will stay free.
