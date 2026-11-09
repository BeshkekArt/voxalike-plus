#!/usr/bin/env node
// Собирает vxp-denoise.js: берёт src/vxp-denoise.src.js и подставляет вместо
// @@MODEL:<имя>@@ содержимое src/models/<имя>.wasm в base64.
// Использование: node scripts/embed-models.js <выходной-файл>
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('Укажите выходной файл'); process.exit(1); }
const tpl = fs.readFileSync(path.join(root, 'src/vxp-denoise.src.js'), 'utf8');
const res = tpl.replace(/@@MODEL:(\w+)@@/g, (_, name) =>
  fs.readFileSync(path.join(root, 'src/models', name + '.wasm')).toString('base64'));
fs.writeFileSync(out, res);
