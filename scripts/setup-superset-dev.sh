#!/usr/bin/env bash
#
# Разворачивает или обновляет Apache Superset (dev-режим) в Docker/OrbStack
# с вкомпилированным плагином superset-plugin-chart-partner-registrations.
#
# Использование:  ./setup-superset-dev.sh
# Повторный запуск безопасен (идемпотентен). Если клон существует на другой
# версии — переключит на $SUPERSET_TAG (метаданные БД мигрируют вперед
# автоматически контейнером superset-init).
#
set -euo pipefail

SUPERSET_TAG="6.1.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# имя-папки:ИмяКласса:viz_key
PLUGINS=(
  "superset-plugin-chart-partner-registrations:PartnerRegistrationsChartPlugin:partner_registrations_timeseries"
  "superset-plugin-chart-split-funnel:SplitFunnelChartPlugin:split_funnel"
  "superset-plugin-chart-session-autopsy:SessionAutopsyChartPlugin:session_autopsy"
)
SUPERSET_DIR="$REPO_ROOT/superset"
FRONTEND_DIR="$SUPERSET_DIR/superset-frontend"
PLUGIN_NAME="superset-plugin-chart-partner-registrations"
PLUGIN_DIR="$REPO_ROOT/plugins/$PLUGIN_NAME"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Проверки -------------------------------------------------------------
command -v git >/dev/null    || fail "git не найден"
command -v docker >/dev/null || fail "docker не найден — запусти OrbStack"
docker info >/dev/null 2>&1  || fail "docker-демон недоступен — запусти OrbStack"
[ -d "$PLUGIN_DIR" ]         || fail "не найдена папка плагина: $PLUGIN_DIR"

# --- 1. Клонируем или переключаем Superset на нужный тег ----------------------
if [ ! -d "$SUPERSET_DIR/.git" ]; then
  log "Клонирую apache/superset @ $SUPERSET_TAG (shallow)"
  git clone --depth 1 --branch "$SUPERSET_TAG" \
    https://github.com/apache/superset.git "$SUPERSET_DIR"
else
  CURRENT_TAG="$(git -C "$SUPERSET_DIR" describe --tags --exact-match 2>/dev/null || echo unknown)"
  if [ "$CURRENT_TAG" != "$SUPERSET_TAG" ]; then
    log "Апгрейд клона: $CURRENT_TAG -> $SUPERSET_TAG"
    git -C "$SUPERSET_DIR" stash --include-untracked >/dev/null 2>&1 || true
    git -C "$SUPERSET_DIR" fetch --depth 1 origin tag "$SUPERSET_TAG"
    git -C "$SUPERSET_DIR" checkout -f "$SUPERSET_TAG"
    log "Чищу node_modules и кэш webpack (другая версия зависимостей)"
    rm -rf "$FRONTEND_DIR/node_modules" "$FRONTEND_DIR/.temp_cache" \
           "$PLUGIN_DEST" 2>/dev/null || true
  else
    log "Superset уже на $SUPERSET_TAG"
  fi
fi

# --- 2-3. Собираем каждый плагин в node:22 и копируем в workspace -------------
for entry in "${PLUGINS[@]}"; do
  name="${entry%%:*}"
  dir="$REPO_ROOT/plugins/$name"
  dest="$FRONTEND_DIR/plugins/$name"
  [ -d "$dir" ] || fail "не найдена папка плагина: $dir"
  log "Собираю $name в контейнере node:22"
  docker run --rm -v "$dir":/plugin -w /plugin node:22-bookworm bash -lc '
    set -e
    npm install --legacy-peer-deps --no-audit --no-fund --loglevel=error
    npm run build-cjs
    npm run build-esm
  '
  log "Копирую $name в workspace"
  mkdir -p "$dest"
  tar -C "$dir" --exclude node_modules --exclude '*.log' -cf - . \
    | tar -C "$dest" -xf -
done

# --- 4. Патчим MainPreset (.ts в 6.x, .js в 4.x/5.x) ---------------------------
MAINPRESET="$FRONTEND_DIR/src/visualizations/presets/MainPreset.ts"
[ -f "$MAINPRESET" ] || MAINPRESET="$FRONTEND_DIR/src/visualizations/presets/MainPreset.js"
[ -f "$MAINPRESET" ] || fail "не найден MainPreset.{ts,js}"
log "Регистрирую плагины в $(basename "$MAINPRESET")"
PLUGINS_SPEC="$(printf '%s\n' "${PLUGINS[@]}")" python3 - "$MAINPRESET" <<'PYEOF'
import os
import sys

path = sys.argv[1]
with open(path) as f:
    s = f.read()

import_anchor = "import TimeTableChartPlugin from '../TimeTable';"
plugins_anchor = "      plugins: [\n"
assert import_anchor in s, "не найден якорь импорта в MainPreset"
assert plugins_anchor in s, "не найден якорь plugins: [ в MainPreset"

