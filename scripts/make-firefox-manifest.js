#!/usr/bin/env node
// Делает манифест Firefox из основного (extension/manifest.json), чтобы они не расходились:
// убирает minimum_chrome_version и добавляет browser_specific_settings.
// Использование: node scripts/make-firefox-manifest.js <manifest.json> <выход>
const fs = require('fs');
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('Укажите входной и выходной файл'); process.exit(1); }
const m = JSON.parse(fs.readFileSync(src, 'utf8'));
delete m.minimum_chrome_version;
m.browser_specific_settings = {
  gecko: {
    id: 'voxalike-plus-ordaxed@ordax',          // свой ID, чтобы не конфликтовать с оригиналом
    strict_min_version: '128.0',                  // world: "MAIN" в content_scripts — с Firefox 128
    data_collection_permissions: { required: ['none'] },
  },
};
fs.writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
