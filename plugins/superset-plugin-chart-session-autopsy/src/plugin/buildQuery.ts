import { buildQueryContext, QueryFormData } from '@superset-ui/core';

/**
 * Тянем сырые строки событий ОДНОЙ сессии (длинный формат, по строке на
 * событие), отсортированные по времени. Сессия задаётся либо контролом
 * «Session ID», либо нативным фильтром дашборда / drill-to-detail по колонке
 * session_id — оба применяются стандартно через buildQueryContext.
 */
export default function buildQuery(formData: QueryFormData) {
  const f = formData as Record<string, any>;
  // DnD-контролы Superset хранят значение массивом (["col"]) — берём первый
  const one = (v: any) => (Array.isArray(v) ? v[0] : v);
  const extra = Array.isArray(f.extra_cols)
    ? f.extra_cols
    : f.extra_cols
      ? [f.extra_cols]
      : [];
  const cols = [
    one(f.session_id_col),
    one(f.event_time_col),
    one(f.step_col),
    one(f.branch_col),
    one(f.status_col),
    one(f.error_code_col),
    one(f.error_msg_col),
    one(f.latency_col),
    one(f.screen_col),
    one(f.user_col),
    one(f.partner_col),
    one(f.device_col),
    ...extra.map(one),
  ].filter(Boolean);

  const sidCol = one(f.session_id_col);
  const timeCol = one(f.event_time_col);

  return buildQueryContext(formData, baseQueryObject => {
    const filters = [...(baseQueryObject.filters || [])];
    if (f.session_id && sidCol) {
      filters.push({ col: sidCol, op: '==', val: f.session_id });
    }
    return [
      {
        ...baseQueryObject,
        columns: cols,
        filters,
        orderby: timeCol ? [[timeCol, true]] : [],
        is_timeseries: false,
      },
    ];
  });
}
