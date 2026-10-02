# Minimal Kanban

Self-hosted канбан для небольшой команды. PostgreSQL обязателен; файлы задач
хранятся отдельно на диске и резервируются вместе с базой.

## Локальный запуск

Самый короткий воспроизводимый путь:

```sh
docker compose up -d --build
```

После успешных healthchecks откройте `http://127.0.0.1:5173`. Локальная
тестовая учётная запись: `admin@example.com` / `change-me-now`. Эти реквизиты
разрешены только в development-окружении и запрещены production-конфигурацией.

Для разработки без контейнеров скопируйте `.env.example` в `.env`, выполните
`npm ci`, `npm run db:migrate`, затем `npm run dev`.

## Роли и видимость

- `Пользователь` работает со всеми сущностями продукта, но видит только доски,
  назначенные ему напрямую или через отдел.
- `Администратор` видит все доски и управляет обычными пользователями: создаёт,
  отключает, меняет пароль и выдаёт доступ к отделам и отдельным доскам.
- `Суперадминистратор` дополнительно создаёт администраторов и меняет роли.

Назначение отдела автоматически распространяется на его будущие доски. Роль
на уровне отдельной доски не даёт административных полномочий.

## Проверки

```sh
npm run format:check
npm run typecheck
npm run lint
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

Production-требования, rootless Podman, собственный PostgreSQL, внутренний
HTTP, CI, pull-based автодеплой и проверенный backup/restore описаны в
`docs/operations.md`.

## Browser tests

Run the Compose stack first, then use `npm run test:e2e`. Playwright targets
`http://127.0.0.1:5173` by default; override it with `E2E_BASE_URL` for an
isolated test environment. Set `E2E_EMAIL` and `E2E_PASSWORD` to its bootstrap
account. The task-creation test creates a uniquely named board and deliberately
does not delete it, so it never removes user data.

Если на рабочей машине уже установлен Chrome, браузер можно не скачивать:
`E2E_BROWSER_CHANNEL=chrome npm run test:e2e`.
