import {
  buildQueryContext,
  ensureIsArray,
  getXAxisColumn,
  isXAxisSet,
  normalizeOrderBy,
  QueryFormData,
} from '@superset-ui/core';
import {
  flattenOperator,
  pivotOperator,
  sortOperator,
} from '@superset-ui/chart-controls';

/**
 * Timeseries query with a generic x-axis (Superset 4.x+):
 * - x_axis column + time grain define the time bucket;
 * - groupby (partner service) goes into columns AND series_columns;
 * - post_processing pivots long-format rows into one column per partner
 *   and flattens them back, so transformProps receives
 *   rows like { <x>: ts, 'Partner A': 123, 'Partner B': 45 }.
 */
export default function buildQuery(formData: QueryFormData) {
  const { groupby } = formData;
  return buildQueryContext(formData, baseQueryObject => [
    {
      ...baseQueryObject,
      columns: [
        ...(isXAxisSet(formData)
          ? ensureIsArray(getXAxisColumn(formData))
          : []),
        ...ensureIsArray(groupby),
      ],
      series_columns: groupby,
      // legacy fallback for charts without a generic x-axis
      ...(isXAxisSet(formData) ? {} : { is_timeseries: true }),
      orderby: normalizeOrderBy(baseQueryObject).orderby,
      post_processing: [
        pivotOperator(formData, baseQueryObject),
        sortOperator(formData, baseQueryObject),
        flattenOperator(formData, baseQueryObject),
      ],
    },
  ]);
}
