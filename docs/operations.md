# Production operations

Целевая схема для внутренней сети:

- сервер приложения: `192.168.1.13`, пользователь `vladislav`, rootless Podman;
- nginx на этом же сервере принимает `http://kanban.tfoms`;
- PostgreSQL 17 запускается отдельным контейнером проекта;
- каталог приложения: `/home/vladislav/apps/minimal-kanban`;
- секреты: `/home/vladislav/.config/kanban/api.env`;
- вложения: `/home/vladislav/apps/minimal-kanban-data/uploads`;
- резервные копии: `/home/vladislav/backups/minimal-kanban`.

Внешняя база и отдельный администратор PostgreSQL не нужны. Compose сам создаёт
базу и роль при первом запуске. Порт PostgreSQL на сервере не публикуется:
доступ к БД есть только внутри приватной Compose-сети. Данные хранятся в
постоянном named volume `minimal-kanban_postgres-data` и переживают обычные
`up`, `down`, перезапуск и замену каталога релиза.

Никогда не запускайте `podman compose down -v` и не удаляйте этот volume:
такие команды удаляют рабочую базу.

## Сеть и внутренний HTTP

Создайте внутреннюю DNS-запись `kanban.tfoms -> 192.168.1.13`. Установите
`deploy/nginx/kanban.conf` как отдельный virtual host, проверьте `nginx -t` и
перезагрузите nginx. Контейнер web доступен только на `127.0.0.1:8080`, а
PostgreSQL вообще не имеет host-порта.

HTTP здесь включён намеренно через `ALLOW_INSECURE_HTTP=true`. Он не шифрует
пароли и сессионные cookie, поэтому порт 80 должен быть доступен только из
доверенной корпоративной сети и не должен публиковаться в интернет. Проверка
Origin/CSRF, HttpOnly и SameSite остаются включёнными, но не заменяют TLS.

## Создание релиза

После прохождения всех проверок:

```sh
chmod +x deploy/*.sh
deploy/package-release.sh ./minimal-kanban-release-20261001.tar.gz 20261001
```

Архив содержит исходники для сборки контейнеров, deployment-файлы, `RELEASE`
и `SHA256SUMS`. В него не входят `.env`, данные, `node_modules`, build output и
артефакты браузерных тестов.

Скопируйте архив на сервер, распакуйте в новый временный каталог и проверьте:

```sh
release_archive="$HOME/minimal-kanban-release-20261001.tar.gz"
mkdir -p "$HOME/tmp"
release_stage=$(mktemp -d "$HOME/tmp/minimal-kanban.XXXXXX")
tar -xzf "$release_archive" -C "$release_stage"
cd "$release_stage/minimal-kanban-release"
sha256sum -c SHA256SUMS
```

Первичная установка:

```sh
mkdir -p "$HOME/apps/minimal-kanban"
cp -a "$release_stage/minimal-kanban-release/." "$HOME/apps/minimal-kanban/"
```

## Настройка и первый запуск

Создайте пользовательские каталоги без `sudo`:

```sh
install -d -m 0700 \
  "$HOME/.config/kanban" \
  "$HOME/apps/minimal-kanban-data/uploads" \
  "$HOME/backups/minimal-kanban"
podman unshare chown 1000:1000 \
  "$HOME/apps/minimal-kanban-data/uploads"
install -m 0600 "$HOME/apps/minimal-kanban/.env.production.example" \
  "$HOME/.config/kanban/api.env"
```

Сгенерируйте URL-safe пароль базы:

```sh
openssl rand -hex 32
```

В `~/.config/kanban/api.env` замените оба
`REPLACE_WITH_64_HEX_PASSWORD` одним полученным значением. Задайте уникальный
пароль первого пользователя приложения. Оставьте согласованный HTTP-набор:

```dotenv
ALLOW_INSECURE_HTTP=true
SESSION_COOKIE_SECURE=false
APP_ORIGIN=http://kanban.tfoms
PUBLIC_URL=http://kanban.tfoms
```

`INITIAL_ADMIN_EMAIL` и `INITIAL_ADMIN_PASSWORD` относятся не к PostgreSQL, а
к первой учётной записи канбана. Она создаётся суперадминистратором: только эта
роль может назначать других администраторов. Публичной регистрации нет, поэтому
переменные нужны только при первом запуске пустой базы. При обновлении с версии,
где существовала одна роль администратора, действующие администраторы
автоматически становятся суперадминистраторами, чтобы не потерять доступ.

Проверьте конфигурацию и запустите весь стек:

```sh
cd "$HOME/apps/minimal-kanban"
podman compose --env-file "$HOME/.config/kanban/api.env" \
  -f compose.prod.yml config >/dev/null
podman compose --env-file "$HOME/.config/kanban/api.env" \
  -f compose.prod.yml up -d --build
ENV_FILE="$HOME/.config/kanban/api.env" PODMAN=podman deploy/verify.sh
```

После успешного входа удалите из env-файла обе строки
`INITIAL_ADMIN_EMAIL` и `INITIAL_ADMIN_PASSWORD`, затем примените конфигурацию:

```sh
podman compose --env-file "$HOME/.config/kanban/api.env" \
  -f compose.prod.yml up -d api
```

## Запуск после перезагрузки

`loginctl show-user "$USER" -p Linger` должен вернуть `Linger=yes`. Установите
пользовательский unit:

