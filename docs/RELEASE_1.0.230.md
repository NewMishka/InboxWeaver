# Результат разработки 1.0.230

## Статус

- версия: `1.0.230`;
- ветка результата: `develop`;
- commit: `5d6ec16eb9f13204aa2aeeffbf7723ad83f6a4d1`;
- PR: `#57`, `#58`;
- тестовый артефакт: `inbox-weaver-v1.0.230-rfc-message-id-recovery-test62.xpi`;
- SHA-256: `8f65e477ca24e8a48a1141408160d3f4dfe79f3f3c25038383713fecaeab72d8`.

Это test candidate, а не production-релиз: XPI опубликован в [Google Drive](https://drive.google.com/file/d/1P5AFoM3bg5f1oSvaR9rpYKSBAoqv1ux9/view?usp=drivesdk) и как предварительный GitHub Release. До production-релиза требуется ручной протокол.

## Что реализовано

1. Отчёт восстанавливает отсутствующий у старых журналов RFC `Message-ID` из доступного исходного письма.
2. Временный идентификатор Thunderbird служит только ключом запроса и никогда не выводится в `message_id`.
3. Восстановление ограничено восемью параллельными запросами; ошибка одного письма не срывает экспорт.

## Проверки

- `node --test test/*.test.mjs` — 144/144;
- `node --check background.js`, `modules/messageReport.mjs`, `statisticsTab/statistics.js`;
- `git diff --check`;
- `git archive` из commit кандидата и `unzip -t` — без ошибок.

## Ручная приёмка

Перед production-публикацией пройти P-001–P-057 из `docs/PRODUCTION_TEST_PROTOCOL.md`, особенно P-057 для старой журнальной записи с доступным исходным письмом.
