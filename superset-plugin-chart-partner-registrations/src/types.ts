import { QueryFormData } from '@superset-ui/core';
import type { EChartsCoreOption } from 'echarts/core';

export type ChartMode = 'area' | 'stacked_area' | 'line';

export interface PartnerRegistrationsCustomFormData {
  chartMode: ChartMode;
  smoothLine: boolean;
  areaOpacity: number;
  gradientFill: boolean;
  showMarkers: boolean;
  showLegend: boolean;
  zoomable: boolean;
  yAxisFormat?: string;
  xAxisTimeFormat?: string;
  colorScheme?: string;
}

export type PartnerRegistrationsFormData = QueryFormData &
  PartnerRegistrationsCustomFormData;

export interface PartnerRegistrationsChartProps {
  echartOptions: EChartsCoreOption;
  width: number;
  height: number;
  theme?: Record<string, any>;
}
