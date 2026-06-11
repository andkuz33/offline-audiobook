#!/usr/bin/env bash
#
# Переносит проект «Синхронный переводчик» в репозиторий andkuz33/sync-translator
# с чистой структурой (ios/ + web/). Запускать ЛОКАЛЬНО на машине, где есть
# доступ к вашему GitHub (например, Mac с настроенным git).
#
#   bash populate.sh
#
set -euo pipefail

SRC_REPO="https://github.com/andkuz33/offline-audiobook.git"
SRC_BRANCH="claude/github-sync-translator-project-46yhx4"
DST_REPO="https://github.com/andkuz33/sync-translator.git"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "→ Клонирую исходную ветку с файлами проекта…"
git clone --depth 1 --branch "$SRC_BRANCH" "$SRC_REPO" "$work/src"

echo "→ Клонирую целевой репозиторий sync-translator…"
git clone "$DST_REPO" "$work/dst"

echo "→ Раскладываю структуру ios/ и web/ …"
mkdir -p "$work/dst/ios" "$work/dst/web"
cp -R "$work/src/ios-sync-translator/." "$work/dst/ios/"
cp -R "$work/src/sync-translator/."     "$work/dst/web/"
cp    "$work/src/sync-translator-export/root-README.md" "$work/dst/README.md"

cd "$work/dst"
git add -A
if git diff --cached --quiet; then
  echo "Нечего коммитить — содержимое уже актуально."
  exit 0
fi
git commit -m "Импорт проекта «Синхронный переводчик»: iOS-прототип (Gemini Live) и web-PWA"
git push origin HEAD
echo "✓ Готово: https://github.com/andkuz33/sync-translator"
