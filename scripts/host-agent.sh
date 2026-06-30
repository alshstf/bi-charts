#!/usr/bin/env bash
#
# Хост-агент: мост между песочницей Claude и Docker на твоём Mac.
# Песочница не видит твой Docker напрямую, но видит примонтированную папку
# проекта. Этот демон следит за каталогом .host-queue/ и выполняет ТОЛЬКО
# скрипты из белого списка ниже, складывая логи обратно в очередь — их читает
# Claude. Произвольные команды не исполняются.
#
# Запуск (оставь крутиться в отдельном окне терминала):
#   ./scripts/host-agent.sh
# Остановка: Ctrl+C.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
Q="$REPO_ROOT/.host-queue"
mkdir -p "$Q"

# белый список: ключ -> скрипт
declare -A CMD=(
  [rebuild]="$SCRIPT_DIR/rebuild-plugin.sh"
  [setup]="$SCRIPT_DIR/setup-superset-dev.sh"
  [seed-funnel]="$SCRIPT_DIR/seed-funnel-data.sh"
  [seed-session]="$SCRIPT_DIR/seed-session-events.sh"
  [export]="$SCRIPT_DIR/export-dashboards.sh"
)

echo "host-agent: слежу за $Q"
echo "разрешённые команды: ${!CMD[*]}"
echo "(оставь окно открытым; Ctrl+C для выхода)"

while true; do
  shopt -s nullglob
  for req in "$Q"/*.req; do
    base="${req%.req}"
    key="$(tr -d '[:space:][:cntrl:]' < "$req" 2>/dev/null || echo '')"
    mv "$req" "$base.run" 2>/dev/null || continue
    script="${CMD[$key]:-}"
    if [ -z "$script" ]; then
      printf 'неизвестная команда: %q\n' "$key" > "$base.log"
      echo 127 > "$base.exit"
      mv "$base.run" "$base.done"
      echo "[$(date +%T)] отклонено: $key (не в белом списке)"
      continue
    fi
    echo "[$(date +%T)] выполняю: $key -> $(basename "$script")"
    ( cd "$REPO_ROOT" && bash "$script" ) > "$base.log" 2>&1
    code=$?
    echo "$code" > "$base.exit"
    mv "$base.run" "$base.done"
    echo "[$(date +%T)] готово: $key (exit $code)"
  done
  sleep 2
done
