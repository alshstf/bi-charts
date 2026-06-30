import {
  CategoricalColorNamespace,
  ChartProps,
  DTTM_ALIAS,
  ensureIsArray,
  getColumnLabel,
  getNumberFormatter,
  getTimeFormatter,
  TimeseriesDataRecord,
} from '@superset-ui/core';
import { ChartMode } from '../types';

/** '#5470c6' | 'rgb(84,112,198)' -> 'rgba(84,112,198,<alpha>)' */
function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    // eslint-disable-next-line no-bitwise
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map(s => s.trim());
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

export default function transformProps(chartProps: ChartProps) {
  const { width, height, formData, queriesData, theme } = chartProps;
  const rawFormData = chartProps.rawFormData as Record<string, any>;
  const {
    chartMode = 'stacked_area',
    smoothLine = true,
    showMarkers = false,
    areaOpacity = 0.55,
    gradientFill = true,
    showLegend = true,
    zoomable = false,
    colorScheme,
    yAxisFormat,
    xAxisTimeFormat,
    sliceId,
  } = formData as Record<string, any>;

  const [queryData] = queriesData;
  const data = (queryData?.data ?? []) as TimeseriesDataRecord[];
  const labelMap = (queryData as Record<string, any>)?.label_map ?? {};

  const xAxisLabel = rawFormData?.x_axis
    ? getColumnLabel(rawFormData.x_axis)
    : DTTM_ALIAS;

  // every column except the x-axis is a series (one per partner)
  const colnames: string[] = ensureIsArray(
    (queryData as Record<string, any>)?.colnames,
  ).filter((c: string) => c !== xAxisLabel);
  const seriesKeys = colnames.length
    ? colnames
    : Object.keys(data[0] ?? {}).filter(k => k !== xAxisLabel);

  const metricsCount = ensureIsArray(rawFormData?.metrics).length;
  const hasGroupby = ensureIsArray(rawFormData?.groupby).length > 0;
  /** "count, SberPrime" -> "SberPrime" when there is a single metric */
  const prettyName = (key: string): string => {
    const mapped = labelMap[key];
    if (metricsCount === 1 && hasGroupby && Array.isArray(mapped) && mapped.length > 1) {
      return mapped.slice(1).join(', ');
    }
    return key;
  };

  const mode = chartMode as ChartMode;
  const stacked = mode === 'stacked_area';
  const isArea = mode !== 'line';

  const colorScale = CategoricalColorNamespace.getScale(colorScheme as string);
  const numberFormatter = getNumberFormatter(yAxisFormat);
  // Timestamps arrive as UTC epoch (midnight UTC for daily grain). Local-tz
  // formatters would shift them to the previous evening ("09 PM"), so for the
  // default smart_date we format in UTC; explicit D3 formats are respected.
  const grain = ((rawFormData?.time_grain_sqla as string) || 'P1D').toString();
  const isSubDaily = grain.startsWith('PT');
  const customFormatter =
    xAxisTimeFormat && xAxisTimeFormat !== 'smart_date'
      ? getTimeFormatter(xAxisTimeFormat)
      : null;
  const timeParts: Intl.DateTimeFormatOptions = isSubDaily
    ? { hour: '2-digit', minute: '2-digit' }
    : {};
  const utcShort = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...timeParts,
  });
  const utcFull = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...timeParts,
  });
  const formatTick = (d: Date) =>
    customFormatter ? `${customFormatter(d)}` : utcShort.format(d);
  const formatTooltipTime = (d: Date) =>
    customFormatter ? `${customFormatter(d)}` : utcFull.format(d);

  // Theme tokens: AntD v5 (Superset 6.x) first, legacy theme object (4.x/5.x)
  // as fallback, hardcoded grays as last resort.
  const th = theme as Record<string, any> | undefined;
  const textColor =
    th?.colorTextSecondary ?? th?.colors?.grayscale?.base ?? '#666';
  const axisLineColor =
    th?.colorBorder ?? th?.colors?.grayscale?.light2 ?? '#e0e0e0';
  const splitLineColor =
    th?.colorSplit ?? th?.colors?.grayscale?.light3 ?? '#f0f0f0';

  const series = seriesKeys.map(key => {
    const name = prettyName(key);
    const color = colorScale(name, sliceId);
    return {
      id: key,
      name,
      type: 'line' as const,
      smooth: !!smoothLine,
      ...(stacked ? { stack: 'registrations' } : {}),
      showSymbol: !!showMarkers,
      symbol: 'circle',
      symbolSize: 6,
      connectNulls: false,
      lineStyle: { width: 2.5, color },
      itemStyle: { color },
      emphasis: { focus: 'series' as const },
      ...(isArea
        ? {
            areaStyle: gradientFill
              ? {
                  color: {
                    type: 'linear' as const,
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0, color: withAlpha(color, areaOpacity) },
                      {
                        offset: 1,
                        color: withAlpha(color, stacked ? areaOpacity * 0.55 : 0.02),
                      },
                    ],
                  },
                }
              : { color, opacity: areaOpacity },
          }
        : {}),
      data: data.map(row => [row[xAxisLabel], row[key] ?? null]) as [
        number | string,
        number | null,
      ][],
    };
  });

  const echartOptions = {
    grid: {
      top: showLegend ? 48 : 24,
      right: 24,
      bottom: zoomable ? 64 : 36,
      left: 16,
      containLabel: true,
    },
    legend: {
      show: !!showLegend,
      type: 'scroll' as const,
      top: 0,
      icon: 'circle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 18,
      textStyle: { color: textColor, fontSize: 12 },
    },
    tooltip: {
      trigger: 'axis' as const,
      confine: true,
      axisPointer: {
        type: 'line' as const,
        lineStyle: { color: axisLineColor, type: 'dashed' as const },
      },
      formatter: (params: any) => {
        const points = ensureIsArray(params);
        if (!points.length) return '';
        const ts = points[0].value?.[0];
        const header = `<div style="font-weight:600;margin-bottom:6px">${formatTooltipTime(
          ts instanceof Date ? ts : new Date(ts),
        )}</div>`;
        const sorted = [...points].sort(
          (a, b) => (b.value?.[1] ?? 0) - (a.value?.[1] ?? 0),
        );
        const total = sorted.reduce((acc, p) => acc + (p.value?.[1] ?? 0), 0);
        const rows = sorted
          .map(
            p =>
              `<div style="display:flex;align-items:center;gap:6px;line-height:1.7">` +
              `${p.marker}<span>${p.seriesName}</span>` +
              `<span style="margin-left:auto;padding-left:16px;font-weight:600">` +
              `${numberFormatter(p.value?.[1] ?? 0)}</span></div>`,
          )
          .join('');
        const totalRow =
          sorted.length > 1
            ? `<div style="display:flex;border-top:1px solid ${splitLineColor};` +
              `margin-top:6px;padding-top:6px;font-weight:600">` +
              `<span>Total</span><span style="margin-left:auto;padding-left:16px">` +
              `${numberFormatter(total)}</span></div>`
            : '';
        return header + rows + totalRow;
      },
    },
    xAxis: {
      type: 'time' as const,
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: {
        color: textColor,
        hideOverlap: true,
        formatter: (value: number) => formatTick(new Date(value)),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: {
        color: textColor,
        formatter: (value: number) => `${numberFormatter(value)}`,
      },
      splitLine: { lineStyle: { color: splitLineColor } },
    },
    ...(zoomable
      ? {
          dataZoom: [
            { type: 'inside' as const },
            { type: 'slider' as const, height: 24, bottom: 8 },
          ],
        }
      : {}),
    series,
  };

  return { width, height, echartOptions };
}
