#!/usr/bin/env bash
# Проверка релизных файлов на VirusTotal и запись результата в VIRUSTOTAL.md.
# Нужен бесплатный API-ключ VirusTotal: export VT_API_KEY=...   (https://www.virustotal.com/gui/my-apikey)
# Запуск после ./build.sh:  ./scripts/virustotal.sh
# Без ключа можно загрузить файлы вручную на https://www.virustotal.com и добавить ссылки в VIRUSTOTAL.md.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VT_API_KEY:?Задайте VT_API_KEY}"
VER=$(node -p "require('./extension/manifest.json').version")
OUT=$(mktemp)
for f in dist/*; do
  sha=$(sha256sum "$f" | cut -d' ' -f1)
  id=$(curl -sS --fail -H "x-apikey: $VT_API_KEY" -F "file=@$f" https://www.virustotal.com/api/v3/files | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.id')
  echo "Загружен $(basename "$f"), ожидаю анализ…" >&2
  for i in $(seq 1 30); do
    r=$(curl -sS -H "x-apikey: $VT_API_KEY" "https://www.virustotal.com/api/v3/analyses/$id")
    st=$(node -p 'JSON.parse(process.argv[1]).data.attributes.status' "$r")
    [ "$st" = completed ] && break; sleep 10
  done
  stats=$(node -p 'const s=JSON.parse(process.argv[1]).data.attributes.stats;`${s.malicious} / ${s.malicious+s.suspicious+s.undetected+s.harmless}`' "$r")
  echo "| $(basename "$f") | \`$sha\` | $stats | [отчёт](https://www.virustotal.com/gui/file/$sha) |" >> "$OUT"
done
{
  echo; echo "## v$VER ($(date -u +%Y-%m-%d))"; echo
  echo "| Файл | SHA-256 | Обнаружений | Ссылка |"; echo "|---|---|---|---|"; cat "$OUT"
} > "$OUT.sec"
echo "Добавьте секцию в начало списка VIRUSTOTAL.md:" >&2; cat "$OUT.sec"
