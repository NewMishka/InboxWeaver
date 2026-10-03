# Проверка и сборка XPI

Сборку выполняйте только из зафиксированного commit. Изменения в рабочем дереве не попадут в XPI.

```bash
node --test test/*.test.mjs
node --check background.js
find core modules mainPopup rulesTab settingsTab statisticsTab auditTab -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
git diff --check
git status --short
bash scripts/build-xpi.sh HEAD /tmp/inbox-weaver-v2.0.xpi
unzip -t /tmp/inbox-weaver-v2.0.xpi
sha256sum /tmp/inbox-weaver-v2.0.xpi
```

Скрипт читает только зафиксированные runtime blobs указанного Git commit и `LICENSE`, затем создаёт ZIP с постоянным порядком и временными метками. Совпадающее дерево runtime-файлов даёт одинаковый XPI независимо от времени сборки. README, PDF, тесты и история хранятся в репозитории, но не раздувают устанавливаемый XPI. Нужны Python 3, Git, Node.js и `unzip`. Укажите конкретный SHA первым аргументом, чтобы привязать сборку к commit. Перед публикацией проверьте `manifest.json` и `LICENSE` внутри архива и имя артефакта.

Не перезаписывайте существующий артефакт другим содержимым. Укажите SHA-256, commit, результаты тестов и статус ручной проверки на странице релиза.
