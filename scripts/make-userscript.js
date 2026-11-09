#!/usr/bin/env node
// Собирает юзерскрипт (Tampermonkey / Violentmonkey) из тех же файлов, что и расширение:
// берёт список и порядок скриптов из content_scripts манифеста и склеивает их в один.
// Код внедряется тегом <script>, поэтому всегда выполняется в контексте страницы.
// Использование: node scripts/make-userscript.js <папка-сборки-chrome> <выход.user.js>
const fs = require('fs'), path = require('path');
const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('Укажите папку сборки и выходной файл'); process.exit(1); }
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const files = m.content_scripts[0].js;
const code = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\s+$/, '')).join('\n;\n') + '\n';
const head = `// ==UserScript==
// @name         Voxalike+OrdaxEd
// @namespace    voxalike-plus-ordaxed
// @version      ${m.version}
// @description  Форк Voxalike+: шумодав (нейросети), удаление эха комнаты, эффектор голоса, EQ/компрессор, свои фоны, две дорожки со сдвигом, запись реплик заранее
// @description:en  Voxalike+ fork: neural denoise, room-echo removal, voice effector, EQ/compressor, custom backgrounds, dual-track editor, record lines in advance (RU/EN)
// @match        https://voxalike.com/*
// @match        https://www.voxalike.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
`;
const body = `(function () {
  var code = ${JSON.stringify(code)};
  var s = document.createElement("script");
  s.textContent = code;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
})();
`;
fs.writeFileSync(out, head + body);