for entry in os.environ["PLUGINS_SPEC"].strip().splitlines():
    name, cls, key = entry.strip().split(":")
    if name in s:
        print(f"{name}: уже зарегистрирован")
        continue
    s = s.replace(
        import_anchor,
        import_anchor + f"\nimport {{ {cls} }} from '{name}';",
    )
    s = s.replace(
        plugins_anchor,
        plugins_anchor
        + f"        new {cls}().configure({{\n"
        + f"          key: '{key}',\n"
        + "        }),\n",
        1,
    )
    print(f"{name}: зарегистрирован (key={key})")

with open(path, "w") as f:
    f.write(s)
PYEOF

# --- 4b. devServer host: в 6.x управляется env-переменной из compose,
# в 5.x требуется патч webpack.config.js ----------------------------------------
if grep -q "WEBPACK_DEVSERVER_HOST" "$FRONTEND_DIR/webpack.config.js"; then
  log "webpack devServer host настраивается через env (6.x) — патч не нужен"
else
  log "Патчу webpack.config.js (devServer host 0.0.0.0 — версия 5.x)"
  python3 - "$FRONTEND_DIR/webpack.config.js" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path) as f:
    s = f.read()

if "host: '0.0.0.0'" in s:
    print("webpack.config.js уже пропатчен")
    sys.exit(0)

anchor = "  config.devServer = {\n    historyApiFallback: true,\n    hot: true,\n"
assert anchor in s, "не найден якорь devServer в webpack.config.js"
s = s.replace(
    anchor,
    anchor + "    host: '0.0.0.0',\n    allowedHosts: 'all',\n",
    1,
)
with open(path, "w") as f:
    f.write(s)
print("webpack.config.js пропатчен")
PYEOF
fi

# --- 5. Драйвер ClickHouse в backend-контейнеры --------------------------------
log "Добавляю clickhouse-connect в docker/requirements-local.txt"
REQ_LOCAL="$SUPERSET_DIR/docker/requirements-local.txt"
touch "$REQ_LOCAL"
grep -q '^clickhouse-connect' "$REQ_LOCAL" || echo 'clickhouse-connect' >> "$REQ_LOCAL"

# --- 6. Конфиг: без демо-примеров + темизация UI (6.x) --------------------------
ENV_FILE="$SUPERSET_DIR/.env"
touch "$ENV_FILE"
grep -q '^SUPERSET_LOAD_EXAMPLES=' "$ENV_FILE" \
  || echo 'SUPERSET_LOAD_EXAMPLES=no' >> "$ENV_FILE"

CFG="$SUPERSET_DIR/docker/pythonpath_dev/superset_config_docker.py"
if [ ! -f "$CFG" ] || ! grep -q 'ENABLE_UI_THEME_ADMINISTRATION' "$CFG"; then
  log "Включаю администрирование тем UI (Settings -> Themes)"
  cat >> "$CFG" <<'PYCFG'
# GigaID bi-charts: управление темами из UI (Superset 6.x)
ENABLE_UI_THEME_ADMINISTRATION = True
PYCFG
fi

# --- 6b. Пиним postgres:15 (том данных создан на 15-й, в 6.1 compose --> 17) ----
OVERRIDE="$SUPERSET_DIR/docker-compose.override.yml"
if [ ! -f "$OVERRIDE" ]; then
  log "Создаю docker-compose.override.yml (postgres:15 для существующего тома)"
  cat > "$OVERRIDE" <<'YML'
# Явные имена контейнеров — для удобства ручных docker logs/restart.
# Скрипты проекта на имена не завязаны (используют docker compose exec).
services:
  db:
    image: postgres:15
    container_name: superset_db
  superset-node:
    container_name: superset_node
  superset:
    container_name: superset_app
    build:
      cache_from: []
  superset-init:
    container_name: superset_init
    build:
      cache_from: []
  superset-worker:
    container_name: superset_worker
    build:
      cache_from: []
YML
fi

# --- 7. Поднимаем контейнеры ----------------------------------------------------
# без nginx (порт 80) и superset-websocket (8080) — для dev они не нужны
log "Собираю и запускаю контейнеры (при смене версии — снова долго, 15-30 минут)"
cd "$SUPERSET_DIR"
docker compose up -d --build superset superset-node superset-worker

log "Готово! Что дальше:"
cat <<TXT
  1. Следить за сборкой фронтенда:   docker logs -f superset_node
     (ждать 'compiled' — при смене версии npm install снова долгий)
  2. Открыть Superset:               http://superset-node.superset.orb.local:9000
     Логин/пароль:                   admin / admin
  3. Темы UI:                        Settings -> Themes (Superset 6.x)
  4. Чарт плагина: "Partner Registrations Timeseries" (категория Evolution)

  Пересборка плагина после правок кода:  ./scripts/rebuild-plugin.sh
  Остановить всё:                        cd superset && docker compose down
TXT
