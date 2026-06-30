# superset-plugin-chart-partner-registrations

Кастомный viz-плагин Apache Superset для GigaID: **регистрации по партнерским сервисам во времени**.
Построен на Apache ECharts (та же библиотека, что и встроенные чарты Superset).

Режимы: **stacked area** (общий объем + вклад партнеров), **overlapping area**, **line**.
Стиль: градиентные заливки, сглаженные линии, tooltip с сортировкой по убыванию и строкой Total, опциональный data zoom.

Совместимость: Superset **4.x / 5.x** (generic x-axis), React 16/17, echarts ^5.4.

---

## 1. Важно понимать

Viz-плагины **компилируются внутрь** `superset-frontend` — их нельзя подключить к готовому
docker-образу или pip-установке без пересборки фронтенда. Рабочий процесс:

1. Superset разворачивается из исходников (для разработки) или собирается кастомный docker-образ (для прода).
2. Плагин линкуется в `superset-frontend` и регистрируется в `MainPreset.js`.

> **Быстрый старт (OrbStack/Docker):** в корне `bi-charts` лежит `./setup-superset-dev.sh` —
> он сам клонирует Superset 5.0.0, собирает плагин, патчит `MainPreset.js`, добавляет
> драйвер ClickHouse и поднимает контейнеры. После правок кода — `./rebuild-plugin.sh`.
> Разделы 2–3 ниже — для ручной настройки без Docker.

## 2. Dev-окружение Superset (если еще не развернут)

Требования: Node `^20.16` (для Superset 5.x), Python 3.10+, Docker (для метаданных/Redis — опционально).

```bash
git clone https://github.com/apache/superset.git
cd superset
git checkout 5.0.0          # или актуальный стабильный тег

# backend (вариант через docker-compose для разработки):
docker compose -f docker-compose-light.yml up -d   # или свой способ запуска backend

# frontend:
cd superset-frontend
npm ci
```

## 3. Сборка и подключение плагина

```bash
# в папке плагина
cd superset-plugin-chart-partner-registrations
npm install
npm run build          # или npm run dev — watch-режим

# линкуем в superset-frontend
npm link
cd <superset>/superset-frontend
npm link superset-plugin-chart-partner-registrations
# альтернатива без link: npm i -S /абсолютный/путь/к/плагину
```

Регистрация — `superset-frontend/src/visualizations/presets/MainPreset.js`
(на master/6.x файл называется `MainPreset.ts`):

```js
import { PartnerRegistrationsChartPlugin } from 'superset-plugin-chart-partner-registrations';
// ...внутри массива plugins: [...]
new PartnerRegistrationsChartPlugin().configure({
  key: 'partner_registrations_timeseries',   // viz_type — не меняйте после создания чартов
}),
```

Запуск dev-сервера:

```bash
npm run dev-server     # http://localhost:9000, проксирует API на backend
```

Чарт появится в списке как **Partner Registrations Timeseries** (категория Evolution).

## 4. Данные: ClickHouse (placeholder-схема)

Предполагаемая таблица (подставьте свои имена):

```sql
-- registrations(reg_date DateTime, partner_source String, user_id String)
```

Вариант A — «сырой» датасет: добавьте таблицу `registrations` как dataset в Superset и в чарте выберите:

- **X-axis**: `reg_date`, **Time grain**: Day
- **Metric**: `COUNT(*)` (или `COUNT(DISTINCT user_id)`)
- **Partner service** (groupby): `partner_source`

Вариант B — SQL-датасет (если метрики уже агрегированы):

```sql
SELECT
    toDate(reg_date)  AS reg_date,
    partner_source,
    count()           AS registrations
FROM registrations
GROUP BY reg_date, partner_source
```

и метрика `SUM(registrations)`.

Агрегацию по дням делает сам Superset (time grain) — в ClickHouse достаточно сырых событий.

## 5. Настройки чарта

| Контрол | Что делает |
|---|---|
| Chart mode | stacked area / overlapping area / line |
| Smooth lines, Show markers | стиль линий и точки |
| Area opacity, Gradient fill | заливка области |
| Color scheme | стандартные цветовые схемы Superset |
| Show legend, Data zoom | легенда и зум-слайдер |
| Y Axis Format, Time format | форматирование осей (D3 / smart date) |

Рекомендация: если партнеров больше ~7 — переключайтесь в режим Line и ограничивайте
series limit, иначе stacked area становится нечитаемым.

## 6. Прод-сборка (docker)

Для прода соберите кастомный образ: в Dockerfile на базе `apache/superset` скопируйте плагин,
выполните `npm i` плагина в `superset-frontend`, патч `MainPreset.js` и `npm run build`
фронтенда. Каркас:

```dockerfile
FROM apache/superset:5.0.0 AS base
# ... стандартный multi-stage из репозитория superset, где на шаге сборки frontend:
# COPY superset-plugin-chart-partner-registrations /plugins/...
# RUN cd superset-frontend && npm i -S /plugins/... && (патч MainPreset.js) && npm run build
```

## 7. Структура

```
src/
  index.ts                    # экспорт плагина
  plugin/index.ts             # ChartPlugin + метаданные
  plugin/buildQuery.ts        # timeseries-запрос: x_axis + groupby + pivot/flatten
  plugin/controlPanel.ts      # контролы (Query + Chart Style)
  plugin/transformProps.ts    # queriesData -> EChartsOption
  PartnerRegistrationsChart.tsx  # React-обертка над echarts (init/setOption/resize/dispose)
  types.ts
  images/thumbnail.png
```
