#!/usr/bin/env bash
#
# Заливает синтетические данные регистраций GigaID по партнерам
# в Postgres из docker-compose Superset (база examples) — чтобы
# тестировать плагин без ClickHouse.
#
# 120 дней, 6 партнеров: рост, недельная сезонность, шум,
# запуск нового партнера в середине периода и промо-спайк.
#
# Использование: ./seed-demo-data.sh   (повторный запуск пересоздает таблицу)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
dc() { docker compose --project-directory "$REPO_ROOT/superset" "$@"; }

dc ps --services --status running | grep -q '^db$' \
  || { echo "Сервис db не запущен — сначала ./setup-superset-dev.sh"; exit 1; }

echo "==> Создаю таблицу registrations в базе examples"
dc exec -T db psql -v ON_ERROR_STOP=1 -U examples -d examples <<'SQL'
SELECT setseed(0.42);

DROP TABLE IF EXISTS registrations;
CREATE TABLE registrations (
  reg_date      date    NOT NULL,
  partner_source text   NOT NULL,
  registrations integer NOT NULL
);

INSERT INTO registrations
SELECT
  (current_date - 119 + i)::date,
  p.name,
  GREATEST(0, round(
    (p.base + p.growth * i)
    -- недельная сезонность: проседание в выходные
    * CASE WHEN extract(isodow FROM current_date - 119 + i) >= 6
           THEN 0.65 ELSE 1.0 END
    -- шум
    * (0.85 + random() * 0.3)
    -- 'Okko' запускается на 75-й день и плавно набирает обороты
    * CASE WHEN p.name = 'Okko'
           THEN LEAST(1.0, 0.2 + (i - 75) / 14.0) ELSE 1.0 END
    -- промо-акция у 'Avito' на 100-й день
    * CASE WHEN p.name = 'Avito' AND i = 100 THEN 2.4 ELSE 1.0 END
  ))::int
FROM generate_series(0, 119) AS i
CROSS JOIN (VALUES
  ('Ozon',        120.0, 0.90),
  ('Wildberries',  95.0, 0.55),
  ('Avito',        70.0, 0.35),
  ('2GIS',         38.0, 0.15),
  ('Litres',       22.0, 0.05),
  ('Okko',         60.0, 0.00)
) AS p(name, base, growth)
WHERE NOT (p.name = 'Okko' AND i < 75);

SELECT partner_source,
       count(*)            AS days,
       sum(registrations)  AS total,
       min(reg_date)       AS from_date,
       max(reg_date)       AS to_date
FROM registrations
GROUP BY 1 ORDER BY total DESC;
SQL

cat <<'TXT'

==> Данные залиты. Дальше в Superset (http://localhost:9000):

1. Settings -> Database Connections -> + Database -> PostgreSQL:
     SQLAlchemy URI:  postgresql://examples:examples@db:5432/examples
     (или поля: host=db, port=5432, db=examples, user/pass=examples)

2. Datasets -> + Dataset:  database=examples, schema=public, table=registrations

3. Charts -> + Chart -> dataset registrations -> "Partner Registrations Timeseries":
     X-axis:           reg_date      Time grain: Day
     Metric:           SUM(registrations)
     Partner service:  partner_source
     Time range:       No filter (или Last quarter)

На графике должны быть видны: рост Ozon, выходные «пилы», запуск Okko
с ~75-го дня и спайк Avito ближе к концу периода.
TXT
