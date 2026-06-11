#!/usr/bin/env bash
#
# Переносит проект «Синхронный переводчик» в репозиторий andkuz33/sync-translator.
# Структура: веб-приложение (Gemini Live) — в корень, нативный прототип — в ios-native/.
# Запускать ЛОКАЛЬНО на любом ПК с git (Mac не нужен).
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

echo "→ Раскладываю структуру…"
# Веб-приложение (Gemini Live) — в корень репозитория (удобно для GitHub Pages).
cp -R "$work/src/web-live/." "$work/dst/"
# Свой README веб-версии переносим в docs, чтобы корневой README был общим.
mkdir -p "$work/dst/docs"
[ -f "$work/dst/README.md" ] && mv "$work/dst/README.md" "$work/dst/docs/web-details.md"
# Нативный прототип — отдельной папкой.
mkdir -p "$work/dst/ios-native"
cp -R "$work/src/ios-sync-translator/." "$work/dst/ios-native/"
# Общий корневой README.
cp "$work/src/sync-translator-export/root-README.md" "$work/dst/README.md"

cd "$work/dst"
git add -A
if git diff --cached --quiet; then
  echo "Нечего коммитить — содержимое уже актуально."
  exit 0
fi
git commit -m "Импорт проекта «Синхронный переводчик»: веб-версия (Gemini Live) + нативный прототип"
git push origin HEAD
echo "✓ Готово: https://github.com/andkuz33/sync-translator"
echo "  Включите GitHub Pages (Settings → Pages → main → / root)."
