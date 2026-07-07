#!/usr/bin/env bash
#
# Пересобирает плагин(ы) и перезапускает ХОСТОВЫЙ webpack dev-server.
#
# В отличие от rebuild-plugin.sh (рестартит контейнер superset-node) — на этой
# машине фронт собирается НА ХОСТЕ (Apple Silicon: swc/nx SIGBUS в Docker-VM,
# см. bi-charts-local-env). Хостовый webpack-watch НЕ подхватывает правки
# плагина (путь идёт через node_modules-симлинк), поэтому нужен рестарт.
#
# Использование:  ./scripts/rebuild-plugin-host.sh [имя-плагина ...]
#   без аргументов — пересобирает все плагины.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/superset/superset-frontend"

ALL=(
  superset-plugin-chart-partner-registrations
  superset-plugin-chart-split-funnel
  superset-plugin-chart-session-autopsy
)

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

PLUGINS=("$@")
[ ${#PLUGINS[@]} -eq 0 ] && PLUGINS=("${ALL[@]}")

for name in "${PLUGINS[@]}"; do
  dir="$REPO_ROOT/plugins/$name"
  dest="$FRONTEND_DIR/plugins/$name"
  [ -d "$dir" ]  || fail "нет плагина: $dir"
  [ -d "$dest" ] || fail "$name нет в workspace — сначала ./scripts/setup-superset-dev.sh"
  log "$name: babel build в node:22 (без napi — SIGBUS не грозит)"
  docker run --rm -v "$dir":/plugin -w /plugin node:22-bookworm bash -lc '
    set -e
    [ -d node_modules ] || npm install --legacy-peer-deps --no-audit --no-fund --loglevel=error
    npm run build-cjs
    npm run build-esm
  '
  log "$name: синхронизирую lib/esm в workspace"
  tar -C "$dir" --exclude node_modules --exclude '*.log' -cf - lib esm package.json \
    | tar -C "$dest" -xf -
done

log "Перезапускаю хостовый webpack dev-server (watch не видит правки через node_modules-симлинк)"
pkill -f webpack-dev-server 2>/dev/null || true
sleep 2

# start-local.sh поднимет dev-server (и, идемпотентно, бэкенд) и дождётся компиляции
exec bash "$SCRIPT_DIR/start-local.sh"
