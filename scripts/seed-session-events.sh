#!/usr/bin/env bash
#
# Заливает синтетические события сессий регистрации GigaID в Postgres
# compose-стека (база examples), таблица session_events — для плагина
# Session Autopsy без боевого ClickHouse. Повторный запуск пересоздаёт таблицу.
#
# Использование:  ./scripts/seed-session-events.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
dc() { docker compose --project-directory "$REPO_ROOT/superset" "$@"; }

command -v python3 >/dev/null || { echo "python3 не найден"; exit 1; }
dc ps --services --status running | grep -q '^db$' \
  || { echo "Сервис db не запущен — сначала ./scripts/setup-superset-dev.sh"; exit 1; }

echo "==> Генерирую события сессий и заливаю в Postgres (база examples)"
python3 "$SCRIPT_DIR/_gen_session_events.py" \
  | dc exec -T db psql -v ON_ERROR_STOP=1 -U examples -d examples

echo "==> Готово. Таблица session_events создана."
cat <<TXT

Дальше в Superset:
  1. Datasets -> + Dataset -> database «examples», schema public, table session_events.
  2. Создай чарт типа «Session Autopsy», маппинг колонок:
       Session ID column = session_id
       Event time        = event_time
       Step / event      = step_name
       Branch / method   = branch
       Status            = status
       Error code/msg    = error_code / error_msg
       Latency           = latency_ms
       Screen            = screen
       Partner / Device  = partner_source / device
  3. Session ID = 9f3a2b00-0000-0000-0000-0000000000c21  (демо-сессия с метаниями)
TXT
