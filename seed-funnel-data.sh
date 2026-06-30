#!/usr/bin/env bash
#
# Заливает синтетические события воронки регистрации GigaID
# (ствол + ветки sms/email/sber_id) в Postgres compose-стека —
# для плагина split_funnel. Повторный запуск пересоздаёт таблицу.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dc() { docker compose --project-directory "$SCRIPT_DIR/superset" "$@"; }

dc ps --services --status running | grep -q '^db$' \
  || { echo "Сервис db не запущен — сначала ./setup-superset-dev.sh"; exit 1; }

echo "==> Создаю таблицу funnel_events в базе examples"
dc exec -T db psql -v ON_ERROR_STOP=1 -U examples -d examples <<'SQL'
SELECT setseed(0.7);
DROP TABLE IF EXISTS funnel_events;
CREATE TABLE funnel_events (
  user_id int NOT NULL,
  reg_date date NOT NULL,
  partner_source text NOT NULL,
  branch text NOT NULL DEFAULT '',
  step_order int NOT NULL,
  step_name text NOT NULL
);
WITH u AS (
  SELECT i AS user_id, (current_date - (random()*119)::int) AS reg_date,
    (ARRAY['Ozon','Wildberries','Avito','2GIS','Litres','Okko'])[1 + floor(random()*6)::int] AS partner,
    random() r1, random() r2, random() r3, random() r4, random() r5
  FROM generate_series(1, 12000) i
), uu AS (
  SELECT *, CASE
    WHEN partner IN ('Okko','Litres') THEN CASE WHEN r3 < 0.30 THEN 'sber_id' WHEN r3 < 0.75 THEN 'sms' ELSE 'email' END
    WHEN partner = '2GIS' THEN CASE WHEN r3 < 0.08 THEN 'sber_id' WHEN r3 < 0.50 THEN 'sms' ELSE 'email' END
    ELSE CASE WHEN r3 < 0.12 THEN 'sber_id' WHEN r3 < 0.70 THEN 'sms' ELSE 'email' END
  END AS branch_choice FROM u
)
INSERT INTO funnel_events
SELECT user_id, reg_date, partner, '', 1, 'Открыл форму' FROM uu
UNION ALL
SELECT user_id, reg_date, partner, '', 2, 'Ввёл контакт' FROM uu WHERE r1 < 0.78
UNION ALL
SELECT user_id, reg_date, partner, '', 3, 'Дошёл до выбора' FROM uu WHERE r1 < 0.78 AND r2 < 0.82
UNION ALL
SELECT user_id, reg_date, partner, branch_choice, 1, CASE branch_choice WHEN 'sms' THEN 'Запросил код' WHEN 'email' THEN 'Письмо отправлено' ELSE 'Редирект в СберID' END FROM uu WHERE r1 < 0.78 AND r2 < 0.82
UNION ALL
SELECT user_id, reg_date, partner, branch_choice, 2, CASE branch_choice WHEN 'sms' THEN 'Ввёл код' WHEN 'email' THEN 'Перешёл по ссылке' ELSE 'Авторизовался' END FROM uu WHERE r1 < 0.78 AND r2 < 0.82 AND r4 < CASE branch_choice WHEN 'sms' THEN 0.90 WHEN 'email' THEN 0.72 ELSE 0.95 END
UNION ALL
SELECT user_id, reg_date, partner, branch_choice, 3, 'Успешная регистрация' FROM uu WHERE r1 < 0.78 AND r2 < 0.82 AND r4 < CASE branch_choice WHEN 'sms' THEN 0.90 WHEN 'email' THEN 0.72 ELSE 0.95 END AND r5 < CASE branch_choice WHEN 'sms' THEN 0.94 WHEN 'email' THEN 0.90 ELSE 0.98 END;
SELECT branch, step_order, step_name, count(*) FROM funnel_events GROUP BY 1,2,3 ORDER BY 1,2;
SQL

echo "==> Готово. Dataset в Superset: examples / public / funnel_events"
