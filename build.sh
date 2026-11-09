#!/usr/bin/env bash
# Сборка Voxalike+OrdaxEd:
#   dist/voxalike-plus-ordaxed-chrome-vX.zip   — Chrome / Edge / Яндекс / Opera / Brave
#   dist/voxalike-plus-ordaxed-firefox-vX.xpi  — Firefox 128+ (без подписи: временная загрузка / Developer Edition)
#   dist/voxalike-plus-ordaxed.user.js         — Tampermonkey / Violentmonkey (любой браузер)
#   extension-build/                           — распакованная папка для «Загрузить распакованное»
set -euo pipefail
cd "$(dirname "$0")"
VER=$(node -p "require('./extension/manifest.json').version")

for f in src/vxp-*.js; do node --check "$f"; done

rm -rf dist build && mkdir -p dist build/chrome build/firefox
for d in chrome firefox; do
  cp -rp extension/icons extension/popup.html extension/popup.js build/$d/
  cp README.md build/$d/README.md
  for f in main bg fx room; do cp -p "src/vxp-$f.js" "build/$d/vxp-$f.js"; done
  node scripts/embed-models.js "build/$d/vxp-denoise.js"
  node --check "build/$d/vxp-denoise.js"
done
cp -p extension/manifest.json build/chrome/manifest.json
node scripts/make-firefox-manifest.js extension/manifest.json build/firefox/manifest.json

# Юзерскрипт из тех же файлов, что и расширение
node scripts/make-userscript.js build/chrome dist/voxalike-plus-ordaxed.user.js
node --check dist/voxalike-plus-ordaxed.user.js

# Воспроизводимые архивы: фиксированное время и порядок файлов
find build -exec touch -h -t 202601010000 {} +
zip_repro() { (cd "$1" && find . -type f | LC_ALL=C sort | zip -qrX "../../dist/$2" -@); }
zip_repro build/chrome  "voxalike-plus-ordaxed-chrome-v${VER}.zip"
zip_repro build/firefox "voxalike-plus-ordaxed-firefox-v${VER}.xpi"

rm -rf extension-build && cp -rp build/chrome extension-build && rm -rf build
echo "Built v${VER}:"; ls -la dist
