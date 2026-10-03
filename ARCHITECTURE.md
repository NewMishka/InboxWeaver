# Архитектура проекта

Актуальная подробная архитектура находится в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Краткая схема

```text
Thunderbird events / UI commands
              ↓
         background.js
        (composition root)
              ↓
  ┌───────────┼────────────┐
  ↓           ↓            ↓
Message    Startup      Force export
pipeline   catch-up
  ↓
Rules → Attachments → SHA registry → Download
  ↓                         ↓
Audit logs ─────────→ Statistics projection → UI/XLSX
```

## Главный принцип

`background.js` только связывает сервисы и Thunderbird API. Бизнес-логика должна находиться в тестируемых `core/*.mjs` и `modules/*.mjs`.
