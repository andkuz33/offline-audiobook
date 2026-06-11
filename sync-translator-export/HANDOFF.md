# Перенос в репозиторий sync-translator — инструкция

Файлы проекта лежат в репозитории `andkuz33/offline-audiobook`, ветка
`claude/github-sync-translator-project-46yhx4`:

- `web-live/` — веб-приложение на Gemini Live (основная версия);
- `ios-sync-translator/` — нативный прототип SwiftUI (на будущее);
- `sync-translator-export/` — этот перенос (скрипт + корневой README).

## Способ A — новая сессия Claude Code на репозитории sync-translator

Создайте сессию с репозиторием `andkuz33/sync-translator` и дайте ассистенту такую задачу:

> Импортируй проект «Синхронный переводчик» из репозитория
> `andkuz33/offline-audiobook`, ветка `claude/github-sync-translator-project-46yhx4`.
> Содержимое `web-live/` положи в корень этого репозитория (для GitHub Pages),
> содержимое `ios-sync-translator/` — в папку `ios-native/`, а корневым README
> сделай `sync-translator-export/root-README.md`. Закоммить и запушь в `main`.

## Способ B — запустить скрипт на любом ПК с git

```bash
git clone --depth 1 -b claude/github-sync-translator-project-46yhx4 \
  https://github.com/andkuz33/offline-audiobook.git
cd offline-audiobook/sync-translator-export
bash populate.sh
```

## После переноса

Включите GitHub Pages: **Settings → Pages → Source: `main`, папка `/ (root)`**.
Приложение откроется по адресу `https://andkuz33.github.io/sync-translator/`.
