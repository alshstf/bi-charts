#!/usr/bin/env bash
#
# Чистый экспорт дашбордов Superset в exports/gigaid_dashboards.zip.
# Superset при экспорте маскирует пароли БД (sqlalchemy_uri -> XXXXXXXXXX),
# поэтому ZIP безопасно коммитить. Запускать при поднятом стеке.
#
# Использование:  ./scripts/export-dashboards.sh
# Импорт на другом стенде:  ./scripts/import-dashboards.sh  (см. подсказку в конце)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
dc() { docker compose --project-directory "$REPO_ROOT/superset" "$@"; }

EXPORT_DIR="$REPO_ROOT/exports"
DEST="$EXPORT_DIR/gigaid_dashboards.zip"
CONTAINER_TMP="/tmp/gigaid_dashboards.zip"

command -v docker >/dev/null || { echo "docker не найден — запусти OrbStack"; exit 1; }
dc ps --services --status running | grep -q '^superset$' \
  || { echo "Сервис superset не запущен — сначала ./scripts/setup-superset-dev.sh"; exit 1; }

mkdir -p "$EXPORT_DIR"

echo "==> Экспортирую дашборды через Superset CLI"
dc exec -T superset superset export-dashboards -f "$CONTAINER_TMP"

echo "==> Копирую ZIP в exports/"
CID="$(dc ps -q superset)"
docker cp "$CID:$CONTAINER_TMP" "$DEST"
dc exec -T superset rm -f "$CONTAINER_TMP" >/dev/null 2>&1 || true

echo "==> Проверка на пароли в открытом виде (ожидается «чисто»):"
if unzip -p "$DEST" '*.yaml' 2>/dev/null \
    | grep -niE ':[^/@:[:space:]]+@|password: *[^ ]' \
    | grep -viE 'XXXXXXXXXX|password: *null|password: *$'; then
  echo "!! ВНИМАНИЕ: возможен незамаскированный пароль выше — проверь перед коммитом."
  exit 1
else
  echo "   чисто — паролей в открытом виде не найдено."
fi

echo "==> Готово: $DEST"
echo
echo "Импорт на другом стенде (при поднятом Superset):"
echo "  CID=\$(docker compose --project-directory superset ps -q superset)"
echo "  docker cp exports/gigaid_dashboards.zip \$CID:$CONTAINER_TMP"
echo "  docker compose --project-directory superset exec -T superset \\"
echo "    superset import-dashboards -p $CONTAINER_TMP -u admin"
