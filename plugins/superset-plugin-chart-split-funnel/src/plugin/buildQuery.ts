import {
  buildQueryContext,
  ensureIsArray,
  QueryFormData,
} from '@superset-ui/core';

/**
 * Простой groupby-запрос без пивота: строки в длинном формате
 * (step, branch, [step_order]) + значение метрики. Фильтры чарта и
 * нативные фильтры дашборда применяются стандартно через
 * buildQueryContext — отсюда «разрез по партнёру» бесплатно.
 */
export default function buildQuery(formData: QueryFormData) {
  const {
    step_col,
    branch_col,
    subbranch_col,
    step_order_col,
    small_multiples_col,
  } = formData as Record<string, any>;
  return buildQueryContext(formData, baseQueryObject => [
    {
      ...baseQueryObject,
      columns: [
        ...ensureIsArray(step_col),
        ...ensureIsArray(branch_col),
        ...ensureIsArray(subbranch_col),
        ...ensureIsArray(step_order_col),
        ...ensureIsArray(small_multiples_col),
      ],
      is_timeseries: false,
    },
  ]);
}
