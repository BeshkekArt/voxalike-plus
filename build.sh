#!/usr/bin/env bash
# Сборка Voxalike+:
#   dist/voxalike-plus-chrome-vX.zip   — Chrome / Edge / Яндекс / Opera / Brave
#   dist/voxalike-plus-firefox-vX.xpi  — Firefox 128+
#   dist/voxalike-plus.user.js         — Tampermonkey / Violentmonkey (любой браузер)
set -euo pipefail
cd "$(dirname "$0")"
VER=$(node -p "require('./extension/manifest.json').version")
FFVER=$(node -p "require('./extension/manifest.firefox.json').version")
[ "$VER" = "$FFVER" ] || { echo "Версии манифестов не совпадают: $VER vs $FFVER"; exit 1; }
node --check src/vxp-main.js

rm -rf dist build && mkdir -p dist build/chrome build/firefox
cp README.md extension/README.md
for d in chrome firefox; do
  cp -r extension/icons extension/popup.html extension/README.md build/$d/
  cp src/vxp-main.js build/$d/vxp-main.js
done
cp extension/manifest.json build/chrome/manifest.json
cp extension/manifest.firefox.json build/firefox/manifest.json
cp src/vxp-main.js extension/vxp-main.js

(cd build/chrome && zip -qr "../../dist/voxalike-plus-chrome-v${VER}.zip" .)
(cd build/firefox && zip -qr "../../dist/voxalike-plus-firefox-v${VER}.xpi" .)

# Юзерскрипт: код внедряется тегом <script>, поэтому всегда работает в контексте страницы
node -e '
const fs=require("fs"); const ver=process.argv[1];
const code=fs.readFileSync("src/vxp-main.js","utf8");
const head=`// ==UserScript==
// @name         Voxalike+
// @namespace    voxalike-plus
// @version      ${ver}
// @description  Две дорожки со сдвигом, питч и громкость, усиление микрофона, отсчёт 3-2-1, буфер записи, запись всех своих реплик заранее
// @match        https://voxalike.com/*
// @match        https://www.voxalike.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
`;
const body=`(function () {
  var code = ${JSON.stringify(code)};
  var s = document.createElement("script");
  s.textContent = code;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
})();
`;
fs.writeFileSync("dist/voxalike-plus.user.js", head + body);
' "$VER"
node --check dist/voxalike-plus.user.js
rm -rf build
echo "Built v${VER}:"; ls -la dist