```sh
mkdir -p "$HOME/.config/systemd/user"
cp deploy/systemd/kanban-compose.service \
  "$HOME/.config/systemd/user/kanban-compose.service"
systemctl --user daemon-reload
systemctl --user enable --now kanban-compose.service
systemctl --user status kanban-compose.service --no-pager
```

Внешний администратор нужен только для корпоративной DNS-записи, firewall и
nginx, если у пользователя `vladislav` нет прав на их изменение. Для создания
PostgreSQL-базы администратор больше не требуется.

## Обновление

### Автоматическое обновление из `main`

Репозиторий публичный, поэтому production-сервер намеренно не регистрируется
как self-hosted GitHub Runner. CI выполняется на GitHub-hosted runner без
доступа к внутренней сети. Сервер сам проверяет `origin/main` раз в пять минут
и не открывает входящие SSH-подключения для GitHub.

Перед установкой таймера убедитесь, что GitHub Actions включены для
репозитория. Workflow `CI` проверяет форматирование, типы, ESLint, unit- и
integration-тесты, production build и Playwright на desktop/mobile. Сервер
обновляется только когда push-run `CI` для точного SHA завершился успешно.

Однократная установка после попадания этих файлов в `main`:

```sh
cd "$HOME/apps/minimal-kanban"
git pull --ff-only origin main
loginctl show-user "$USER" -p Linger
chmod +x deploy/*.sh
mkdir -p "$HOME/.config/systemd/user" "$HOME/.local/state/minimal-kanban"
cp deploy/systemd/kanban-autodeploy.service \
  "$HOME/.config/systemd/user/kanban-autodeploy.service"
cp deploy/systemd/kanban-autodeploy.timer \
  "$HOME/.config/systemd/user/kanban-autodeploy.timer"
systemctl --user daemon-reload
systemctl --user enable --now kanban-autodeploy.timer
systemctl --user start kanban-autodeploy.service
systemctl --user status kanban-autodeploy.timer --no-pager
journalctl --user -u kanban-autodeploy.service -n 100 --no-pager
```

Если `loginctl` показывает `Linger=no`, DevOps должен один раз выполнить
`sudo loginctl enable-linger vladislav`. Без linger пользовательский таймер может
перестать запускаться после выхода `vladislav` из SSH.

Каждое обновление выполняется под `vladislav` и последовательно:

1. Берёт неблокирующий lock и отказывается работать с грязным checkout.
2. Разрешает только fast-forward ветки `main` из ожидаемого репозитория.
3. Проверяет успешный GitHub Actions workflow `CI` для точного commit SHA.
4. Создаёт согласованный backup БД и вложений.
5. Обновляет код и `IMAGE_TAG`, собирает и запускает контейнеры.
6. Проверяет web, API healthcheck и таблицу миграций через loopback URL.
7. При ошибке возвращает предыдущий код и предыдущие образы. Backup остаётся
   для ручного восстановления данных; автоматический destructive restore БД
   не выполняется.

Проверить расписание и последний запуск:

```sh
systemctl --user list-timers kanban-autodeploy.timer --all
systemctl --user status kanban-autodeploy.service --no-pager
journalctl --user -u kanban-autodeploy.service -n 100 --no-pager
```

Остановить автоматические обновления, не останавливая сам Kanban:

```sh
systemctl --user disable --now kanban-autodeploy.timer
```

### Ручное обновление релизным архивом

1. Соберите и проверьте новый release archive.
2. Сделайте backup текущим релизом.
3. Распакуйте новый архив в отдельный каталог и проверьте `SHA256SUMS`.
4. Запишите значение из `RELEASE` в `IMAGE_TAG` внешнего env-файла.
5. Остановите user unit, переместите текущий каталог релиза в датированный
   rollback-каталог и атомарно поставьте новый каталог на его место.
6. Запустите `podman compose ... up -d --build`, затем `deploy/verify.sh`.

Стабильное имя Compose-проекта в `compose.prod.yml` сохраняет тот же volume БД
при замене каталога релиза. Не запускайте параллельные обновления: API применяет
append-only миграции перед стартом и рассчитан на один production-экземпляр.

## Backup и restore

Скрипты используют служебный PostgreSQL 17 container; устанавливать `psql` или
`pg_dump` на хост не нужно. Backup кратко останавливает API и сохраняет БД и
вложения как один согласованный набор:

```sh
cd "$HOME/apps/minimal-kanban"
ENV_FILE="$HOME/.config/kanban/api.env" PODMAN=podman deploy/backup.sh
```

Храните `SHA256SUMS`, `database.dump` и `uploads.tar` вместе и копируйте набор
на независимый носитель. Named volume не является резервной копией.

Restore перезаписывает текущую БД и меняет каталог вложений только после
явного подтверждения:

```sh
cd "$HOME/apps/minimal-kanban"
ENV_FILE="$HOME/.config/kanban/api.env" \
BACKUP_SET="$HOME/backups/minimal-kanban/kanban-YYYYMMDDTHHMMSSZ" \
CONFIRM_RESTORE=YES PODMAN=podman deploy/restore.sh
```

Перед production restore сделайте свежий backup. При откате неудачной миграции
сначала установите совместимый код и используйте
`RESTART_API_AFTER_RESTORE=false`; запускайте API вручную только после проверки
согласованности базы и вложений.
