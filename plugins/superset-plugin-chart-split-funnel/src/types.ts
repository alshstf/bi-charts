export interface FunnelStep {
  name: string;
  order: number;
  value: number;
}

/**
 * Рекурсивная модель воронки: контейнер = общий ствол + ветки, где каждая ветка —
 * снова воронка (свой ствол + свои под-ветки). Лист = { trunk: [...], branches: {} }.
 * Ветка без под-веток рисуется как раньше (одноуровневая воронка).
 */
export interface SplitFunnelData {
  /** общие шаги контейнера до точки ветвления, отсортированы по order */
  trunk: FunnelStep[];
  /** ветки: имя -> вложенная под-воронка */
  branches: Record<string, SplitFunnelData>;
}

export type ValueDisplay = 'both' | 'absolute' | 'percent';

export type TrunkStyle = 'graphite' | 'brand' | 'subtle';

export type BarAlignment = 'left' | 'center' | 'right';

/** детализация ячейки в режиме сетки (small multiples) */
export type GridCellDetail = 'compact' | 'full';

/** базис процентов: предыдущий шаг / вход в свой контейнер / старт воронки */
export type PercentBasisOption = 'previous' | 'container' | 'e2e';

export interface SplitFunnelStyle {
  branchColors: Record<string, string>;
  trunkFill: string;
  trunkText: string;
  barText: string;
  mutedText: string;
  valueDisplay: ValueDisplay;
  showLegend: boolean;
  /** сливать общий финальный шаг веток в сегментированный итоговый бар */
  mergeFinalStep: boolean;
  /** разрешить схлопывание веток кликом по пиктограмме на развилке */
  collapsible: boolean;
  /** стартовать в свёрнутом (стратегическом) виде */
  startCollapsed: boolean;
  /** выравнивание баров: левый край / центр (классическая воронка) / правый */
  barAlignment: BarAlignment;
  /** выбранные базисы процентов (1..3), применяются ко всем шагам */
  percentBasis: PercentBasisOption[];
  /** в сетке: compact = свёрнутый спарклайн, full = полная воронка в каждой ячейке */
  gridCellDetail: GridCellDetail;
  /** подсвечивать самый большой провал конверсии (worst step-to-step drop) */
  highlightDrop: boolean;
  /** порог: помечать только если провал >= этой доли (0..1) */
  dropThreshold: number;
}

export interface SplitFunnelFacet {
  /** null = одиночная воронка без разреза */
  name: string | null;
  data: SplitFunnelData;
}

/** имена колонок датасета — для построения drill-фильтров */
export interface SplitFunnelColumns {
  step: string;
  branch: string | null;
  /** колонка под-ветки (2-й уровень ветвления), null если не задана */
  subbranch: string | null;
  facet: string | null;
}

export interface SplitFunnelChartProps {
  width: number;
  height: number;
  facets: SplitFunnelFacet[];
  style: SplitFunnelStyle;
  columns: SplitFunnelColumns;
  onContextMenu?: (
    clientX: number,
    clientY: number,
    payload: Record<string, unknown>,
  ) => void;
}
