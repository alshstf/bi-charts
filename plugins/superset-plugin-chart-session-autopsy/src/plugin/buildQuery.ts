import {
  buildQueryContext,
  ensureIsArray,
  QueryFormData,
} from '@superset-ui/core';

/**
 * Тянем сырые строки событий ОДНОЙ сессии (длинный формат, по строке на
 * событие), отсортированные по времени. Сессия задаётся либо контролом
 * «Session ID», либо нативным фильтром дашборда / drill-to-detail по колонке
 * session_id — оба применяются стандартно через buildQueryContext.
 */
export default function buildQuery(formData: QueryFormData) {
  const f = formData as Record<string, any>;
  const cols = [
    ...ensureIsArray(f.session_id_col),
    ...ensureIsArray(f.event_time_col),
    ...ensureIsArray(f.step_col),
    ...ensureIsArray(f.branch_col),
    ...ensureIsArray(f.status_col),
    ...ensureIsArray(f.error_code_col),
    ...ensureIsArray(f.error_msg_col),
    ...ensureIsArray(f.latency_col),
    ...ensureIsArray(f.screen_col),
    ...ensureIsArray(f.user_col),
    ...ensureIsArray(f.partner_col),
    ...ensureIsArray(f.device_col),
  ].filter(Boolean);

  return buildQueryContext(formData, baseQueryObject => {
    const filters = [...(baseQueryObject.filters || [])];
    if (f.session_id && f.session_id_col) {
      filters.push({ col: f.session_id_col, op: '==', val: f.session_id });
    }
    return [
      {
        ...baseQueryObject,
        columns: cols,
        filters,
        orderby: f.event_time_col ? [[f.event_time_col, true]] : [],
        is_timeseries: false,
      },
    ];
  });
}
