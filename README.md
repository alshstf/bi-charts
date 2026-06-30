# bi-charts — кастомные чарты Apache Superset для GigaID

Два кастомных плагина-визуализации Apache Superset для аналитики воронки регистраций GigaID, плюс тулинг для локальной разработки в Docker/OrbStack.

## Что внутри

- **`superset-plugin-chart-split-funnel/`** — основной плагин **Split Funnel**: воронка с точкой ветвления (общий ствол → параллельные мини-воронки по веткам, напр. sms / email / sber_id). Слияние общего финального шага в сегментированный итог, сворачивание веток, легенда с пересчётом (what-if), три базиса процентов, выравнивание баров, **small multiples** (сетка по партнёрам) с компактным свёрнутым видом, подсветка худшего drop-off, Drill to Detail. Бренд-палитра + светлая/тёмная темы.
- **`superset-plugin-chart-partner-registrations/`** — POC-плагин **Partner Registrations Timeseries** (с него начинали).
- **Тулинг:**
  - `setup-superset-dev.sh` — бутстрап с нуля: клонирует apache/superset нужного тега, собирает оба плагина, регистрирует их в `MainPreset`, патчит webpack, добавляет драйвер ClickHouse, поднимает контейнеры.
  - `rebuild-plugin.sh` — быстрый цикл: пересобрать оба плагина и перезапустить dev-сервер после правок кода.
  - `seed-funnel-data.sh`, `seed-demo-data.sh` — заливка синтетических данных воронки в Postgres compose-стека.
- **Темы:** `gigaid-theme.json`, `gigaid-theme-dark.json` (импортируются в Settings → Themes, Superset 6.x).

## Требования

- Docker / OrbStack (демон запущен)
- git, bash, python3

## Быстрый старт (новый ноутбук)

```bash
git clone <repo-url> bi-charts
cd bi-charts
./setup-superset-dev.sh
```

Скрипт идемпотентен. Дальше:

- следить за сборкой фронта: `docker logs -f superset_node` (ждать `compiled`);
- открыть Superset: указанный в конце скрипта URL, логин/пароль `admin` / `admin`;
- залить синтетику воронки: `./seed-funnel-data.sh`;
- темы: Settings → Themes, импортировать `gigaid-theme*.json`.

## Цикл разработки

1. Правим исходники в `superset-plugin-chart-*/src/`.
2. `./rebuild-plugin.sh` (пересборка обоих плагинов + рестарт `superset_node`, ~2–3 мин).
3. В браузере жёсткий перезагруз: `Cmd+Shift+R`.

> Примечание: webpack-watch в контейнере не видит правки с хоста (VirtioFS не доставляет inotify), поэтому надёжный путь — `rebuild-plugin.sh` с рестартом dev-сервера.

## Что НЕ в репозитории

- `superset/` — клон apache/superset (~4.5 ГБ), пересоздаётся `setup-superset-dev.sh`.
- `node_modules/`, `lib/`, `esm/` — зависимости и сборка плагинов (регенерируются).
- `superset-meta-backup-*.sql` — локальный бэкап метаданных с кредами БД. Для переноса дашборда используем чистый экспорт Superset (ZIP без паролей), а не сырой дамп.

## Дальше

- Переход на боевую схему данных (ClickHouse): драйвер `clickhouse-connect` уже доустанавливается в backend-контейнеры через `setup-superset-dev.sh`. Подключение вида `clickhousedb://user:pass@host:8123/db`, воронка считается через `windowFunnel()`.
