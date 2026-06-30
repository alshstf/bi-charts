# bi-charts — кастомные чарты Apache Superset для GigaID

Кастомные плагины-визуализации Apache Superset для аналитики воронки регистраций GigaID, плюс тулинг для локальной разработки в Docker/OrbStack.

## Структура

```
bi-charts/
├── plugins/                                  # исходники чартов (по одному на папку)
│   ├── superset-plugin-chart-split-funnel/       # основной: Split Funnel
│   └── superset-plugin-chart-partner-registrations/  # POC: Partner Registrations Timeseries
├── scripts/                                  # тулинг
│   ├── setup-superset-dev.sh                     # бутстрап окружения с нуля
│   ├── rebuild-plugin.sh                         # быстрый цикл пересборки
│   ├── seed-funnel-data.sh                       # синтетика воронки в Postgres
│   └── seed-demo-data.sh                         # синтетика таймсерий
├── themes/                                   # темы Superset (Settings → Themes)
│   ├── gigaid-theme.json
│   └── gigaid-theme-dark.json
├── package.json                              # ярлыки npm run setup/rebuild/seed
├── superset/                                 # клон apache/superset (в .gitignore, создаётся скриптом)
└── superset-meta-backup-*.sql                # локальный дамп метаданных (в .gitignore: креды БД)
```

## Что внутри

- **`plugins/superset-plugin-chart-split-funnel`** — основной плагин **Split Funnel**: воронка с точкой ветвления (общий ствол → параллельные мини-воронки по веткам, напр. sms / email / sber_id). Слияние общего финального шага в сегментированный итог, сворачивание веток, легенда с пересчётом (what-if), три базиса процентов, выравнивание баров, **small multiples** (сетка по партнёрам) с компактным свёрнутым видом, подсветка худшего drop-off, Drill to Detail. Бренд-палитра + светлая/тёмная темы.
- **`plugins/superset-plugin-chart-partner-registrations`** — POC-плагин **Partner Registrations Timeseries**.
- **`scripts/`** — тулинг:
  - `setup-superset-dev.sh` — бутстрап с нуля: клонирует apache/superset нужного тега, собирает оба плагина, регистрирует их в `MainPreset`, патчит webpack, добавляет драйвер ClickHouse, поднимает контейнеры.
  - `rebuild-plugin.sh` — пересобрать оба плагина и перезапустить dev-сервер после правок кода.
  - `seed-funnel-data.sh`, `seed-demo-data.sh` — синтетические данные в Postgres compose-стека.
- **`themes/`** — `gigaid-theme.json`, `gigaid-theme-dark.json` (импорт в Settings → Themes, Superset 6.x).

## Требования

- Docker / OrbStack (демон запущен)
- git, bash, python3

## Быстрый старт (новый ноутбук)

```bash
git clone <repo-url> bi-charts
cd bi-charts
./scripts/setup-superset-dev.sh      # или: npm run setup
```

Скрипт идемпотентен. Дальше:

- следить за сборкой фронта: `docker logs -f superset_node` (ждать `compiled`);
- открыть Superset: URL из вывода скрипта, логин/пароль `admin` / `admin`;
- залить синтетику воронки: `./scripts/seed-funnel-data.sh` (или `npm run seed:funnel`);
- темы: Settings → Themes, импортировать `themes/gigaid-theme*.json`.

## Цикл разработки

1. Правим исходники в `plugins/superset-plugin-chart-*/src/`.
2. `./scripts/rebuild-plugin.sh` (или `npm run rebuild`) — пересборка обоих плагинов + рестарт `superset_node`, ~2–3 мин.
3. В браузере жёсткий перезагруз: `Cmd+Shift+R`.

> Webpack-watch в контейнере не видит правки с хоста (VirtioFS не доставляет inotify), поэтому надёжный путь — `rebuild-plugin.sh` с рестартом dev-сервера.

## Добавить новый чарт

1. Скопировать существующий плагин в `plugins/superset-plugin-chart-<name>/`, поменять имя пакета, класс, `viz_key`, thumbnail.
2. Добавить строку в массив `PLUGINS` в `scripts/setup-superset-dev.sh` и `scripts/rebuild-plugin.sh` (формат `имя-папки:ИмяКласса:viz_key`).
3. `./scripts/setup-superset-dev.sh` зарегистрирует его в `MainPreset` и соберёт.

## Перенос дашборда

Дашборд «GigaID · Регистрации» переносится между стендами чистым экспортом Superset (YAML в ZIP; пароли БД маскируются, поэтому ZIP безопасно коммитить).

```bash
./scripts/export-dashboards.sh        # выгрузит exports/gigaid_dashboards.zip + проверит на пароли
```

Импорт на другом стенде — команды печатает сам скрипт в конце (через `superset import-dashboards`). На импорте пароли БД нужно будет ввести заново (они в экспорт не попадают).

## Что НЕ в репозитории

- `superset/` — клон apache/superset (~4.5 ГБ), пересоздаётся `setup-superset-dev.sh`.
- `node_modules/`, `lib/`, `esm/` — зависимости и сборка плагинов (регенерируются).
- `superset-meta-backup-*.sql` — локальный бэкап метаданных с кредами БД. Для переноса дашборда используем чистый экспорт Superset (ZIP без паролей), а не сырой дамп.

## Дальше

- Переход на боевую схему данных (ClickHouse): драйвер `clickhouse-connect` уже доустанавливается в backend-контейнеры через `setup-superset-dev.sh`. Подключение вида `clickhousedb://user:pass@host:8123/db`, воронка считается через `windowFunnel()`.
- Общий код между чартами → `packages/shared` + включить npm workspaces (`plugins/*`, `packages/*`).
- Независимые версии/релизы по чартам → Changesets (одна репа, версии на пакет).
