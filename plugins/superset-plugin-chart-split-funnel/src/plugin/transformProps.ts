import {
  CategoricalColorNamespace,
  ChartProps,
  DataRecord,
  getColumnLabel,
  getMetricLabel,
} from '@superset-ui/core';
import { FunnelStep, SplitFunnelData, SplitFunnelFacet } from '../types';

const TRUNK_VALUES = new Set(['', 'common', '(all)', 'null', 'undefined']);

function isTrunk(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    TRUNK_VALUES.has(String(v).trim().toLowerCase())
  );
}

export default function transformProps(chartProps: ChartProps) {
  const { width, height, formData, queriesData, theme } = chartProps;
  const rawFormData = chartProps.rawFormData as Record<string, any>;
  const {
    colorScheme,
    showLegend = true,
    valueDisplay = 'both',
    mergeFinalStep = true,
    trunkStyle = 'graphite',
    collapsible = true,
    startCollapsed = false,
    barAlignment = 'left',
    percentBasis = ['container'],
    gridCellDetail = 'compact',
    highlightDrop = true,
    dropThreshold = '30',
    sliceId,
  } = formData as Record<string, any>;

  const dropThresholdFrac = (() => {
    const n = Number(dropThreshold);
    return Number.isFinite(n) ? n / 100 : 0.3;
  })();

  // обратная совместимость со старым одиночным значением
  const percentBasisArr: string[] = Array.isArray(percentBasis)
    ? percentBasis
    : percentBasis === 'both'
      ? ['container', 'e2e']
      : percentBasis === 'local'
        ? ['container']
        : [percentBasis];

  const [queryData] = queriesData;
  const rows = (queryData?.data ?? []) as DataRecord[];

  const stepKey = getColumnLabel(rawFormData?.step_col ?? 'step');
  const branchKey = rawFormData?.branch_col
    ? getColumnLabel(rawFormData.branch_col)
    : null;
  const orderKey = rawFormData?.step_order_col
    ? getColumnLabel(rawFormData.step_order_col)
    : null;
  const facetKey = rawFormData?.small_multiples_col
    ? getColumnLabel(rawFormData.small_multiples_col)
    : null;
  // metric может быть не задан при недозаполненной форме (например,
  // навигация назад в explore) — не падаем, рисуем пустое состояние
  const metricKey = rawFormData?.metric
    ? getMetricLabel(rawFormData.metric)
    : '';

  const subKey = rawFormData?.subbranch_col
    ? getColumnLabel(rawFormData.subbranch_col)
    : null;

  const emptyData = (): SplitFunnelData => ({ trunk: [], branches: {} });
  const facetMap = new Map<string | null, SplitFunnelData>();

  rows.forEach(row => {
    const step: FunnelStep = {
      name: String(row[stepKey] ?? ''),
      order: orderKey ? Number(row[orderKey] ?? 0) : 0,
      value: Number(row[metricKey] ?? 0),
    };
    const facetVal = facetKey ? String(row[facetKey] ?? '—') : null;
    if (!facetMap.has(facetVal)) facetMap.set(facetVal, emptyData());
    const fd = facetMap.get(facetVal)!;
    const branchVal = branchKey ? row[branchKey] : null;
    if (isTrunk(branchVal)) {
      fd.trunk.push(step);
      return;
    }
    const b = String(branchVal);
    const bd = (fd.branches[b] = fd.branches[b] ?? emptyData());
    const subVal = subKey ? row[subKey] : null;
    if (subKey && !isTrunk(subVal)) {
      const s = String(subVal);
      const sd = (bd.branches[s] = bd.branches[s] ?? emptyData());
      sd.trunk.push(step);
    } else {
      bd.trunk.push(step);
    }
  });

  const sortSteps = (steps: FunnelStep[]) =>
    steps.sort((a, b) => (orderKey ? a.order - b.order : b.value - a.value));
  const sortContainer = (d: SplitFunnelData) => {
    sortSteps(d.trunk);
    Object.values(d.branches).forEach(sortContainer);
  };
  facetMap.forEach(sortContainer);

  // «Скрыть входной шаг»: отбрасываем первый шаг общего ствола (напр. «Вошли по GigaID»),
  // воронка начинается со следующего; проценты пересчитаются от нового первого шага.
  if (rawFormData?.hide_entry_step) {
    facetMap.forEach(fd => {
      if (fd.trunk.length) fd.trunk.shift();
    });
  }

  // фасеты сортируем по объёму входа в воронку
  const facets: SplitFunnelFacet[] = Array.from(facetMap.entries())
    .map(([name, fd]) => ({ name, data: fd }))
    .sort(
      (a, b) =>
        (b.data.trunk[0]?.value ?? 0) - (a.data.trunk[0]?.value ?? 0),
    );

  // ветки для палитры собираем по всем фасетам
  const branches: Record<string, true> = {};
  const collectBranchNames = (d: SplitFunnelData) => {
    Object.keys(d.branches).forEach(b => {
      branches[b] = true;
      collectBranchNames(d.branches[b]);
    });
  };
  facets.forEach(f => collectBranchNames(f.data));

  const colorScale = CategoricalColorNamespace.getScale(
    colorScheme as string,
  );
  const schemeColors: string[] =
    typeof (colorScale as any)?.range === 'function'
      ? ((colorScale as any).range() as string[])
      : [];

  const th = theme as Record<string, any> | undefined;
  const isDark = (() => {
    const bg = String(th?.colorBgBase ?? '#ffffff');
    const m = bg.match(/^#([0-9a-f]{6})/i);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    // eslint-disable-next-line no-bitwise
    const lum =
      (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) /
      255;
    return lum < 0.45;
  })();

  // Цвет ствола: graphite адаптируется к теме, brand берёт первый цвет
  // схемы (ветки тогда красятся со второго), subtle — фоновая заливка.
  let trunkFill: string;
  let trunkText: string;
  if (trunkStyle === 'brand' && schemeColors.length) {
    [trunkFill] = schemeColors;
    trunkText = '#fff';
  } else if (trunkStyle === 'subtle') {
    trunkFill =
      th?.colorFillSecondary ??
      th?.colors?.grayscale?.light2 ??
      'rgba(140,140,140,0.30)';
    trunkText = th?.colorText ?? th?.colors?.grayscale?.dark2 ?? '#333';
  } else {
    trunkFill = isDark ? '#716B7E' : '#4A4552';
    trunkText = '#fff';
  }

  const branchColors: Record<string, string> = {};
  const branchPalette =
    trunkStyle === 'brand' && schemeColors.length > 1
      ? schemeColors.slice(1)
      : null;
  Object.keys(branches)
    .sort()
    .forEach((b, i) => {
      branchColors[b] = branchPalette
        ? branchPalette[i % branchPalette.length]
        : colorScale(b, sliceId);
    });

  const style = {
    branchColors,
    trunkFill,
    trunkText,
    barText: '#fff',
    mutedText:
      th?.colorTextSecondary ?? th?.colors?.grayscale?.base ?? '#666',
    valueDisplay,
    showLegend: !!showLegend,
    mergeFinalStep: !!mergeFinalStep,
    collapsible: !!collapsible,
    startCollapsed: !!startCollapsed,
    barAlignment,
    percentBasis: percentBasisArr.length ? percentBasisArr : ['container'],
    gridCellDetail: gridCellDetail === 'full' ? 'full' : 'compact',
    highlightDrop: !!highlightDrop,
    dropThreshold: dropThresholdFrac,
  };

  const onContextMenu = (chartProps as Record<string, any>)?.hooks
    ?.onContextMenu;

  return {
    width,
    height,
    facets,
    style,
    columns: { step: stepKey, branch: branchKey, subbranch: subKey, facet: facetKey },
    onContextMenu,
  };
}
