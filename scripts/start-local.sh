#!/usr/bin/env bash
#
# Поднимает локальное окружение GigaID bi-charts ОДНОЙ командой (после перезагрузки):
#   • бэкенд Superset в Docker  — app, worker, db, redis
#   • фронтенд (webpack dev-server) НА ХОСТЕ, нативно (arm64)
#
# Почему фронт на хосте, а не в Docker: на Apple Silicon + Docker Desktop
# (Apple Virtualization Framework) Rust/napi-rs тулинг Superset — @swc/core, nx,
# unrs-resolver — падает с SIGBUS (Bus error) при загрузке в Linux-VM. На хосте
# darwin-arm64 бинарники работают. Подробности: см. README / bi-charts-local-env.
#
# Использование:  ./scripts/start-local.sh     (или: npm run up)
# Повторный запуск безопасен (идемпотентен).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPERSET_DIR="$REPO_ROOT/superset"
FRONTEND_DIR="$SUPERSET_DIR/superset-frontend"
NODE_BIN="/opt/homebrew/opt/node@22/bin"
DEV_LOG="/tmp/gigaid-dev-server.log"
FRONT_PORT=9000
BACK_PORT=8088

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Проверки -------------------------------------------------------------
[ -d "$SUPERSET_DIR/.git" ] || fail "нет клона superset ($SUPERSET_DIR). Сначала: ./scripts/setup-superset-dev.sh"
[ -x "$NODE_BIN/node" ]     || fail "нет node@22 ($NODE_BIN). Установи: brew install node@22"

# --- 1. Docker демон ---------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  log "Docker не запущен — стартую Docker Desktop и жду демон"
  open -a Docker || fail "не смог запустить Docker Desktop"
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || fail "Docker демон так и не поднялся"
fi

# --- 2. Бэкенд в Docker ------------------------------------------------------
# superset-node НЕ поднимаем: в dev он собирал бы фронт внутри VM (SIGBUS) и,
# что хуже, перезаписал бы host-node_modules linux-бинарниками. Гасим на всякий.
log "Поднимаю бэкенд: superset, superset-worker (+ db, redis, init)"
( cd "$SUPERSET_DIR" \
    && docker compose stop superset-node >/dev/null 2>&1 || true \
    && docker compose up -d superset superset-worker )

log "Жду бэкенд на http://localhost:$BACK_PORT/health"
for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$BACK_PORT/health" 2>/dev/null)" = "200" ] \
    && { echo "  бэкенд готов"; break; }
  sleep 2
done

# --- 3. Фронтенд dev-server на хосте -----------------------------------------
if lsof -nP -iTCP:"$FRONT_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  log "Фронтенд уже слушает :$FRONT_PORT — новый не стартую"
else
  [ -d "$FRONTEND_DIR/node_modules" ] || fail "нет node_modules фронта. Один раз: (cd $FRONTEND_DIR && PATH=$NODE_BIN:\$PATH npm ci --ignore-scripts)"
  log "Стартую webpack dev-server на хосте (лог: $DEV_LOG)"
  ( cd "$FRONTEND_DIR" && PATH="$NODE_BIN:$PATH" nohup npm run dev-server > "$DEV_LOG" 2>&1 & )
  log "Жду компиляцию фронта (первый раз ~1 мин)…"
  for _ in $(seq 1 180); do
    grep -qiE "compiled successfully|compiled with [0-9]+ warning" "$DEV_LOG" 2>/dev/null \
      && { echo "  фронт скомпилирован"; break; }
    # если процесс умер — не ждём впустую
    pgrep -f "webpack-dev-server" >/dev/null || { echo "  dev-server упал, смотри $DEV_LOG"; break; }
    sleep 2
  done
fi

# --- Готово ------------------------------------------------------------------
log "Готово!"
cat <<TXT
  Superset:   http://localhost:$FRONT_PORT      (admin / admin)
  Дашборд:    «GigaID · Регистрации»
  Темы:       Settings → Themes → GigaID / GigaID Dark
  Лог фронта: tail -f $DEV_LOG

  Остановить:
    cd "$SUPERSET_DIR" && docker compose stop     # бэкенд
    pkill -f webpack-dev-server                    # фронт
TXT
