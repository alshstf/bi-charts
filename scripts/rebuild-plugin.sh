#!/usr/bin/env bash
#
# Пересобирает оба плагина, синхронизирует их в superset-frontend
# и перезапускает dev-server (webpack-watch в контейнере не видит
# файлы, изменённые на хосте — рестарт надёжнее).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGINS=(
  "superset-plugin-chart-partner-registrations"
  "superset-plugin-chart-split-funnel"
)
FRONTEND_DIR="$REPO_ROOT/superset/superset-frontend"

for name in "${PLUGINS[@]}"; do
  dir="$REPO_ROOT/plugins/$name"
  dest="$FRONTEND_DIR/plugins/$name"
  [ -d "$dest" ] || { echo "$name: нет в workspace — сначала ./setup-superset-dev.sh"; exit 1; }
  echo "==> $name: babel build в node:22"
  docker run --rm -v "$dir":/plugin -w /plugin node:22-bookworm bash -lc '
    set -e
    [ -d node_modules ] || npm install --legacy-peer-deps --no-audit --no-fund --loglevel=error
    npm run build-cjs
    npm run build-esm
  '
  echo "==> $name: синхронизирую в workspace"
  tar -C "$dir" --exclude node_modules --exclude '*.log' -cf - . \
    | tar -C "$dest" -xf -
done

echo "==> Перезапускаю dev-server (компиляция ~2-3 мин, следить: docker logs -f superset_node)"
docker compose --project-directory "$REPO_ROOT/superset" restart superset-node
echo "==> Готово."
