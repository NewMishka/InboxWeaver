# Процесс выпуска

## Подготовка

1. Работайте в отдельной ветке от актуального `main`.
2. Обновите код, тесты, документацию и номер версии только в рамках одной понятной задачи.
3. Перед Pull Request выполните полный набор автоматических проверок.
4. Merge в `main` выполняйте только после зелёного CI и проверки diff.

## Автоматические проверки

```bash
node --test test/*.test.mjs
node --check background.js
find core modules mainPopup rulesTab settingsTab statisticsTab auditTab -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
git diff --check
```

Релизный workflow повторно проверяет исходники, собирает XPI из конкретного commit, выполняет `unzip -t` и формирует `SHA256SUMS`.

## Выпуск

Для линии 2.0 workflow `.github/workflows/release-2.0.yml` создаёт GitHub pre-release `v2.0`, если такого Release ещё нет.

Release должен содержать:

- версию;
- commit SHA;
- XPI;
- SHA-256;
- release notes;
- результаты автоматических проверок;
- фактический статус ручной приёмки.

Опубликованный XPI не перезаписывается другим содержимым под тем же именем.

## Production-статус

Автоматические тесты не заменяют проверку реального почтового клиента. Пока ручной [протокол P-001–P-057](PRODUCTION_TEST_PROTOCOL.md) не завершён, версия 2.0 остаётся **pre-release**.

После ручной приёмки:

1. зафиксируйте PASS/FAIL критических сценариев;
2. опишите ограничения;
3. исправьте блокирующие дефекты отдельной версией;
4. только после этого меняйте статус production baseline.

Ссылки: [README](../README.md) · [руководство](USER_GUIDE.md) · [CHANGELOG](../CHANGELOG.md) · [GitBook](https://newmishka.gitbook.io/inbox-weaver-dokumentaciya/).
