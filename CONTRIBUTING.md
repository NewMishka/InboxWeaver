# Contributing

## Базовые правила

1. Одна задача — одна ветка.
2. Одна сборка — одна понятная цель.
3. Baseline не изменяется напрямую.
4. Новая версия не становится baseline без подтверждённого тестирования.
5. Крупный рефакторинг не смешивается с исправлением отдельного бага.
6. XPI и исходники должны относиться к одной и той же версии.

## Имена веток

```text
fix/r-002-live-processing
fix/r-006-duplicate-engine
feature/export-xlsx
docs/update-architecture
refactor/storage-contract
```

## Commit messages

```text
fix: restore LiveMail processing for R-002
docs: document current baseline
test: add regression checks for duplicate handling
refactor: isolate statistics update contract
```

## Pull Request

PR должен содержать:

- что изменено;
- почему изменено;
- какие файлы затронуты;
- риски;
- что протестировано;
- ссылку на Issue;
- имя тестовой XPI.

## Merge policy

- рабочая ветка → Pull Request → `main`;
- перед merge обязательны зелёный CI и отсутствие незакрытых замечаний;
- релизы создаются из зафиксированного commit в `main`;
- прямые изменения `main` не используются для обычной разработки.

## Проверки перед Pull Request

```bash
node --test test/*.test.mjs
node --check background.js
find core modules mainPopup rulesTab settingsTab statisticsTab auditTab -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
git diff --check
```

Если изменение затрагивает интеграцию с почтовым клиентом, укажите в PR, какой ручной smoke ещё требуется.

## Подтверждение baseline

Новая сборка становится baseline только после явной фиксации:

```text
Сборка протестирована.
Ключевые сценарии пройдены.
Считаем версию новым development baseline.
```
